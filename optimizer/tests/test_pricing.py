"""Pricing and offer-selection tests (OPT-04, QA-01), including a property test
that checks CP-SAT against brute-force enumeration."""

from itertools import combinations

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from optimizer import pricing
from optimizer.models import OfferKind, PaymentMethod

from .factories import CARD2, DEBIT, NOW, item, offer, place, usd

P = place("cafe")


def sel(it, offers, methods=(DEBIT, CARD2), limit=None):
    oc = pricing.check_offers(it, P, list(offers), list(methods), NOW)
    return pricing.select(it, list(methods), oc.eligible, limit)


def test_same_group_offers_do_not_stack():
    it = item("bowl", "cafe", 1200)
    s = sel(it, [offer("a", "cafe", OfferKind.AMOUNT_OFF, 200, stack_group="g"), offer("b", "cafe", OfferKind.AMOUNT_OFF, 300, stack_group="g")], [DEBIT])
    assert [o.id for o in s.offers] == ["b"]
    assert s.breakdown.payable_now == 900


def test_non_stackable_offer_stands_alone():
    it = item("bowl", "cafe", 1000)
    offers = [
        offer("solo", "cafe", OfferKind.PERCENT_OFF, 3000, stackable=False),  # 300 off
        offer("x", "cafe", OfferKind.AMOUNT_OFF, 200),
        offer("y", "cafe", OfferKind.AMOUNT_OFF, 150),
    ]
    s = sel(it, offers, [DEBIT])
    assert sorted(o.id for o in s.offers) == ["x", "y"]  # 350 beats 300 alone


def test_required_card_and_card_cashback():
    it = item("bowl", "cafe", 1000)
    o = offer("cardonly", "cafe", OfferKind.CASHBACK_PERCENT, 1000, required_payment_method_ids=["card-2pct"])
    s = sel(it, [o])
    assert s.method.id == "card-2pct"
    assert s.breakdown.verified_cashback == 100 + 20
    assert s.breakdown.effective_cost == 880


def test_instant_discount_beats_equal_cashback():
    # Both give an effective cost of 900; paying less now wins the tie.
    it = item("bowl", "cafe", 1000)
    offers = [
        offer("now", "cafe", OfferKind.AMOUNT_OFF, 100, stack_group="g"),
        offer("later", "cafe", OfferKind.CASHBACK_AMOUNT, 100, stack_group="g"),
    ]
    s = sel(it, offers, [DEBIT])
    assert [o.id for o in s.offers] == ["now"]


def test_cap_minimum_spend_expiry_activation_unverified():
    it = item("bowl", "cafe", 1000)
    offers = [
        offer("capped", "cafe", OfferKind.PERCENT_OFF, 5000, max_benefit=usd(150)),
        offer("minspend", "cafe", OfferKind.AMOUNT_OFF, 500, min_spend=usd(2000)),
        offer("old", "cafe", OfferKind.AMOUNT_OFF, 500, expires_at=NOW),
        offer("inactive", "cafe", OfferKind.AMOUNT_OFF, 500, requires_activation=True),
        offer("unverified", "cafe", OfferKind.AMOUNT_OFF, 500, verified=False),
        offer("othershop", "elsewhere", OfferKind.AMOUNT_OFF, 500),
    ]
    oc = pricing.check_offers(it, P, offers, [DEBIT], NOW)
    assert [o.id for o in oc.eligible] == ["capped"]
    assert [o.id for o in oc.unverified] == ["unverified"]
    assert {r[0] for r in oc.rejected} == {"minspend", "old", "inactive"}
    s = pricing.select(it, [DEBIT], oc.eligible, None)
    assert s.breakdown.payable_now == 850


def test_cashback_cannot_fund_todays_purchase():
    # Effective cost 900 is under the 1000 limit, but 1100 must be paid now.
    it = item("bowl", "cafe", 1100)
    o = offer("cb", "cafe", OfferKind.CASHBACK_AMOUNT, 200)
    assert sel(it, [o], [DEBIT], limit=usd(1000)) is None
    assert sel(it, [o], [DEBIT], limit=usd(1100)).breakdown.effective_cost == 900


def test_input_order_does_not_change_answer():
    it = item("bowl", "cafe", 1000)
    offers = [offer(f"o{k}", "cafe", OfferKind.AMOUNT_OFF, 100, stack_group="g") for k in range(4)]
    a = sel(it, offers)
    b = sel(it, list(reversed(offers)), [CARD2, DEBIT])
    assert [o.id for o in a.offers] == [o.id for o in b.offers] == ["o0"]
    assert a.method.id == b.method.id == "card-2pct"  # 2% cashback makes it cheaper


# --------------------------------------------------------------------------- #
# Property test: CP-SAT result equals the brute-force optimum
# --------------------------------------------------------------------------- #

kinds = st.sampled_from(list(OfferKind))


@st.composite
def scenario(draw):
    price = draw(st.integers(1, 20_000))
    n = draw(st.integers(0, 5))
    offers = []
    for k in range(n):
        kind = draw(kinds)
        value = draw(st.integers(0, 3000)) if kind in (OfferKind.PERCENT_OFF, OfferKind.CASHBACK_PERCENT) else draw(st.integers(0, 2000))
        offers.append(
            offer(
                f"o{k}",
                "cafe",
                kind,
                value,
                stack_group=draw(st.sampled_from([None, "g1", "g2"])),
                stackable=draw(st.booleans()),
                max_benefit=draw(st.one_of(st.none(), st.integers(0, 1500).map(usd))),
                required_payment_method_ids=draw(st.sampled_from([[], ["debit"], ["card-2pct"]])),
            )
        )
    methods = [DEBIT, PaymentMethod(id="card-x", name="x", kind="credit", base_cashback_bps=draw(st.integers(0, 500)))]
    limit = draw(st.one_of(st.none(), st.integers(0, 25_000)))
    return price, offers, methods, limit


def brute_force(price, offers, methods, limit):
    best = None
    for m in methods:
        for r in range(len(offers) + 1):
            for combo in combinations(offers, r):
                ids = [o.id for o in combo]
                if any(o.required_payment_method_ids and m.id not in o.required_payment_method_ids for o in combo):
                    continue
                groups = [o.stack_group for o in combo if o.stack_group]
                if len(groups) != len(set(groups)):
                    continue
                if any(not o.stackable for o in combo) and len(combo) > 1:
                    continue
                if sum(pricing.instant_discount_of(o, price) for o in combo) > price:
                    continue
                bd = pricing.compute_breakdown(price, m, list(combo))
                if limit is not None and bd.payable_now > limit:
                    continue
                key = (bd.effective_cost, bd.payable_now)
                if best is None or key < best:
                    best = key
    return best


@settings(max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(scenario())
def test_cpsat_matches_brute_force(sc):
    price, offers, methods, limit = sc
    it = item("thing", "cafe", price)
    s = pricing.select(it, methods, offers, None if limit is None else usd(limit))
    expected = brute_force(price, offers, methods, limit)
    if expected is None:
        assert s is None
    else:
        assert s is not None
        assert (s.breakdown.effective_cost, s.breakdown.payable_now) == expected
        if limit is not None:
            assert s.breakdown.payable_now <= limit
