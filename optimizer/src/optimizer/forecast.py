"""Minimal deterministic balance projection.

Stand-in for the forecast tasks (FORECAST-05/06) so the optimizer can run from
the financial-profile file. It applies the spec's conservative rules:
- uncertain obligations count at their upper bound;
- an obligation with no upper bound makes affordability unverifiable;
- on the same day, money out is applied before money in.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from dateutil.rrule import MONTHLY, WEEKLY, rrule

from .models import ForecastSnapshot
from .money import Money


@dataclass(frozen=True)
class Recurring:
    description: str
    amount: Money
    cadence: Literal["weekly", "biweekly", "monthly", "once"]
    next_date: date
    evidence: str


@dataclass(frozen=True)
class Obligation:
    description: str
    low: Money | None
    high: Money | None  # None: amount unknown
    due: date | None
    evidence: str


@dataclass(frozen=True)
class FinancialFacts:
    currency: str
    current_balance: Money | None
    reserve: Money
    incomes: list[Recurring] = field(default_factory=list)
    bills: list[Recurring] = field(default_factory=list)
    obligations: list[Obligation] = field(default_factory=list)


def occurrences(r: Recurring, start: date, end: date) -> list[date]:
    """Dates of `r` in [start, end]."""
    if r.cadence == "once":
        return [r.next_date] if start <= r.next_date <= end else []
    freq, interval = {"weekly": (WEEKLY, 1), "biweekly": (WEEKLY, 2), "monthly": (MONTHLY, 1)}[r.cadence]
    rule = rrule(freq, interval=interval, dtstart=datetime.combine(r.next_date, datetime.min.time()), until=datetime.combine(end, datetime.min.time()))
    # Monthly on the 31st: dateutil skips short months, which would hide a bill.
    # Clamp to month end instead by using bymonthday=-1 when the day is > 28.
    if r.cadence == "monthly" and r.next_date.day > 28:
        rule = rrule(MONTHLY, bymonthday=(r.next_date.day, -1), dtstart=datetime.combine(r.next_date, datetime.min.time()), until=datetime.combine(end, datetime.min.time()))
        seen_months: set[tuple[int, int]] = set()
        out = []
        for d in rule:
            key = (d.year, d.month)
            if key not in seen_months:
                seen_months.add(key)
                out.append(d.date())
        return [d for d in out if d >= start]
    return [d.date() for d in rule if d.date() >= start]


def project(facts: FinancialFacts, now: datetime, tz: str, horizon_days: int = 30, valid_for: timedelta = timedelta(hours=6)) -> ForecastSnapshot | None:
    """None if there is no current balance to project from."""
    if facts.current_balance is None:
        return None
    cur = facts.currency
    today = now.astimezone(ZoneInfo(tz)).date()
    end = today + timedelta(days=horizon_days)

    events: list[tuple[date, int, int]] = []  # (day, order: 0 out / 1 in, delta)
    for b in facts.bills:
        events += [(d, 0, -b.amount.minor) for d in occurrences(b, today, end)]
    for i in facts.incomes:
        events += [(d, 1, i.amount.minor) for d in occurrences(i, today, end)]
    unbounded = []
    for o in facts.obligations:
        if o.due is not None and not (today <= o.due <= end):
            continue
        if o.high is None:
            unbounded.append(o.description)
            continue
        events.append((o.due or today, 0, -o.high.minor))

    bal = facts.current_balance.minor
    low = bal
    for _, _, delta in sorted(events):
        bal += delta
        low = min(low, bal)

    blob = json.dumps(asdict(facts), default=str, sort_keys=True) + today.isoformat()
    return ForecastSnapshot(
        version="proj-" + hashlib.sha256(blob.encode()).hexdigest()[:12],
        as_of=now,
        valid_until=now + valid_for,
        horizon_days=horizon_days,
        available_now=facts.current_balance,
        min_projected_balance_lower=Money(minor=low, currency=cur),
        reserve=facts.reserve,
        unbounded_obligations=unbounded,
    )
