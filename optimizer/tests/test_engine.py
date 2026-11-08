"""End-to-end tests of the deterministic optimizer (OPT-02..07, OPT-09, QA-01)."""

from datetime import timedelta

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from optimizer.engine import input_versions, optimize, still_valid
from optimizer.models import Decision, OfferKind, Transaction, Verdict

from .factories import NOW, bad, constraints, fix, forecast, inputs, intent, item, offer, ok, place, usd

NEAR, MID, FAR = place("near", 0.002), place("mid", 0.004), place("far", 0.05)  # ~220 m, ~440 m, ~5.5 km


def test_recommends_cheapest_suitable_option():
    inp = inputs(
        places=[NEAR, MID],
        items=[item("near-bowl", "near", 1400), item("mid-bowl", "mid", 1100)],
        judgements=[ok("near-bowl"), ok("mid-bowl")],
        intent=intent(anchor="near-bowl"),
    )
    r = optimize(inp, NOW)
    assert r.decision is Decision.RECOMMEND
    assert r.chosen.item_id == "mid-bowl"
    assert r.chosen.payment_method_id == "card-2pct"  # 2% beats debit
    assert r.chosen.effective_cost.minor == 1100 - 22
    assert r.baseline.item_id == "near-bowl" and r.baseline.effective_cost.minor == 1400
    assert r.savings_vs_baseline.minor == 1400 - 1078


def test_budget_is_hard_and_alternative_found_before_skip():
    # Weekly lunch budget 2000, already spent 900 -> 1100 left. Usual bowl costs 1400.
    spent = Transaction(id="t1", amount=usd(900), occurred_at=NOW - timedelta(hours=20), category="lunch")
    inp = inputs(
        places=[NEAR, MID],
        items=[item("near-bowl", "near", 1400), item("mid-wrap", "mid", 1050)],
        judgements=[ok("near-bowl"), ok("mid-wrap")],
        transactions=[spent],
        intent=intent(anchor="near-bowl"),
    )
    r = optimize(inp, NOW)
    assert r.decision is Decision.RECOMMEND and r.chosen.item_id == "mid-wrap"
    assert any(x.item_id == "near-bowl" and x.stage == "budget" for x in r.rejections)
    assert "doesn't fit your limits" in r.reasons[0]
    for o in r.ranked:
        assert o.payable_now <= r.budget_remaining["b-lunch"]


def test_cheaper_mismatched_alternative_is_rejected():
    inp = inputs(
        places=[NEAR, MID],
        items=[item("near-bowl", "near", 1400), item("mid-cookie", "mid", 300)],
        judgements=[ok("near-bowl"), bad("mid-cookie", reason="a cookie is not a lunch")],
        intent=intent(anchor="near-bowl"),
    )
    r = optimize(inp, NOW)
    assert r.chosen.item_id == "near-bowl"
    assert any(x.item_id == "mid-cookie" and x.stage == "suitability" for x in r.rejections)


def test_restriction_violation_rejects_even_if_judged_suitable():
    inp = inputs(
        places=[NEAR, MID],
        items=[item("near-bowl", "near", 1400), item("mid-satay", "mid", 900)],
        judgements=[ok("near-bowl"), ok("mid-satay", violated=["r-nuts"])],
    )
    r = optimize(inp, NOW)
    assert r.chosen.item_id == "near-bowl"
    assert any(x.stage == "restriction" for x in r.rejections)


def test_skip_when_nothing_suitable_fits():
    inp = inputs(
        constraints=constraints(budget_cents=500),
        places=[NEAR, MID],
        items=[item("near-bowl", "near", 1400), item("mid-wrap", "mid", 1050)],
        judgements=[ok("near-bowl"), ok("mid-wrap")],
    )
    r = optimize(inp, NOW)
    assert r.decision is Decision.SKIP and r.chosen is None
    assert "skipping is recommended" in r.reasons[0]


def test_unverified_alternatives_are_reported_honestly():
    inp = inputs(
        constraints=constraints(budget_cents=1000),
        places=[NEAR, MID],
        items=[item("near-bowl", "near", 1400), item("mid-mystery", "mid", 800)],
        judgements=[ok("near-bowl"), bad("mid-mystery", verdict=Verdict.UNVERIFIED, reason="menu text missing")],
    )
    r = optimize(inp, NOW)
    assert r.decision is Decision.SKIP
    assert any("no affordable alternative was verified" in s for s in r.reasons)
    # A missing judgement is treated the same as unverified.
    r2 = optimize(inputs(places=[NEAR], items=[item("near-bowl", "near", 900)]), NOW)
    assert r2.decision is Decision.SKIP and r2.rejections[0].stage == "suitability"


def test_forecast_and_funds_limits():
    items_ = [item("near-bowl", "near", 1400)]
    j = [ok("near-bowl")]
    r = optimize(inputs(places=[NEAR], items=items_, judgements=j, forecast=forecast(low_cents=1500, reserve=200)), NOW)
    assert r.decision is Decision.SKIP and any(x.stage == "forecast" for x in r.rejections)
    r = optimize(inputs(places=[NEAR], items=items_, judgements=j, forecast=forecast(now_cents=1000)), NOW)
    assert any(x.stage == "funds" for x in r.rejections)


def test_unclarified_obligation_blocks_affordability():
    r = optimize(inputs(forecast=forecast(unbounded_obligations=["dinner with Sam (amount unknown)"])), NOW)
    assert r.decision is Decision.INSUFFICIENT_DATA and "dinner with Sam" in r.reasons[0]


def test_stale_location_and_low_confidence_intent():
    r = optimize(inputs(fix=fix(timestamp=NOW - timedelta(minutes=30))), NOW)
    assert r.decision is Decision.INSUFFICIENT_DATA
    r = optimize(inputs(intent=intent(confidence="low")), NOW)
    assert r.decision is Decision.INSUFFICIENT_DATA


def test_outside_radius_rejected_with_distance():
    inp = inputs(places=[NEAR, FAR], items=[item("near-bowl", "near", 1400), item("far-bowl", "far", 500)], judgements=[ok("near-bowl"), ok("far-bowl")])
    r = optimize(inp, NOW)
    assert r.chosen.item_id == "near-bowl"
    far = next(x for x in r.rejections if x.item_id == "far-bowl")
    assert far.stage == "geography" and "radius is 1500 m" in far.reason


def test_ties_broken_by_preference_then_distance():
    items_ = [item("near-a", "near", 1000), item("mid-b", "mid", 1000), item("mid-c", "mid", 1000)]
    inp = inputs(places=[NEAR, MID], items=items_, judgements=[ok("near-a"), ok("mid-b", prefs=["p-veg"]), ok("mid-c")])
    assert optimize(inp, NOW).chosen.item_id == "mid-b"
    inp = inputs(places=[NEAR, MID], items=items_, judgements=[ok("near-a"), ok("mid-b"), ok("mid-c")])
    r = optimize(inp, NOW)
    assert [o.item_id for o in r.ranked] == ["near-a", "mid-b", "mid-c"]


def test_unverified_offer_shown_not_counted():
    inp = inputs(
        places=[NEAR],
        items=[item("near-bowl", "near", 1000)],
        offers=[offer("rumour", "near", OfferKind.AMOUNT_OFF, 500, verified=False)],
        judgements=[ok("near-bowl")],
        payment_methods=[inputs().payment_methods[0]],
    )
    r = optimize(inp, NOW)
    assert r.chosen.payable_now.minor == 1000 and r.chosen.unverified_offer_ids == ["rumour"]


def test_recommendation_invalidated_by_change_or_expiry():
    o = offer("deal", "near", OfferKind.AMOUNT_OFF, 100, expires_at=NOW + timedelta(minutes=3))
    inp = inputs(places=[NEAR], items=[item("near-bowl", "near", 1000)], offers=[o], judgements=[ok("near-bowl")])
    r = optimize(inp, NOW)
    assert r.expires_at == NOW + timedelta(minutes=3)  # the offer expires before the location TTL
    assert still_valid(r, inp, NOW)[0]
    assert still_valid(r, inp, NOW + timedelta(minutes=4)) == (False, ["expired"])
    moved = inputs(**{**inp.__dict__, "fix": fix(lat=fix().lat + 0.0001)})
    assert still_valid(r, moved, NOW) == (False, ["location changed"])
    assert input_versions(inp) == input_versions(inputs(**inp.__dict__))


@settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    prices=st.lists(st.integers(100, 5000), min_size=1, max_size=6),
    budget=st.integers(0, 6000),
    spent=st.integers(0, 3000),
    low=st.integers(0, 6000),
)
def test_every_ranked_option_respects_every_hard_limit(prices, budget, spent, low):
    places_ = [place(f"p{k}", 0.001 * (k + 1)) for k in range(len(prices))]
    items_ = [item(f"p{k}-x", f"p{k}", c) for k, c in enumerate(prices)]
    inp = inputs(
        constraints=constraints(budget_cents=budget),
        forecast=forecast(low_cents=low),
        places=places_,
        items=items_,
        judgements=[ok(i.id) for i in items_],
        transactions=[Transaction(id="s", amount=usd(spent), occurred_at=NOW - timedelta(hours=1), category="lunch")],
    )
    r = optimize(inp, NOW)
    headroom = min(budget - spent, low, 50_000)
    for o in r.ranked:
        assert o.payable_now.minor <= headroom
    affordable = [c for c in prices if c <= headroom]
    assert (r.decision is Decision.RECOMMEND) == bool(affordable)
    if affordable:
        assert r.chosen.list_price.minor == min(affordable)
