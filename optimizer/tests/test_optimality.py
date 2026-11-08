"""Does the optimizer always return the best recommendation the rules allow?

Four layers of evidence:
1. Oracle match: on randomly generated worlds, the engine's full ranked list
   equals an independent brute-force reference (tests/oracle.py).
2. Audit: every ranked option is re-checked against every hard rule, and every
   candidate is accounted for (ranked, or rejected with a reason).
3. Metamorphic: changes whose effect is known in advance (shuffling inputs,
   loosening limits, adding offers, removing the winner) have exactly that effect.
4. Hand-worked scenarios with answers computed by hand.

Run more examples with:  HYPOTHESIS_PROFILE=thorough uv run pytest tests/test_optimality.py
"""

from __future__ import annotations

import os
from dataclasses import replace
from datetime import timedelta

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from optimizer.engine import Inputs, optimize
from optimizer.models import (
    Budget,
    ConstraintSet,
    Decision,
    ForecastSnapshot,
    Item,
    LocationFix,
    Offer,
    OfferKind,
    PaymentMethod,
    Period,
    Place,
    Preference,
    PurchaseIntent,
    Restriction,
    SuitabilityJudgement,
    Transaction,
    Verdict,
)

from . import oracle
from .factories import HERE, NOW, usd

settings.register_profile("default", max_examples=250, deadline=None, suppress_health_check=list(HealthCheck))
settings.register_profile("thorough", max_examples=3000, deadline=None, suppress_health_check=list(HealthCheck))
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "default"))

CATS = ["lunch", "coffee"]


def money(tight_low: int, high: int):
    """Hypothesis favours values near zero; mix a comfortable range with a tight
    one so limits sometimes bind and sometimes don't."""
    return st.one_of(st.integers(high // 2, high), st.integers(tight_low, high))
ids = lambda prefix, n: [f"{prefix}{k}" for k in range(n)]  # noqa: E731


# --------------------------------------------------------------------------- #
# Random worlds
# --------------------------------------------------------------------------- #


@st.composite
def worlds(draw) -> Inputs:
    n_places = draw(st.integers(1, 4))
    places = [
        Place(
            id=f"p{k}",
            name=f"Place {k}",
            merchant_id=f"m{k}",
            lat=HERE[0] + draw(st.sampled_from([1, 3])) * draw(st.integers(-80, 80)) / 10_000,  # mostly inside the 1.5 km radius
            lon=HERE[1] + draw(st.integers(-80, 80)) / 10_000,
        )
        for k in range(n_places)
    ]
    n_items = draw(st.integers(2, 7))
    items = [
        Item(
            id=f"i{k}",
            place_id=draw(st.sampled_from(places)).id,
            name=f"item {k}",
            category=draw(st.sampled_from(CATS)),
            price=usd(draw(st.integers(1, 3000))),
            price_observed_at=NOW - timedelta(hours=1),
            price_source="test",
        )
        for k in range(n_items)
    ]
    n_methods = draw(st.one_of(st.integers(2, 3), st.integers(1, 3)))  # card choice needs 2+ cards
    default = draw(st.one_of(st.none(), st.integers(0, n_methods - 1)))
    methods = [
        PaymentMethod(id=f"card{k}", name=f"card {k}", kind="credit", base_cashback_bps=draw(st.one_of(st.integers(100, 500), st.integers(0, 500))), is_default=(k == default))
        for k in range(n_methods)
    ]
    offers = []
    for k in range(draw(st.one_of(st.integers(3, 10), st.integers(0, 10)))):
        kind = draw(st.sampled_from([OfferKind.AMOUNT_OFF, OfferKind.PERCENT_OFF, OfferKind.CASHBACK_PERCENT, OfferKind.CASHBACK_AMOUNT, OfferKind.POINTS_FLAT, OfferKind.POINTS_PER_DOLLAR]))
        pct = kind in (OfferKind.PERCENT_OFF, OfferKind.CASHBACK_PERCENT)
        offers.append(
            Offer(
                id=f"o{k}",
                source="test",
                merchant_id=draw(st.sampled_from([p for p in places if any(i.place_id == p.id for i in items)])).merchant_id,
                terms_text="t",
                kind=kind,
                value=draw(st.one_of(st.integers(100, 5000 if pct else 1500), st.integers(0, 5000 if pct else 1500))),
                min_spend=draw(st.sampled_from([None, None, None, 500, 1500])) and usd(draw(st.integers(0, 2500))),
                max_benefit=draw(st.one_of(st.none(), st.integers(0, 1000).map(usd))),
                starts_at=draw(st.sampled_from([None] * 6 + [NOW - timedelta(days=1), NOW + timedelta(hours=1)])),
                expires_at=draw(st.sampled_from([NOW + timedelta(days=2)] * 6 + [NOW, NOW + timedelta(seconds=1), NOW - timedelta(days=1)])),
                required_payment_method_ids=draw(st.sampled_from([[]] * 3 + [["card1"], ["card0"], ["card9"]])),
                eligible_item_categories=draw(st.sampled_from([[]] * 4 + [["lunch"], ["coffee"]])),
                eligible_item_ids=draw(st.sampled_from([[]] * 4 + [[f"i{draw(st.integers(0, n_items - 1))}"]])),
                requires_activation=draw(st.sampled_from([False] * 4 + [True])),
                activated=draw(st.booleans()),
                stack_group=draw(st.sampled_from([None, None, None, "g1", "g2"])),
                stackable=draw(st.sampled_from([True, True, True, False])),
                verified=draw(st.booleans()) or draw(st.booleans()),  # mostly verified
            )
        )
    if draw(st.booleans()):
        # A promotion bundle: several usable, stackable offers on one item, so
        # the solver has to combine offers rather than pick one.
        target = draw(st.sampled_from(items))
        merchant = next(p.merchant_id for p in places if p.id == target.place_id)
        for k in range(draw(st.integers(2, 3))):
            offers.append(
                Offer(
                    id=f"s{k}",
                    source="test",
                    merchant_id=merchant,
                    terms_text="t",
                    kind=draw(st.sampled_from([OfferKind.AMOUNT_OFF, OfferKind.CASHBACK_AMOUNT, OfferKind.PERCENT_OFF])),
                    value=draw(st.integers(50, 400)),
                    expires_at=NOW + timedelta(days=1),
                    eligible_item_ids=[target.id],
                    stack_group=draw(st.sampled_from([None, None, "g1"])),
                    verified=True,
                )
            )
    budgets = [
        Budget(
            id=f"b{k}",
            all_spending=(scope := draw(st.sampled_from(["all", "lunch", "coffee"]))) == "all",
            scope_categories=[] if scope == "all" else [scope],
            period=draw(st.sampled_from(list(Period))),
            amount=usd(draw(money(0, 12_000))),
            evidence="t",
        )
        for k in range(draw(st.integers(0, 3)))
    ]
    txns = [
        Transaction(
            id=f"t{k}",
            amount=usd(draw(st.integers(1, 1500))),
            occurred_at=NOW - timedelta(minutes=draw(st.integers(1, 60 * 24 * 40))),  # spans the 1 Nov DST change
            category=draw(st.sampled_from(CATS)),
        )
        for k in range(draw(st.integers(0, 6)))
    ]
    prefs = [Preference(id=f"pr{k}", description="p", weight=draw(st.integers(1, 5)), stated_explicitly=True, evidence="t") for k in range(draw(st.integers(0, 2)))]
    restrictions = [Restriction(id=f"r{k}", description="r", evidence="t") for k in range(draw(st.integers(0, 2)))]
    judgements = []
    for it in items:
        verdict = draw(st.sampled_from([Verdict.SUITABLE] * 6 + [None, Verdict.UNSUITABLE, Verdict.UNVERIFIED]))
        if verdict is None:
            continue
        judgements.append(
            SuitabilityJudgement(
                item_id=it.id,
                verdict=verdict,
                reasons=["t"],
                satisfied_preference_ids=draw(st.lists(st.sampled_from([p.id for p in prefs] + ["pr-unknown"]), unique=True)) if prefs else [],
                violated_restriction_ids=draw(st.lists(st.sampled_from([r.id for r in restrictions] + ["r-unknown"]), unique=True, max_size=1)) if draw(st.integers(0, 4)) == 0 else [],
            )
        )
    cs = ConstraintSet(
        version="gen",
        timezone=draw(st.sampled_from(["America/Chicago", "UTC", "Asia/Kolkata"])),
        bubble_m=1500,
        budgets=budgets,
        preferences=prefs,
        restrictions=restrictions,
    )
    fc = ForecastSnapshot(
        version="gen",
        as_of=NOW,
        valid_until=NOW + timedelta(hours=6),
        horizon_days=30,
        available_now=usd(draw(money(0, 20_000))),
        min_projected_balance_lower=usd(draw(money(-1000, 20_000))),
        reserve=usd(draw(st.integers(0, 1000))),
    )
    intent = PurchaseIntent(
        categories=draw(st.sampled_from([["lunch"], ["coffee"], ["lunch", "coffee"], ["lunch", "coffee"]])),
        description="d",
        source="routine",
        confidence=draw(st.sampled_from(["high", "medium"])),
        evidence="t",
    )
    fix = LocationFix(lat=HERE[0], lon=HERE[1], accuracy_m=10, timestamp=NOW - timedelta(minutes=draw(st.sampled_from([0, 1, 9, 10]))), source="demo")
    return Inputs(cs, fc, fix, places, items, offers, methods, txns, intent, judgements)


def rows(rec):
    return [(o.item_id, o.payment_method_id, tuple(o.applied_offer_ids), o.payable_now.minor, o.effective_cost.minor, o.preference_score) for o in rec.ranked]


# --------------------------------------------------------------------------- #
# 1. Oracle match
# --------------------------------------------------------------------------- #


@given(worlds())
def test_engine_matches_brute_force_oracle(inp):
    rec = optimize(inp, NOW)
    ref = oracle.recommend(inp, NOW)
    assert rec.decision.value == ref.decision
    assert rows(rec) == [o.row() for o in ref.ranked]
    if rec.decision is Decision.RECOMMEND:
        assert rec.chosen == rec.ranked[0]
    else:
        assert rec.chosen is None and rec.ranked == []


@given(worlds(), st.sampled_from(["stale", "future", "expired", "unbounded", "low"]))
def test_refusals_match_oracle(inp, why):
    if why == "stale":
        inp = replace(inp, fix=inp.fix.model_copy(update={"timestamp": NOW - timedelta(minutes=10, seconds=1)}))
    elif why == "future":
        inp = replace(inp, fix=inp.fix.model_copy(update={"timestamp": NOW + timedelta(minutes=2)}))
    elif why == "expired":
        inp = replace(inp, forecast=inp.forecast.model_copy(update={"valid_until": NOW}))
    elif why == "unbounded":
        inp = replace(inp, forecast=inp.forecast.model_copy(update={"unbounded_obligations": ["unknown bill"]}))
    else:
        inp = replace(inp, intent=inp.intent.model_copy(update={"confidence": "low"}))
    rec = optimize(inp, NOW)
    assert rec.decision is Decision.INSUFFICIENT_DATA and oracle.recommend(inp, NOW).decision == "insufficient_data"
    assert rec.reasons and rec.chosen is None


def test_generator_exercises_the_interesting_cases():
    """Guards against a vacuous generator: if random worlds stop reaching
    these situations, the other property tests prove nothing."""
    from collections import Counter

    seen: Counter = Counter()

    @settings(max_examples=300, database=None, derandomize=True, deadline=None, suppress_health_check=list(HealthCheck))
    @given(worlds())
    def probe(inp):
        rec = optimize(inp, NOW)
        seen[rec.decision.value] += 1
        if rec.chosen:
            seen["offer applied"] += bool(rec.chosen.applied_offer_ids)
            seen["2+ offers stacked"] += len(rec.chosen.applied_offer_ids) > 1
            seen["2+ ranked"] += len(rec.ranked) > 1
            default = sorted(inp.payment_methods, key=lambda m: (not m.is_default, m.id))[0].id
            seen["non-default card"] += rec.chosen.payment_method_id != default
        for r in rec.rejections:
            seen["rejected: " + r.stage] += 1

    probe()
    floors = {
        "recommend": 90, "skip": 15, "offer applied": 30, "2+ offers stacked": 5, "2+ ranked": 40, "non-default card": 20,
        "rejected: budget": 10, "rejected: funds": 5, "rejected: forecast": 5, "rejected: geography": 10, "rejected: suitability": 10,
    }
    low = {k: (seen[k], v) for k, v in floors.items() if seen[k] < v}
    assert not low, f"generator too weak (seen, needed): {low}"


# --------------------------------------------------------------------------- #
# 2. Audit of hard rules and completeness
# --------------------------------------------------------------------------- #


def audit(inp: Inputs, rec) -> None:
    cs, fc = inp.constraints, inp.forecast
    items = {i.id: i for i in inp.items}
    places = {p.id: p for p in inp.places}
    offers = {o.id: o for o in inp.offers}
    judged = {j.item_id: j for j in inp.judgements}
    for o in rec.ranked:
        it = items[o.item_id]
        place = places[it.place_id]
        pay = o.payable_now.minor
        # money limits
        assert pay <= fc.available_now.minor, "spends money the user doesn't have"
        assert pay <= fc.min_projected_balance_lower.minor - fc.reserve.minor, "breaks the forecast"
        for b in cs.budgets:
            if b.all_spending or it.category in b.scope_categories:
                assert pay <= oracle.budget_left(b, inp.transactions, NOW, cs), f"breaks budget {b.id}"
        # need, restrictions, geography
        j = judged[o.item_id]
        assert j.verdict is Verdict.SUITABLE
        assert not set(j.violated_restriction_ids) & {r.id for r in cs.restrictions}
        assert it.category in inp.intent.categories
        assert oracle.metres(inp.fix.lat, inp.fix.lon, place.lat, place.lon) <= cs.bubble_m
        # offers
        used = [offers[x] for x in o.applied_offer_ids]
        for off in used:
            assert oracle.offer_usable(off, it, place, inp.payment_methods, NOW), f"applied unusable offer {off.id}"
        method = next(m for m in inp.payment_methods if m.id == o.payment_method_id)
        assert oracle.combo_allowed(method, tuple(used))
        # arithmetic
        assert (pay, o.effective_cost.minor) == oracle.price_combo(it.price.minor, method, tuple(used))
        assert o.payable_now.minor - o.verified_cashback.minor == o.effective_cost.minor
        assert o.list_price.minor - o.instant_discount.minor == pay or pay == 0
    # ranking order
    keys = [(o.effective_cost.minor, -o.preference_score, o.distance_m, o.item_id) for o in rec.ranked]
    assert keys == sorted(keys)


@given(worlds())
def test_every_ranked_option_obeys_every_rule(inp):
    audit(inp, optimize(inp, NOW))


@given(worlds())
def test_every_candidate_is_accounted_for(inp):
    rec = optimize(inp, NOW)
    if rec.decision is Decision.INSUFFICIENT_DATA:
        assert rec.reasons and rec.ranked == []
        return
    ranked = {o.item_id for o in rec.ranked}
    rejected = {r.item_id for r in rec.rejections}
    assert not ranked & rejected, "an item is both ranked and rejected"
    relevant = {i.id for i in inp.items if i.category in inp.intent.categories}
    assert ranked | rejected == relevant, "a candidate vanished without a reason"
    assert all(r.reason for r in rec.rejections)
    if rec.decision is Decision.SKIP:
        assert rec.reasons


# --------------------------------------------------------------------------- #
# 3. Metamorphic properties
# --------------------------------------------------------------------------- #


def rerun(inp: Inputs, **changes):
    return optimize(replace(inp, **changes), NOW)


@given(worlds(), st.randoms(use_true_random=False))
def test_input_order_never_matters(inp, rnd):
    def shuffled(xs):
        xs = list(xs)
        rnd.shuffle(xs)
        return xs

    a = optimize(inp, NOW)
    b = rerun(
        inp,
        places=shuffled(inp.places),
        items=shuffled(inp.items),
        offers=shuffled(inp.offers),
        payment_methods=shuffled(inp.payment_methods),
        transactions=shuffled(inp.transactions),
        judgements=shuffled(inp.judgements),
    )
    assert rows(a) == rows(b) and a.decision == b.decision


@given(worlds(), st.integers(1, 5000))
def test_more_money_never_gives_a_worse_answer(inp, extra):
    a = optimize(inp, NOW)
    cs = inp.constraints.model_copy(update={"budgets": [b.model_copy(update={"amount": usd(b.amount.minor + extra)}) for b in inp.constraints.budgets]})
    fc = inp.forecast.model_copy(update={"available_now": usd(inp.forecast.available_now.minor + extra), "min_projected_balance_lower": usd(inp.forecast.min_projected_balance_lower.minor + extra)})
    b = rerun(inp, constraints=cs, forecast=fc)
    if a.decision is Decision.RECOMMEND:
        assert b.decision is Decision.RECOMMEND
        assert b.chosen.effective_cost <= a.chosen.effective_cost
        assert {o.item_id for o in a.ranked} <= {o.item_id for o in b.ranked}


@given(worlds(), st.sampled_from(list(OfferKind)), st.integers(0, 2000))
def test_extra_offer_never_raises_the_cost(inp, kind, value):
    a = optimize(inp, NOW)
    if a.decision is not Decision.RECOMMEND:
        return
    place = next(p for p in inp.places if p.id == a.chosen.place_id)
    extra = Offer(id="zz-new", source="t", merchant_id=place.merchant_id, terms_text="t", kind=kind, value=value, expires_at=NOW + timedelta(days=1), verified=True)
    b = rerun(inp, offers=inp.offers + [extra])
    assert b.decision is Decision.RECOMMEND
    assert b.chosen.effective_cost <= a.chosen.effective_cost


@given(worlds())
def test_unverified_offers_change_nothing(inp):
    a = optimize(inp, NOW)
    junk = [
        Offer(id=f"zz{k}", source="t", merchant_id=p.merchant_id, terms_text="t", kind=OfferKind.AMOUNT_OFF, value=999, expires_at=NOW + timedelta(days=1), verified=False)
        for k, p in enumerate(inp.places)
    ]
    b = rerun(inp, offers=inp.offers + junk)
    assert rows(a) == rows(b)


@given(worlds())
def test_irrelevant_items_change_nothing(inp):
    a = optimize(inp, NOW)
    far = Place(id="far", name="Far", merchant_id="mfar", lat=HERE[0] + 0.5, lon=HERE[1])
    near = inp.places[0]
    extra_items = [
        Item(id="x-far", place_id="far", name="far cheap", category=inp.intent.categories[0], price=usd(1), price_observed_at=NOW, price_source="t"),
        Item(id="x-bad", place_id=near.id, name="unsuitable cheap", category=inp.intent.categories[0], price=usd(1), price_observed_at=NOW, price_source="t"),
        Item(id="x-other", place_id=near.id, name="other kind", category="fuel", price=usd(1), price_observed_at=NOW, price_source="t"),
    ]
    j = [SuitabilityJudgement(item_id="x-far", verdict=Verdict.SUITABLE, reasons=["t"]), SuitabilityJudgement(item_id="x-bad", verdict=Verdict.UNSUITABLE, reasons=["t"])]
    b = rerun(inp, places=inp.places + [far], items=inp.items + extra_items, judgements=inp.judgements + j)
    assert rows(a) == rows(b)


@given(worlds())
def test_removing_the_winner_promotes_the_runner_up(inp):
    a = optimize(inp, NOW)
    if a.decision is not Decision.RECOMMEND:
        return
    b = rerun(inp, items=[i for i in inp.items if i.id != a.chosen.item_id])
    assert rows(b) == rows(a)[1:]


@given(worlds())
def test_same_input_same_output(inp):
    a, b = optimize(inp, NOW), optimize(inp, NOW)
    assert a == b


# --------------------------------------------------------------------------- #
# 4. Hand-worked scenarios
# --------------------------------------------------------------------------- #


def _world(items, offers=(), methods=None, budget=None, spent=0, available=50_000, low=50_000, judgements=None, prefs=()):
    pl = [Place(id=p, name=p.title(), merchant_id=f"m-{p}", lat=HERE[0] + d, lon=HERE[1]) for p, d in (("near", 0.001), ("mid", 0.003), ("far", 0.05))]
    cs = ConstraintSet(
        version="hand",
        timezone="America/Chicago",
        bubble_m=1500,
        budgets=[Budget(id="lunch", scope_categories=["lunch"], period=Period.WEEK, amount=usd(budget), evidence="t")] if budget is not None else [],
        preferences=list(prefs),
    )
    fc = ForecastSnapshot(version="h", as_of=NOW, valid_until=NOW + timedelta(hours=6), horizon_days=30, available_now=usd(available), min_projected_balance_lower=usd(low), reserve=usd(0))
    txns = [Transaction(id="s", amount=usd(spent), occurred_at=NOW - timedelta(hours=2), category="lunch")] if spent else []
    js = judgements if judgements is not None else [SuitabilityJudgement(item_id=i.id, verdict=Verdict.SUITABLE, reasons=["t"]) for i in items]
    intent = PurchaseIntent(categories=["lunch"], description="lunch", source="routine", confidence="high", evidence="t")
    fix = LocationFix(lat=HERE[0], lon=HERE[1], accuracy_m=5, timestamp=NOW, source="demo")
    return Inputs(cs, fc, fix, pl, list(items), list(offers), methods or [PaymentMethod(id="debit", name="d", kind="debit", is_default=True)], txns, intent, js)


def _it(iid, place, cents):
    return Item(id=iid, place_id=place, name=iid, category="lunch", price=usd(cents), price_observed_at=NOW, price_source="t")


def _off(oid, place, kind, value, **kw):
    return Offer(id=oid, source="t", merchant_id=f"m-{place}", terms_text="t", kind=kind, value=value, expires_at=NOW + timedelta(days=1), verified=True, **kw)


def test_hand_greedy_trap_two_small_offers_beat_one_big():
    # $12 bowl. One non-stackable $5 off, or $3 off + $3 off together = $6 off.
    # Greedy (take the biggest offer first) would stop at $5 off. Best is $6.00 paid.
    rec = optimize(
        _world([_it("bowl", "near", 1200)], [_off("big", "near", OfferKind.AMOUNT_OFF, 500, stackable=False), _off("a", "near", OfferKind.AMOUNT_OFF, 300), _off("b", "near", OfferKind.AMOUNT_OFF, 300)]),
        NOW,
    )
    assert rec.chosen.applied_offer_ids == ["a", "b"] and rec.chosen.payable_now.minor == 600


def test_hand_card_choice_follows_the_offer():
    # $10 lunch. Debit (default, 0%) vs a 1% card. A 15% cashback offer needs the 1% card.
    # Card: pay $10.00, back $1.50 + $0.10 = $1.60, effective $8.40. Debit: $10.00.
    methods = [PaymentMethod(id="debit", name="d", kind="debit", is_default=True), PaymentMethod(id="card1", name="c", kind="credit", base_cashback_bps=100)]
    rec = optimize(_world([_it("wrap", "near", 1000)], [_off("cb", "near", OfferKind.CASHBACK_PERCENT, 1500, required_payment_method_ids=["card1"])], methods=methods), NOW)
    assert (rec.chosen.payment_method_id, rec.chosen.effective_cost.minor, rec.chosen.verified_cashback.minor) == ("card1", 840, 160)


def test_hand_budget_forces_alternative_then_skip():
    # Weekly lunch budget $20, $9 spent: $11 left.
    # Usual bowl $12.50 does not fit. Tacos $11.50 with $1 off = $10.50 fits. Salad $9 is unsuitable.
    items = [_it("bowl", "near", 1250), _it("tacos", "mid", 1150), _it("salad", "mid", 900)]
    js = [
        SuitabilityJudgement(item_id="bowl", verdict=Verdict.SUITABLE, reasons=["t"]),
        SuitabilityJudgement(item_id="tacos", verdict=Verdict.SUITABLE, reasons=["t"]),
        SuitabilityJudgement(item_id="salad", verdict=Verdict.UNSUITABLE, reasons=["side dish, not a lunch"]),
    ]
    offers = [_off("tacos1", "mid", OfferKind.AMOUNT_OFF, 100)]
    rec = optimize(_world(items, offers, budget=2000, spent=900, judgements=js), NOW)
    assert rec.chosen.item_id == "tacos" and rec.chosen.payable_now.minor == 1050
    assert {r.item_id: r.stage for r in rec.rejections} == {"bowl": "budget", "salad": "suitability"}
    # Without the coupon, tacos cost $11.50 > $11 left: nothing fits, so skip.
    rec = optimize(_world(items, [], budget=2000, spent=900, judgements=js), NOW)
    assert rec.decision is Decision.SKIP


def test_hand_cashback_cannot_pay_today_but_counts_in_ranking():
    # $11 left to spend. A: $12 with $3 cashback (effective $9) does not fit today.
    # B: $10.80, no offers, fits. C: $10.50 with $1 cashback (effective $9.50) fits and beats B.
    items = [_it("a", "near", 1200), _it("b", "near", 1080), _it("c", "mid", 1050)]
    offers = [_off("a3", "near", OfferKind.CASHBACK_AMOUNT, 300, eligible_item_ids=["a"]), _off("c1", "mid", OfferKind.CASHBACK_AMOUNT, 100)]
    rec = optimize(_world(items, offers, available=1100), NOW)
    assert [o.item_id for o in rec.ranked] == ["c", "b"]
    assert rec.chosen.effective_cost.minor == 950
    assert next(r for r in rec.rejections if r.item_id == "a").stage == "funds"


def test_hand_preference_breaks_price_tie_then_distance():
    pref = Preference(id="veg", description="vegetarian", weight=2, stated_explicitly=True, evidence="t")
    items = [_it("near-meat", "near", 1000), _it("mid-veg", "mid", 1000), _it("mid-other", "mid", 1000)]
    js = [
        SuitabilityJudgement(item_id="near-meat", verdict=Verdict.SUITABLE, reasons=["t"]),
        SuitabilityJudgement(item_id="mid-veg", verdict=Verdict.SUITABLE, reasons=["t"], satisfied_preference_ids=["veg"]),
        SuitabilityJudgement(item_id="mid-other", verdict=Verdict.SUITABLE, reasons=["t"]),
    ]
    rec = optimize(_world(items, judgements=js, prefs=[pref]), NOW)
    assert [o.item_id for o in rec.ranked] == ["mid-veg", "near-meat", "mid-other"]
