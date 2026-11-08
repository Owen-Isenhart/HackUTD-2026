"""The deterministic optimizer (spec OPT-02 to OPT-07, OPT-09).

Nothing in this module calls a language model. Nemotron's outputs arrive here
only as already-validated inputs: the purchase intent and the per-item
suitability judgements.

Order of operations follows context.md section 14:
candidate retrieval -> hard filtering -> ranking -> decision.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from pydantic import BaseModel

from . import budgets, geo, pricing
from .models import (
    ConstraintSet,
    Decision,
    ForecastSnapshot,
    Item,
    LocationFix,
    Offer,
    PaymentMethod,
    Place,
    PricedOption,
    PurchaseIntent,
    Recommendation,
    Rejection,
    SuitabilityJudgement,
    Transaction,
    Verdict,
)
from .money import Money


@dataclass(frozen=True)
class OptimizerConfig:
    max_fix_age: timedelta = timedelta(minutes=10)
    location_ttl: timedelta = timedelta(minutes=10)
    max_candidates: int = 25
    solver_time_limit_s: float = 5.0


@dataclass(frozen=True)
class Inputs:
    constraints: ConstraintSet
    forecast: ForecastSnapshot
    fix: LocationFix
    places: list[Place]
    items: list[Item]
    offers: list[Offer]
    payment_methods: list[PaymentMethod]
    transactions: list[Transaction]
    intent: PurchaseIntent
    judgements: list[SuitabilityJudgement] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Input fingerprints (OPT-09)
# --------------------------------------------------------------------------- #


def _digest(obj) -> str:
    def dump(x):
        if isinstance(x, BaseModel):
            return x.model_dump(mode="json")
        if isinstance(x, list):
            return [dump(v) for v in x]
        return x

    data = json.dumps(dump(obj), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()[:16]


def input_versions(inp: Inputs) -> dict[str, str]:
    return {
        "constraints": inp.constraints.version + ":" + _digest(inp.constraints),
        "forecast": inp.forecast.version + ":" + _digest(inp.forecast),
        "location": _digest(inp.fix),
        "places": _digest(sorted(inp.places, key=lambda p: p.id)),
        "items": _digest(sorted(inp.items, key=lambda i: i.id)),
        "offers": _digest(sorted(inp.offers, key=lambda o: o.id)),
        "payment_methods": _digest(sorted(inp.payment_methods, key=lambda m: m.id)),
        "transactions": _digest(sorted(inp.transactions, key=lambda t: t.id)),
        "intent": _digest(inp.intent),
        "judgements": _digest(sorted(inp.judgements, key=lambda j: j.item_id)),
    }


def still_valid(rec: Recommendation, current: Inputs, now: datetime) -> tuple[bool, list[str]]:
    """OPT-09: a recommendation dies when it expires or any material input changes."""
    problems = []
    if now >= rec.expires_at:
        problems.append("expired")
    new = input_versions(current)
    for k, v in rec.input_versions.items():
        if new.get(k) != v:
            problems.append(f"{k} changed")
    return (not problems, problems)


# --------------------------------------------------------------------------- #
# Main entry point
# --------------------------------------------------------------------------- #


def _empty(decision: Decision, reasons: list[str], inp: Inputs, now: datetime, rejections=None, remaining=None) -> Recommendation:
    return Recommendation(
        decision=decision,
        chosen=None,
        ranked=[],
        rejections=rejections or [],
        baseline=None,
        savings_vs_baseline=None,
        budget_remaining=remaining or {},
        reasons=reasons,
        input_versions=input_versions(inp),
        created_at=now,
        expires_at=now,
    )


def baseline_option(item: Item, place: Place, distance: float, methods: list[PaymentMethod]) -> PricedOption | None:
    """What the user would pay by default: the anchor item, default card, no offers."""
    if not methods:
        return None
    default = next((m for m in methods if m.is_default), sorted(methods, key=lambda m: m.id)[0])
    bd = pricing.compute_breakdown(item.price.minor, default, [])
    cur = item.price.currency
    return PricedOption(
        item_id=item.id,
        place_id=place.id,
        place_name=place.name,
        item_name=item.name,
        distance_m=distance,
        list_price=item.price,
        payment_method_id=default.id,
        applied_offer_ids=[],
        instant_discount=Money(minor=0, currency=cur),
        payable_now=Money(minor=bd.payable_now, currency=cur),
        verified_cashback=Money(minor=bd.verified_cashback, currency=cur),
        effective_cost=Money(minor=bd.effective_cost, currency=cur),
        points=bd.points,
        preference_score=0,
    )


def retrieve_candidates(
    cs: ConstraintSet,
    fix: LocationFix,
    places: list[Place],
    items: list[Item],
    intent: PurchaseIntent,
    config: OptimizerConfig = OptimizerConfig(),
) -> tuple[list[Item], list[Rejection], dict[str, float]]:
    """Items of the intended kind inside the radius, nearest first (OPT-02).
    Also used by the pipeline so Nemotron judges exactly these items."""
    inside, outside = geo.places_in_bubble(fix, places, cs.bubble_m)
    rejections: list[Rejection] = []
    candidates: list[Item] = []
    for it in sorted(items, key=lambda i: i.id):
        if it.category not in intent.categories:
            continue
        if it.place_id in outside:
            rejections.append(
                Rejection(item_id=it.id, stage="geography", reason=f"{outside[it.place_id]:.0f} m away; radius is {cs.bubble_m:.0f} m")
            )
            continue
        candidates.append(it)
    candidates.sort(key=lambda i: (inside[i.place_id], i.id))
    for it in candidates[config.max_candidates :]:
        rejections.append(Rejection(item_id=it.id, stage="geography", reason="beyond the nearest-candidates cap"))
    return candidates[: config.max_candidates], rejections, inside


def optimize(inp: Inputs, now: datetime, config: OptimizerConfig = OptimizerConfig()) -> Recommendation:
    cs, fc, intent = inp.constraints, inp.forecast, inp.intent
    cur = cs.currency
    places = {p.id: p for p in inp.places}
    items = {i.id: i for i in inp.items}
    for i in inp.items:
        if i.place_id not in places:
            raise ValueError(f"item {i.id} refers to unknown place {i.place_id}")
        if i.price.currency != cur:
            raise ValueError(f"item {i.id} priced in {i.price.currency}, user currency is {cur}")

    # ---- 1. Refuse to act on stale or unverifiable inputs ------------------ #
    try:
        geo.check_fix(inp.fix, now, config.max_fix_age)
    except geo.StaleLocation as e:
        return _empty(Decision.INSUFFICIENT_DATA, [f"Location is not usable: {e}."], inp, now)
    if now >= fc.valid_until:
        return _empty(Decision.INSUFFICIENT_DATA, ["The financial forecast is out of date."], inp, now)
    if fc.unbounded_obligations:
        names = ", ".join(fc.unbounded_obligations)
        return _empty(
            Decision.INSUFFICIENT_DATA,
            [f"Affordability can't be checked until these upcoming expenses are clarified: {names}."],
            inp,
            now,
        )
    if intent.confidence == "low":
        return _empty(Decision.INSUFFICIENT_DATA, ["It isn't clear enough what you're shopping for."], inp, now)

    # ---- 2. Candidates: right kind of item, inside the radius -------------- #
    candidates, rejections, inside = retrieve_candidates(cs, inp.fix, inp.places, inp.items, intent, config)

    # ---- 3. Suitability and hard restrictions (verdicts come from Nemotron) - #
    judged = {j.item_id: j for j in inp.judgements}
    restriction_ids = {r.id for r in cs.restrictions}
    pref_weight = {p.id: p.weight for p in cs.preferences}
    suitable: list[tuple[Item, SuitabilityJudgement]] = []
    unverified_count = 0
    for it in candidates:
        j = judged.get(it.id)
        if j is None or j.verdict is Verdict.UNVERIFIED:
            unverified_count += 1
            why = "no suitability judgement" if j is None else "; ".join(j.reasons) or "not enough evidence"
            rejections.append(Rejection(item_id=it.id, stage="suitability", reason=f"unverified: {why}"))
            continue
        if j.verdict is Verdict.UNSUITABLE:
            rejections.append(Rejection(item_id=it.id, stage="suitability", reason="; ".join(j.reasons) or "does not meet the need"))
            continue
        violated = [r for r in j.violated_restriction_ids if r in restriction_ids]
        if violated:
            rejections.append(Rejection(item_id=it.id, stage="restriction", reason="violates " + ", ".join(violated)))
            continue
        suitable.append((it, j))

    # ---- 4. Hard money limits and pricing ---------------------------------- #
    funds = fc.available_now
    headroom = fc.min_projected_balance_lower - fc.reserve
    priced: list[PricedOption] = []
    money_rejected = 0
    remaining_seen: dict[str, Money] = {}
    for it, j in suitable:
        place = places[it.place_id]
        remaining = budgets.remaining_for(it.category, cs, inp.transactions, now)
        remaining_seen.update(remaining)
        limits: list[tuple[str, str, Money]] = [("funds", "money available now", funds), ("forecast", "projected balance after upcoming bills", headroom)]
        limits += [("budget", f"budget {bid}", rem) for bid, rem in remaining.items()]
        limit = min((lim for _, _, lim in limits), key=lambda m: m.minor)

        oc = pricing.check_offers(it, place, inp.offers, inp.payment_methods, now)
        sel = pricing.select(it, inp.payment_methods, oc.eligible, limit, config.solver_time_limit_s)
        if sel is None:
            money_rejected += 1
            floor = pricing.min_payable(it, inp.payment_methods, oc.eligible, config.solver_time_limit_s)
            floor_m = Money(minor=floor if floor is not None else it.price.minor, currency=cur)
            for stage, label, lim in limits:
                if floor_m > lim:
                    rejections.append(
                        Rejection(item_id=it.id, stage=stage, reason=f"lowest possible payment {floor_m} exceeds {label} ({lim})")
                    )
            continue

        bd = sel.breakdown
        sat = [p for p in j.satisfied_preference_ids if p in pref_weight]
        priced.append(
            PricedOption(
                item_id=it.id,
                place_id=place.id,
                place_name=place.name,
                item_name=it.name,
                distance_m=inside[it.place_id],
                list_price=it.price,
                payment_method_id=sel.method.id,
                applied_offer_ids=[o.id for o in sel.offers],
                instant_discount=Money(minor=bd.instant_discount, currency=cur),
                payable_now=Money(minor=bd.payable_now, currency=cur),
                verified_cashback=Money(minor=bd.verified_cashback, currency=cur),
                effective_cost=Money(minor=bd.effective_cost, currency=cur),
                points=bd.points,
                preference_score=sum(pref_weight[p] for p in sat),
                satisfied_preference_ids=sat,
                unverified_offer_ids=[o.id for o in oc.unverified],
            )
        )

    # ---- 5. Rank: effective cost, then preference fit, then travel --------- #
    ranked = sorted(priced, key=lambda o: (o.effective_cost.minor, -o.preference_score, o.distance_m, o.item_id))

    # ---- 6. Baseline and decision ------------------------------------------ #
    baseline = None
    if intent.anchor_item_id and intent.anchor_item_id in items:
        a = items[intent.anchor_item_id]
        ap = places[a.place_id]
        d = geo.distance_m(inp.fix.lat, inp.fix.lon, ap.lat, ap.lon)
        baseline = baseline_option(a, ap, d, inp.payment_methods)

    reasons: list[str] = []
    if ranked:
        decision = Decision.RECOMMEND
        chosen = ranked[0]
        if baseline and chosen.item_id != baseline.item_id:
            anchor_affordable = any(o.item_id == baseline.item_id for o in ranked)
            if not anchor_affordable:
                reasons.append("Your usual purchase doesn't fit your limits; this alternative does and meets the same need.")
    else:
        chosen = None
        decision = Decision.SKIP
        if money_rejected:
            reasons.append("No suitable option fits your budget and upcoming bills, so skipping is recommended.")
        if unverified_count:
            reasons.append(
                f"{unverified_count} nearby option(s) could not be verified as meeting your need, "
                "so no affordable alternative was verified."
            )
        if not suitable and not unverified_count:
            reasons.append("No nearby option meets the need.")

    savings = None
    if baseline and chosen:
        savings = baseline.effective_cost - chosen.effective_cost

    # ---- 7. Expiry ---------------------------------------------------------- #
    expiries = [inp.fix.timestamp + config.location_ttl, fc.valid_until]
    if chosen:
        by_id = {o.id: o for o in inp.offers}
        expiries += [by_id[oid].expires_at for oid in chosen.applied_offer_ids]

    return Recommendation(
        decision=decision,
        chosen=chosen,
        ranked=ranked,
        rejections=rejections,
        baseline=baseline,
        savings_vs_baseline=savings,
        budget_remaining=remaining_seen,
        reasons=reasons,
        input_versions=input_versions(inp),
        created_at=now,
        expires_at=min(expiries),
    )
