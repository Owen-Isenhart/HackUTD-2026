"""TEST-ONLY data builders. Nothing here may feed a demo (spec 12.1)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from optimizer.engine import Inputs
from optimizer.models import (
    Budget,
    ConstraintSet,
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
    Verdict,
)
from optimizer.money import Money

NOW = datetime(2026, 11, 10, 18, 0, tzinfo=timezone.utc)  # Tue 12:00 in Chicago
HERE = (32.9857, -96.7502)  # UT Dallas, test coordinates only


def usd(cents: int) -> Money:
    return Money(minor=cents, currency="USD")


def place(pid: str, dlat: float = 0.001, name: str | None = None) -> Place:
    return Place(id=pid, name=name or pid.title(), merchant_id=f"m-{pid}", lat=HERE[0] + dlat, lon=HERE[1], categories=["food"])


def item(iid: str, pid: str, cents: int, category: str = "lunch", desc: str = "") -> Item:
    return Item(
        id=iid,
        place_id=pid,
        name=iid.replace("-", " "),
        description=desc,
        category=category,
        price=usd(cents),
        price_observed_at=NOW - timedelta(hours=1),
        price_source="test",
    )


def offer(oid: str, pid: str, kind: OfferKind, value: int, **kw) -> Offer:
    base = dict(
        id=oid,
        source="test",
        merchant_id=f"m-{pid}",
        terms_text=f"test offer {oid}",
        kind=kind,
        value=value,
        expires_at=NOW + timedelta(days=3),
        verified=True,
    )
    base.update(kw)
    return Offer(**base)


DEBIT = PaymentMethod(id="debit", name="Debit", kind="debit", is_default=True)
CARD2 = PaymentMethod(id="card-2pct", name="2% card", kind="credit", base_cashback_bps=200)


def constraints(budget_cents: int | None = 2000, bubble_m: float = 1500, **kw) -> ConstraintSet:
    budgets = kw.pop("budgets", [])
    if budget_cents is not None:
        budgets.append(
            Budget(id="b-lunch", scope_categories=["lunch"], period=Period.WEEK, amount=usd(budget_cents), evidence="test")
        )
    return ConstraintSet(
        version="test-1",
        timezone="America/Chicago",
        bubble_m=bubble_m,
        budgets=budgets,
        preferences=kw.pop("preferences", [Preference(id="p-veg", description="likes vegetarian", weight=3, stated_explicitly=True, evidence="test")]),
        restrictions=kw.pop("restrictions", [Restriction(id="r-nuts", description="nut allergy", evidence="test")]),
        **kw,
    )


def forecast(now_cents: int = 50_000, low_cents: int = 40_000, reserve: int = 0, **kw) -> ForecastSnapshot:
    return ForecastSnapshot(
        version="f-1",
        as_of=NOW - timedelta(minutes=5),
        valid_until=NOW + timedelta(hours=6),
        horizon_days=30,
        available_now=usd(now_cents),
        min_projected_balance_lower=usd(low_cents),
        reserve=usd(reserve),
        **kw,
    )


def fix(**kw) -> LocationFix:
    base = dict(lat=HERE[0], lon=HERE[1], accuracy_m=10, timestamp=NOW - timedelta(seconds=30), source="demo")
    base.update(kw)
    return LocationFix(**base)


def intent(anchor: str | None = None, confidence="high") -> PurchaseIntent:
    return PurchaseIntent(categories=["lunch"], description="weekday lunch", anchor_item_id=anchor, source="routine", confidence=confidence, evidence="test")


def ok(iid: str, prefs=(), violated=()) -> SuitabilityJudgement:
    return SuitabilityJudgement(item_id=iid, verdict=Verdict.SUITABLE, reasons=["test"], satisfied_preference_ids=list(prefs), violated_restriction_ids=list(violated))


def bad(iid: str, verdict=Verdict.UNSUITABLE, reason="not the same need") -> SuitabilityJudgement:
    return SuitabilityJudgement(item_id=iid, verdict=verdict, reasons=[reason])


def inputs(**kw) -> Inputs:
    base = dict(
        constraints=constraints(),
        forecast=forecast(),
        fix=fix(),
        places=[],
        items=[],
        offers=[],
        payment_methods=[DEBIT, CARD2],
        transactions=[],
        intent=intent(),
        judgements=[],
    )
    base.update(kw)
    return Inputs(**base)
