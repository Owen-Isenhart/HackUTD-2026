"""Offer eligibility and per-item pricing (spec OPT-04, OPT-05).

For one item, choose the payment method and the set of offers that minimise the
effective cost (amount paid now minus verified cashback), subject to stacking
rules and the hard money limit. The choice is made with OR-Tools CP-SAT, which
proves optimality. Ties are broken lexicographically: lower amount paid now
(cashback later cannot fund a purchase today), then a fixed order over method
and offer ids so identical inputs always give identical answers.

The solver only chooses. Every amount that is reported is recomputed afterwards
by `compute_breakdown` with plain integer arithmetic.

Documented assumptions (not stated in the spec; revisit in DISC-08):
- Percentage discounts and minimum spend are measured on the list price.
- Percentage cashback is measured on the amount paid after instant discounts.
- A card's own cashback applies on top of merchant offers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ortools.sat.python import cp_model

from .models import Item, Offer, OfferKind, PaymentMethod, Place
from .money import Money

BPS = 10_000


@dataclass(frozen=True)
class OfferCheck:
    eligible: list[Offer]
    unverified: list[Offer]
    rejected: list[tuple[str, str]]  # (offer id, reason)


def check_offers(item: Item, place: Place, offers: list[Offer], methods: list[PaymentMethod], now: datetime) -> OfferCheck:
    method_ids = {m.id for m in methods}
    eligible: list[Offer] = []
    unverified: list[Offer] = []
    rejected: list[tuple[str, str]] = []
    for o in offers:
        if o.merchant_id != place.merchant_id:
            continue  # belongs to another merchant; not a rejection
        reason = None
        if o.eligible_item_ids and item.id not in o.eligible_item_ids:
            reason = "item not covered by offer"
        elif o.eligible_item_categories and item.category not in o.eligible_item_categories:
            reason = f"category {item.category!r} not covered by offer"
        elif o.starts_at and now < o.starts_at:
            reason = "offer not started"
        elif now >= o.expires_at:
            reason = "offer expired"
        elif o.requires_activation and not o.activated:
            reason = "offer needs activation"
        elif o.required_payment_method_ids and not (set(o.required_payment_method_ids) & method_ids):
            reason = "requires a payment method the user does not have"
        elif o.min_spend is not None and item.price < o.min_spend:
            reason = f"minimum spend {o.min_spend} not met by {item.price}"
        elif o.min_spend is not None and o.min_spend.currency != item.price.currency:
            reason = "currency mismatch"
        if reason:
            rejected.append((o.id, reason))
        elif not o.verified:
            unverified.append(o)  # shown to the user, never counted as savings
        else:
            eligible.append(o)
    return OfferCheck(eligible, unverified, rejected)


# --------------------------------------------------------------------------- #
# Exact integer arithmetic for a chosen configuration
# --------------------------------------------------------------------------- #


def _cap(amount: int, o: Offer) -> int:
    return min(amount, o.max_benefit.minor) if o.max_benefit is not None else amount


def instant_discount_of(o: Offer, price: int) -> int:
    if o.kind is OfferKind.AMOUNT_OFF:
        return _cap(min(o.value, price), o)
    if o.kind is OfferKind.PERCENT_OFF:
        return _cap(price * o.value // BPS, o)
    return 0


@dataclass(frozen=True)
class Breakdown:
    instant_discount: int
    payable_now: int
    offer_cashback: int
    card_cashback: int
    points: dict[str, int]

    @property
    def verified_cashback(self) -> int:
        return self.offer_cashback + self.card_cashback

    @property
    def effective_cost(self) -> int:
        return self.payable_now - self.verified_cashback


def compute_breakdown(price: int, method: PaymentMethod, chosen: list[Offer]) -> Breakdown:
    instant = sum(instant_discount_of(o, price) for o in chosen)
    payable = max(price - instant, 0)
    offer_cb = 0
    points: dict[str, int] = {}
    for o in chosen:
        if o.kind is OfferKind.CASHBACK_AMOUNT:
            offer_cb += _cap(o.value, o)
        elif o.kind is OfferKind.CASHBACK_PERCENT:
            offer_cb += _cap(payable * o.value // BPS, o)
        elif o.kind is OfferKind.POINTS_FLAT:
            points[o.points_program or o.source] = points.get(o.points_program or o.source, 0) + o.value
        elif o.kind is OfferKind.POINTS_PER_DOLLAR:
            key = o.points_program or o.source
            points[key] = points.get(key, 0) + o.value * (payable // 100)
    card_cb = payable * method.base_cashback_bps // BPS
    if method.points_program and method.points_per_dollar:
        points[method.points_program] = points.get(method.points_program, 0) + method.points_per_dollar * (payable // 100)
    return Breakdown(instant, payable, offer_cb, card_cb, points)


# --------------------------------------------------------------------------- #
# CP-SAT selection
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Selection:
    method: PaymentMethod
    offers: list[Offer]
    breakdown: Breakdown


def _build(price: int, methods: list[PaymentMethod], offers: list[Offer], limit: int | None):
    m = cp_model.CpModel()
    pay = [m.new_bool_var(f"pay_{i}") for i in range(len(methods))]
    use = [m.new_bool_var(f"use_{k}") for k in range(len(offers))]
    m.add_exactly_one(pay)

    for k, o in enumerate(offers):
        if o.required_payment_method_ids:
            allowed = [pay[i] for i, pm in enumerate(methods) if pm.id in o.required_payment_method_ids]
            if not allowed:
                m.add(use[k] == 0)
            else:
                m.add(use[k] <= sum(allowed))
    groups: dict[str, list[int]] = {}
    for k, o in enumerate(offers):
        if o.stack_group:
            groups.setdefault(o.stack_group, []).append(k)
    for ks in groups.values():
        m.add_at_most_one(use[k] for k in ks)
    for k, o in enumerate(offers):
        if not o.stackable:
            for j in range(len(offers)):
                if j != k:
                    m.add_bool_or([use[k].Not(), use[j].Not()])

    disc = [instant_discount_of(o, price) for o in offers]
    # Discounts adding up past the price make the item free, not impossible:
    # payable = max(price - discounts, 0), matching compute_breakdown.
    raw = m.new_int_var(price - sum(disc), price, "raw_payable")
    m.add(raw == price - sum(d * u for d, u in zip(disc, use)))
    payable = m.new_int_var(0, price, "payable")
    m.add_max_equality(payable, [raw, 0])

    cashback_terms = []
    for k, o in enumerate(offers):
        if o.kind is OfferKind.CASHBACK_AMOUNT:
            cashback_terms.append(_cap(o.value, o) * use[k])
        elif o.kind is OfferKind.CASHBACK_PERCENT:
            cb = m.new_int_var(0, price, f"cb_{k}")
            m.add(BPS * cb <= o.value * payable).only_enforce_if(use[k])
            if o.max_benefit is not None:
                m.add(cb <= o.max_benefit.minor)
            m.add(cb == 0).only_enforce_if(use[k].Not())
            cashback_terms.append(cb)
    for i, pm in enumerate(methods):
        if pm.base_cashback_bps:
            cc = m.new_int_var(0, price, f"cc_{i}")
            m.add(BPS * cc <= pm.base_cashback_bps * payable).only_enforce_if(pay[i])
            m.add(cc == 0).only_enforce_if(pay[i].Not())
            cashback_terms.append(cc)

    max_cashback = sum(_cap(o.value, o) if o.kind is OfferKind.CASHBACK_AMOUNT else price for o in offers) + price
    effective = m.new_int_var(-max_cashback, price, "effective")
    m.add(effective == payable - sum(cashback_terms))
    if limit is not None:
        m.add(payable <= limit)

    n = len(offers)
    tiebreak = sum((i << n) * p for i, p in enumerate(pay)) + sum((1 << k) * u for k, u in enumerate(use))
    return m, pay, use, payable, effective, tiebreak


def canonical_order(methods: list[PaymentMethod], offers: list[Offer]) -> tuple[list[PaymentMethod], list[Offer]]:
    """Fixed order for tie-breaking: the default card first, then by id."""
    return (
        sorted(methods, key=lambda pm: (not pm.is_default, pm.id)),
        sorted(offers, key=lambda o: o.id),
    )


def _solver(time_limit_s: float) -> cp_model.CpSolver:
    s = cp_model.CpSolver()
    s.parameters.num_workers = 1  # reproducible
    s.parameters.random_seed = 0
    s.parameters.max_time_in_seconds = time_limit_s
    return s


def select(
    item: Item,
    methods: list[PaymentMethod],
    offers: list[Offer],
    limit: Money | None,
    time_limit_s: float = 5.0,
) -> Selection | None:
    """Best (method, offers) for the item, or None if nothing fits under `limit`."""
    if not methods:
        return None
    methods, offers = canonical_order(methods, offers)
    price = item.price.minor
    lim = None if limit is None else limit.minor
    if lim is not None and lim < 0:
        return None
    m, pay, use, payable, effective, tiebreak = _build(price, methods, offers, lim)
    s = _solver(time_limit_s)

    # Lexicographic objectives, each phase pinning the previous optimum.
    for objective in (effective, payable, tiebreak):
        m.minimize(objective)
        status = s.solve(m)
        if status == cp_model.INFEASIBLE:
            return None
        if status != cp_model.OPTIMAL:
            raise RuntimeError(f"CP-SAT did not prove optimality for {item.id}: {s.status_name(status)}")
        # objective_value is a float; round, never truncate (3845.9999 -> 3846).
        m.add(objective == round(s.objective_value))

    method = next(pm for pm, v in zip(methods, pay) if s.boolean_value(v))
    chosen = [o for o, v in zip(offers, use) if s.boolean_value(v)]
    bd = compute_breakdown(price, method, chosen)
    if bd.effective_cost != s.value(effective) or bd.payable_now != s.value(payable):
        raise AssertionError(f"solver and arithmetic disagree for {item.id}")
    return Selection(method, chosen, bd)


def min_payable(item: Item, methods: list[PaymentMethod], offers: list[Offer], time_limit_s: float = 5.0) -> int | None:
    """Lowest amount payable now with no limit applied. Used to explain rejections."""
    if not methods:
        return None
    m, _, _, payable, _, _ = _build(item.price.minor, methods, offers, None)
    m.minimize(payable)
    s = _solver(time_limit_s)
    status = s.solve(m)
    if status != cp_model.OPTIMAL:
        return None
    return round(s.objective_value)
