"""Nemotron layer tests with a scripted fake model (AGENT-01 style: malformed or
unsupported model output must fail before it reaches the optimizer).

These do not call a real model. Real-model behaviour is unverified until a
Nemotron endpoint is available.
"""

from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace

import pytest

from optimizer import forecast as fc
from optimizer.engine import Inputs, optimize
from optimizer.intent import intent_from_routine, routine_match
from optimizer.models import Decision, RoutineEntry, Verdict, Weekday
from optimizer.money import Money
from optimizer.nemotron import jobs
from optimizer.nemotron.client import NemotronClient, Reply, Thinking, _strip_to_json
from optimizer.pipeline import World, run

from .factories import CARD2, DEBIT, NOW, constraints, fix, forecast, inputs, intent, item, ok, place, usd


class FakeLLM:
    """Returns scripted replies per schema name and records how it was called."""

    def __init__(self, **by_schema):
        self.by_schema = by_schema
        self.calls: list[tuple[str, Thinking, str]] = []

    def structured(self, system, user, schema, thinking, max_answer_tokens=2048):
        self.calls.append((schema.__name__, thinking, user))
        data = self.by_schema[schema.__name__]
        data = data(user) if callable(data) else data
        return Reply(data=schema.model_validate(data), reasoning="(fake reasoning)", attempts=1, thinking_used=thinking.enabled)


ROUTINE = """# Routine
- Weekdays 12:00-13:00 I get lunch at Chipotle, usually a burrito bowl, $11-$14.
- I walk past Starbucks at 7:30 on my commute to work.
- I'm vegetarian and I have a peanut allergy.
"""
PROFILE = """# Money
Checking balance: $1,850.00. Keep at least $300 in the account.
Lunch budget is $60 per week. Rent $1,200 due 2026-12-01.
Paycheck $900 every two weeks, next on 2026-11-13.
Owe Sam for concert tickets, maybe $40-$60, by 2026-11-20.
Only search within 1 mile.
"""


def good_profile():
    return {
        "timezone": "America/Chicago",
        "search_radius": {"value_text": "1", "unit": "mi", "evidence_quote": "Only search within 1 mile"},
        "current_balance": {"amount_text": "$1,850.00", "evidence_quote": "Checking balance: $1,850.00"},
        "reserve": {"amount_text": "$300", "evidence_quote": "Keep at least $300 in the account"},
        "budgets": [
            {"all_spending": False, "scope_categories": ["lunch"], "period": "week", "amount_text": "$60", "stated_explicitly": True, "evidence_quote": "Lunch budget is $60 per week"},
            {"all_spending": False, "scope_categories": ["coffee"], "period": "week", "amount_text": "$20", "stated_explicitly": False, "evidence_quote": "I walk past Starbucks"},  # inferred: amount not in quote
            {"all_spending": False, "scope_categories": ["lunch"], "period": "month", "amount_text": "$250", "stated_explicitly": True, "evidence_quote": "Lunch budget is $250 per month"},  # invented quote
        ],
        "preferences": [{"description": "vegetarian", "applies_to_categories": ["lunch", "dinner"], "importance": 4, "stated_explicitly": True, "evidence_quote": "I'm vegetarian"}],
        "restrictions": [{"description": "peanut allergy", "applies_to_categories": [], "stated_explicitly": True, "evidence_quote": "peanut allergy"}],
        "routine": [
            {"place_name": "Chipotle", "days": ["mon", "tue", "wed", "thu", "fri"], "start": "12:00", "end": "13:00", "category": "lunch", "typical_item": "burrito bowl", "spend_low_text": "$11", "spend_high_text": "$14", "purpose": "purchase", "evidence_quote": "Weekdays 12:00-13:00 I get lunch at Chipotle, usually a burrito bowl, $11-$14"},
            {"place_name": "Starbucks", "days": ["mon", "tue", "wed", "thu", "fri"], "start": "07:15", "end": "07:45", "category": "coffee", "typical_item": "none", "purpose": "commute", "evidence_quote": "I walk past Starbucks at 7:30 on my commute"},
            {"place_name": "Gym", "days": ["sat"], "start": "09:00", "end": "10:00", "category": "fitness", "typical_item": "x", "purpose": "other", "evidence_quote": "I'm vegetarian"},  # unknown category
        ],
        "incomes": [{"description": "paycheck", "amount_text": "$900", "cadence": "biweekly", "next_date": "2026-11-13", "evidence_quote": "Paycheck $900 every two weeks"}],
        "bills": [{"description": "rent", "amount_text": "$1,200", "cadence": "once", "next_date": "2026-12-01", "evidence_quote": "Rent $1,200 due 2026-12-01"}],
        "obligations": [{"description": "concert tickets for Sam", "amount_low_text": "$40", "amount_high_text": "$60", "due_date": "2026-11-20", "evidence_quote": "Owe Sam for concert tickets, maybe $40-$60"}],
    }


# --------------------------------------------------------------------------- #
# 1. Profile compiler
# --------------------------------------------------------------------------- #


def test_compile_profile_validates_every_fact():
    llm = FakeLLM(ProfileDraft=good_profile())
    cp = jobs.compile_profile(llm, ROUTINE, PROFILE, version="v1")
    cs, facts, rep = cp.constraints, cp.facts, cp.report

    assert [b.amount.minor for b in cs.budgets] == [6000]  # only the stated, quoted budget
    assert any("not found" in d and "$250 per month" in d for d in rep.dropped)  # invented quote
    assert [p.kind for p in cs.pending_confirmation] == ["budget"]  # inferred budget held back
    assert cs.restrictions[0].description == "peanut allergy"
    assert cs.bubble_m == pytest.approx(1609.344)  # 1 mile converted by code
    assert cs.timezone == "America/Chicago"
    assert [r.place_name for r in cs.routine] == ["Chipotle", "Starbucks"]  # unknown category dropped
    assert cs.routine[0].typical_spend_high.minor == 1400
    assert facts.current_balance.minor == 185_000 and facts.reserve.minor == 30_000
    assert facts.obligations[0].high.minor == 6000


def test_compile_uses_reasoning_with_budget():
    llm = FakeLLM(ProfileDraft=good_profile())
    jobs.compile_profile(llm, ROUTINE, PROFILE, version="v1")
    assert llm.calls[0][1] == Thinking.on(6144)


def test_amount_must_appear_inside_its_quote():
    d = good_profile()
    d["budgets"] = [{**d["budgets"][0], "amount_text": "$600"}]
    cp = jobs.compile_profile(FakeLLM(ProfileDraft=d), ROUTINE, PROFILE, version="v1")
    assert cp.constraints.budgets == [] and any("not inside its quote" in x for x in cp.report.dropped)


def test_placeholder_files_compile_to_nothing():
    empty = {"budgets": [], "preferences": [], "restrictions": [], "routine": [], "incomes": [], "bills": [], "obligations": []}
    cp = jobs.compile_profile(FakeLLM(ProfileDraft=empty), "placeholder", "placeholder", version="v0")
    assert cp.constraints.budgets == [] and cp.facts.current_balance is None
    assert fc.project(cp.facts, NOW, "America/Chicago") is None


# --------------------------------------------------------------------------- #
# 2. Intent
# --------------------------------------------------------------------------- #


CHIP = place("chipotle", 0.0002, name="Chipotle")
SBUX = place("starbucks", 0.0002, name="Starbucks")
BOWL = item("chipotle-burrito-bowl", "chipotle", 1250, desc="rice, black beans, sofritas tofu, salsa")


def _cs_with_routine():
    return jobs.compile_profile(FakeLLM(ProfileDraft=good_profile()), ROUTINE, PROFILE, version="v1").constraints


def test_routine_match_gives_intent_without_model():
    cs = _cs_with_routine()
    m = routine_match(cs, fix(), [CHIP], NOW)  # Tue 12:00 Chicago
    assert m is not None
    it = intent_from_routine(m[0], m[1], [BOWL])
    assert it.source == "routine" and it.anchor_item_id == BOWL.id and it.categories == ["lunch"]


def test_commute_routine_suppresses_recommendation():
    cs = _cs_with_routine()
    commute_time = datetime(2026, 11, 10, 13, 30, tzinfo=timezone.utc)  # 07:30 Chicago
    m = routine_match(cs, fix(timestamp=commute_time), [SBUX], commute_time)
    assert m and intent_from_routine(*m, []) is None


def test_intent_fallback_rejects_unknown_anchor():
    llm = FakeLLM(IntentDraft={"categories": ["coffee"], "description": "coffee", "anchor_item_id": "made-up", "confidence": "high", "evidence_quote": "Tuesday"})
    it = jobs.infer_intent(llm, constraints(), "Tuesday 15:00", [(CHIP, [BOWL])])
    assert it.confidence == "low" and it.anchor_item_id is None
    assert llm.calls[0][1] == Thinking.off()


# --------------------------------------------------------------------------- #
# 3. Suitability judge
# --------------------------------------------------------------------------- #


def test_judge_downgrades_unsupported_verdicts():
    cs = _cs_with_routine()
    a = item("a-veg-wrap", "chipotle", 900, desc="grilled vegetable wrap")
    b = item("b-mystery", "chipotle", 500, desc="")
    c = item("c-satay", "chipotle", 800, desc="tofu with peanut sauce")
    d = item("d-unknown-id", "chipotle", 700, desc="salad")
    pref, restr = cs.preferences[0].id, cs.restrictions[0].id
    reply = {
        "judgements": [
            {"item_id": "a-veg-wrap", "verdict": "suitable", "reasons": ["a lunch wrap"], "evidence_quotes": ["vegetable wrap"], "satisfied_preference_ids": [pref]},
            {"item_id": "b-mystery", "verdict": "suitable", "reasons": ["probably fine"], "evidence_quotes": ["tasty lunch"]},  # quote not in data
            {"item_id": "c-satay", "verdict": "suitable", "reasons": ["lunch"], "evidence_quotes": ["peanut sauce"], "violated_restriction_ids": [restr]},
            {"item_id": "d-unknown-id", "verdict": "suitable", "reasons": ["salad"], "evidence_quotes": ["salad"], "violated_restriction_ids": ["r99"]},
        ]
    }
    llm = FakeLLM(JudgementBatch=reply)
    js, rep = jobs.judge_suitability(llm, intent(), cs, [(x, CHIP) for x in (a, b, c, d)] + [(BOWL, CHIP)])
    v = {j.item_id: j for j in js}
    assert v["a-veg-wrap"].verdict is Verdict.SUITABLE and v["a-veg-wrap"].satisfied_preference_ids == [pref]
    assert v["b-mystery"].verdict is Verdict.UNVERIFIED
    assert v["c-satay"].violated_restriction_ids == [restr]
    assert v["d-unknown-id"].verdict is Verdict.UNVERIFIED
    assert v[BOWL.id].verdict is Verdict.UNVERIFIED  # model skipped it
    assert llm.calls[0][1] == Thinking.on(2048)
    assert "<data" in llm.calls[0][2]  # third-party text is fenced as data


# --------------------------------------------------------------------------- #
# 4. Explanation
# --------------------------------------------------------------------------- #


def _rec():
    inp = inputs(places=[CHIP], items=[BOWL], judgements=[ok(BOWL.id)], intent=intent(anchor=BOWL.id), payment_methods=[DEBIT, CARD2])
    return optimize(inp, NOW)


def test_explanation_with_wrong_number_falls_back_to_template():
    rec = _rec()
    llm = FakeLLM(ExplanationDraft={"headline": "Bowl at Chipotle", "body": "Pay $9.99 and save $5."})
    ex = jobs.explain(llm, rec)
    assert ex.source == "template" and "$9.99" in ex.rejected_reason
    assert str(rec.chosen.payable_now) in ex.headline


def test_explanation_with_correct_numbers_is_kept():
    rec = _rec()
    body = f"Pay {rec.chosen.payable_now} with your 2% card and get {rec.chosen.verified_cashback} back."
    ex = jobs.explain(FakeLLM(ExplanationDraft={"headline": "Lunch at Chipotle", "body": body}), rec)
    assert ex.source == "nemotron" and ex.body == body


def test_skip_explanation_must_say_skip():
    inp = inputs(constraints=constraints(budget_cents=100), places=[CHIP], items=[BOWL], judgements=[ok(BOWL.id)])
    rec = optimize(inp, NOW)
    assert rec.decision is Decision.SKIP
    ex = jobs.explain(FakeLLM(ExplanationDraft={"headline": "Treat yourself", "body": "Enjoy lunch."}), rec)
    assert ex.source == "template" and "Skipping" in ex.headline


# --------------------------------------------------------------------------- #
# Forecast projection
# --------------------------------------------------------------------------- #


def test_projection_low_point_and_unbounded():
    facts = fc.FinancialFacts(
        currency="USD",
        current_balance=usd(100_000),
        reserve=usd(10_000),
        incomes=[fc.Recurring("pay", usd(50_000), "biweekly", date(2026, 11, 20), "e")],
        bills=[fc.Recurring("rent", usd(120_000), "once", date(2026, 11, 20), "e")],
        obligations=[fc.Obligation("gift", usd(1000), usd(3000), date(2026, 11, 15), "e"), fc.Obligation("trip", None, None, None, "e")],
    )
    snap = fc.project(facts, NOW, "America/Chicago")
    # 100,000 - 3,000 (gift high) - 120,000 (rent before same-day pay) = -23,000
    assert snap.min_projected_balance_lower.minor == -23_000
    assert snap.unbounded_obligations == ["trip"]


def test_monthly_on_31st_clamps_to_month_end():
    r = fc.Recurring("x", usd(1), "monthly", date(2026, 1, 31), "e")
    assert fc.occurrences(r, date(2026, 1, 1), date(2026, 4, 30)) == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


# --------------------------------------------------------------------------- #
# Client mechanics (no network)
# --------------------------------------------------------------------------- #


def _resp(content, finish="stop", reasoning=None):
    msg = SimpleNamespace(content=content, reasoning_content=reasoning)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason=finish)])


def test_client_retries_and_falls_back_from_overlong_reasoning(monkeypatch):
    c = NemotronClient(base_url="http://unused/v1", api_key="x")
    seen = []
    replies = iter([_resp("", finish="length"), _resp("not json"), _resp('{"headline": "h", "body": "b"}')])

    def fake_call(messages, schema, thinking, max_answer_tokens):
        seen.append((thinking.enabled, len(messages)))
        return next(replies)

    monkeypatch.setattr(c, "_call", fake_call)
    r = c.structured("sys", "user", jobs.ExplanationDraft, Thinking.on(512))
    assert r.data.headline == "h" and r.attempts == 3 and r.thinking_used is False
    assert seen == [(True, 2), (False, 2), (False, 4)]  # thinking dropped, then error fed back


def test_strip_to_json():
    assert _strip_to_json('<think>hmm</think>```json\n{"a":1}\n```') == '{"a":1}'
    assert _strip_to_json('Sure! {"a":1}') == '{"a":1}'


def _bad_request(message):
    import httpx2
    from openai import BadRequestError

    response = httpx2.Response(400, request=httpx2.Request("POST", "http://unused/v1/chat/completions"))
    return BadRequestError(message, response=response, body={"message": message})


def test_client_reduces_output_to_server_limits_after_schema_fallback(monkeypatch):
    c = NemotronClient(base_url="http://unused/v1", api_key="x")
    errors = iter([
        "response_format json_schema is unsupported",
        "max_tokens=10240 cannot be greater than max_model_len=8192",
        "This model's maximum context length is 8192 tokens. However, you requested "
        "8192 output tokens and your prompt contains 1700 input tokens.",
        None,
    ])
    seen = []

    def create(**kwargs):
        seen.append((kwargs["max_tokens"], "response_format" in kwargs))
        error = next(errors)
        if error:
            raise _bad_request(error)
        return _resp('{"headline":"h","body":"b"}')

    monkeypatch.setattr(c._client.chat.completions, "create", create)
    reply = c.structured("sys", "user", jobs.ExplanationDraft, Thinking.on(6144), max_answer_tokens=4096)
    assert reply.data.headline == "h"
    assert seen == [(10240, True), (10240, False), (8192, False), (6492, False)]


@pytest.mark.parametrize("error", [
    "unknown field reasoning_budget",
    "This model's maximum context length is 8192 tokens and your prompt contains 8192 input tokens.",
    "max_tokens=2048 cannot be greater than max_model_len=8192",
])
def test_client_propagates_errors_without_a_smaller_positive_limit(monkeypatch, error):
    from openai import BadRequestError

    c = NemotronClient(base_url="http://unused/v1", api_key="x")
    calls = []

    def create(**kwargs):
        calls.append(kwargs["max_tokens"])
        raise _bad_request(error)

    monkeypatch.setattr(c._client.chat.completions, "create", create)
    with pytest.raises(BadRequestError):
        c.structured("sys", "user", jobs.ExplanationDraft, Thinking.off())
    assert calls == [2048]


# --------------------------------------------------------------------------- #
# Whole pipeline with the fake model
# --------------------------------------------------------------------------- #


def test_pipeline_end_to_end_recommends_cheaper_suitable_lunch():
    cs = _cs_with_routine()
    taco = place("tacos", 0.003, name="Taco Shop")
    veg_tacos = item("tacos-veg", "tacos", 900, desc="three black bean tacos")
    snapshot = fc.project(jobs.compile_profile(FakeLLM(ProfileDraft=good_profile()), ROUTINE, PROFILE, version="v1").facts, NOW, cs.timezone)
    judge = {
        "judgements": [
            {"item_id": BOWL.id, "verdict": "suitable", "reasons": ["usual lunch"], "evidence_quotes": ["black beans"], "satisfied_preference_ids": [cs.preferences[0].id]},
            {"item_id": "tacos-veg", "verdict": "suitable", "reasons": ["a vegetarian lunch"], "evidence_quotes": ["black bean tacos"], "satisfied_preference_ids": [cs.preferences[0].id]},
        ]
    }
    llm = FakeLLM(JudgementBatch=judge, ExplanationDraft={"headline": "Tacos at Taco Shop", "body": "Cheaper and still vegetarian."})
    world = World(places=[CHIP, taco], items=[BOWL, veg_tacos], offers=[], payment_methods=[DEBIT, CARD2], transactions=[])
    res = run(llm, cs, snapshot, fix(), world, NOW)
    assert res.intent.source == "routine"
    assert res.recommendation.decision is Decision.RECOMMEND
    assert res.recommendation.chosen.item_id == "tacos-veg"
    assert res.explanation.source == "nemotron"
    assert [c[0] for c in llm.calls] == ["JudgementBatch", "ExplanationDraft"]  # no model call for intent or maths


def test_cli_recommend_runs_end_to_end(tmp_path, monkeypatch, capsys):
    import json

    import optimizer.__main__ as cli

    (tmp_path / "r.md").write_text(ROUTINE)
    (tmp_path / "p.md").write_text(PROFILE)
    world = {
        "places": [CHIP.model_dump(mode="json")],
        "items": [BOWL.model_dump(mode="json")],
        "payment_methods": [DEBIT.model_dump(mode="json")],
    }
    (tmp_path / "w.json").write_text(json.dumps(world))
    judge = {"judgements": [{"item_id": BOWL.id, "verdict": "suitable", "reasons": ["usual"], "evidence_quotes": ["black beans"]}]}
    fake = FakeLLM(ProfileDraft=good_profile(), JudgementBatch=judge, ExplanationDraft={"headline": "Lunch at Chipotle", "body": "Usual bowl."})
    monkeypatch.setattr(cli, "NemotronClient", lambda: fake)
    monkeypatch.chdir(tmp_path)
    rc = cli.main(["recommend", "--routine", "r.md", "--profile", "p.md", "--world", "w.json", "--lat", str(CHIP.lat), "--lon", str(CHIP.lon), "--now", NOW.isoformat()])
    out = json.loads(capsys.readouterr().out)
    assert rc == 0 and out["recommendation"]["decision"] == "recommend"
    assert any("routine" in t for t in out["trace"])
    # second run uses the cached compile: no new ProfileDraft call
    n = sum(1 for c in fake.calls if c[0] == "ProfileDraft")
    cli.main(["recommend", "--routine", "r.md", "--profile", "p.md", "--world", "w.json", "--lat", str(CHIP.lat), "--lon", str(CHIP.lon), "--now", NOW.isoformat()])
    assert sum(1 for c in fake.calls if c[0] == "ProfileDraft") == n
