"""Reference implementation of the recommendation, written to be obviously
correct rather than fast. It shares no code with optimizer.engine,
optimizer.pricing, optimizer.budgets or optimizer.geo: offer rules, budget
windows and the search over cards and offers are all re-derived here.

For each item it tries every payment method with every subset of offers,
keeps the combinations that satisfy every hard rule, and takes the best by:
    effective cost, then amount paid now, then method order, then offer order.
Across items it ranks by:
    effective cost, then preference score (higher first), then distance, then id.

The tests require optimizer.engine.optimize to produce exactly this answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from datetime import time as dtime
from itertools import combinations
from zoneinfo import ZoneInfo

from geographiclib.geodesic import Geodesic

from optimizer.models import Budget, ConstraintSet, Offer, OfferKind, PaymentMethod, Period, Transaction, Verdict

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


@dataclass(frozen=True)
class Option:
    item_id: str
    method_id: str
    offer_ids: tuple[str, ...]
    payable: int
    effective: int
    preference: int
    distance: float

    def row(self):
        return (self.item_id, self.method_id, self.offer_ids, self.payable, self.effective, self.preference)


@dataclass(frozen=True)
class OracleResult:
    decision: str  # "recommend" | "skip" | "insufficient_data"
    ranked: list[Option]


# --------------------------------------------------------------------------- #
# Independent rule implementations
# --------------------------------------------------------------------------- #


def metres(lat1, lon1, lat2, lon2) -> float:
    return Geodesic.WGS84.Inverse(lat1, lon1, lat2, lon2)["s12"]


def period_start(period: Period, now: datetime, tz: str, week_start: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(tz)
    today = now.astimezone(zone).date()
    if period is Period.DAY:
        a, b = today, today + timedelta(days=1)
    elif period is Period.WEEK:
        back = (today.weekday() - WEEKDAYS.index(week_start)) % 7
        a = today - timedelta(days=back)
        b = a + timedelta(days=7)
    elif period is Period.MONTH:
        a = today.replace(day=1)
        b = date(a.year + (a.month == 12), a.month % 12 + 1, 1)
    else:
        a, b = date(today.year, 1, 1), date(today.year + 1, 1, 1)
    return datetime.combine(a, dtime(0), zone), datetime.combine(b, dtime(0), zone)


def budget_left(b: Budget, txns: list[Transaction], now: datetime, cs: ConstraintSet) -> int:
    a, z = period_start(b.period, now, cs.timezone, cs.week_starts_on.value)
    spent = sum(t.amount.minor for t in txns if a <= t.occurred_at < z and (b.all_spending or t.category in b.scope_categories))
    return b.amount.minor - spent


def offer_usable(o: Offer, item, place, methods: list[PaymentMethod], now: datetime) -> bool:
    return (
        o.merchant_id == place.merchant_id
        and o.verified
        and (not o.eligible_item_ids or item.id in o.eligible_item_ids)
        and (not o.eligible_item_categories or item.category in o.eligible_item_categories)
        and (o.starts_at is None or o.starts_at <= now)
        and now < o.expires_at
        and (o.activated or not o.requires_activation)
        and (not o.required_payment_method_ids or any(m.id in o.required_payment_method_ids for m in methods))
        and (o.min_spend is None or item.price.minor >= o.min_spend.minor)
    )


def capped(v: int, o: Offer) -> int:
    return v if o.max_benefit is None else min(v, o.max_benefit.minor)


def price_combo(price: int, m: PaymentMethod, combo: tuple[Offer, ...]) -> tuple[int, int]:
    off = 0
    for o in combo:
        if o.kind is OfferKind.AMOUNT_OFF:
            off += capped(min(o.value, price), o)
        elif o.kind is OfferKind.PERCENT_OFF:
            off += capped(price * o.value // 10_000, o)
    payable = max(price - off, 0)
    back = payable * m.base_cashback_bps // 10_000
    for o in combo:
        if o.kind is OfferKind.CASHBACK_AMOUNT:
            back += capped(o.value, o)
        elif o.kind is OfferKind.CASHBACK_PERCENT:
            back += capped(payable * o.value // 10_000, o)
    return payable, payable - back


def combo_allowed(m: PaymentMethod, combo: tuple[Offer, ...]) -> bool:
    if any(o.required_payment_method_ids and m.id not in o.required_payment_method_ids for o in combo):
        return False
    groups = [o.stack_group for o in combo if o.stack_group]
    if len(groups) != len(set(groups)):
        return False
    return not (len(combo) > 1 and any(not o.stackable for o in combo))


# --------------------------------------------------------------------------- #
# The whole recommendation
# --------------------------------------------------------------------------- #


def recommend(inp, now: datetime, max_fix_age=timedelta(minutes=10), cap: int = 25) -> OracleResult:
    cs, fc, intent = inp.constraints, inp.forecast, inp.intent
    age = now - inp.fix.timestamp
    if age > max_fix_age or age < -timedelta(minutes=1) or now >= fc.valid_until or fc.unbounded_obligations or intent.confidence == "low":
        return OracleResult("insufficient_data", [])

    places = {p.id: p for p in inp.places}
    dist = {p.id: metres(inp.fix.lat, inp.fix.lon, p.lat, p.lon) for p in inp.places}
    near = sorted(
        (i for i in inp.items if i.category in intent.categories and dist[i.place_id] <= cs.bubble_m),
        key=lambda i: (dist[i.place_id], i.id),
    )[:cap]

    judged = {j.item_id: j for j in inp.judgements}
    restriction_ids = {r.id for r in cs.restrictions}
    weights = {p.id: p.weight for p in cs.preferences}
    methods = sorted(inp.payment_methods, key=lambda m: (not m.is_default, m.id))

    options: list[Option] = []
    for it in near:
        j = judged.get(it.id)
        if j is None or j.verdict is not Verdict.SUITABLE or any(r in restriction_ids for r in j.violated_restriction_ids):
            continue
        limit = min(
            [fc.available_now.minor, fc.min_projected_balance_lower.minor - fc.reserve.minor]
            + [budget_left(b, inp.transactions, now, cs) for b in cs.budgets if b.all_spending or it.category in b.scope_categories]
        )
        offers = sorted((o for o in inp.offers if offer_usable(o, it, places[it.place_id], inp.payment_methods, now)), key=lambda o: o.id)
        best = None
        for mi, m in enumerate(methods):
            for r in range(len(offers) + 1):
                for combo in combinations(range(len(offers)), r):
                    chosen = tuple(offers[k] for k in combo)
                    if not combo_allowed(m, chosen):
                        continue
                    payable, effective = price_combo(it.price.minor, m, chosen)
                    if payable > limit:
                        continue
                    key = (effective, payable, mi, sum(1 << k for k in combo))
                    if best is None or key < best[0]:
                        best = (key, m, chosen, payable, effective)
        if best is None:
            continue
        _, m, chosen, payable, effective = best
        options.append(
            Option(
                item_id=it.id,
                method_id=m.id,
                offer_ids=tuple(o.id for o in chosen),
                payable=payable,
                effective=effective,
                preference=sum(weights[p] for p in j.satisfied_preference_ids if p in weights),
                distance=dist[it.place_id],
            )
        )
    ranked = sorted(options, key=lambda o: (o.effective, -o.preference, o.distance, o.item_id))
    return OracleResult("recommend" if ranked else "skip", ranked)
