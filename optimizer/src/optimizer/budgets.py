"""Budget windows and remaining amounts (spec 7.2, FORECAST-07).

A budget's window is computed in the user's own timezone, so "this month"
means the user's month, not the server's.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from dateutil.relativedelta import relativedelta

from .models import Budget, ConstraintSet, Period, Transaction, Weekday
from .money import Money

_WEEKDAY_INDEX = {d: i for i, d in enumerate(Weekday)}


def window(period: Period, now: datetime, tz: str, week_starts_on: Weekday = Weekday.MON) -> tuple[datetime, datetime]:
    """Half-open [start, end) window containing `now`, in the user's timezone."""
    local = now.astimezone(ZoneInfo(tz))
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    if period is Period.DAY:
        start = midnight
        end = start + relativedelta(days=1)
    elif period is Period.WEEK:
        back = (local.weekday() - _WEEKDAY_INDEX[week_starts_on]) % 7
        start = midnight - relativedelta(days=back)
        end = start + relativedelta(days=7)
    elif period is Period.MONTH:
        start = midnight.replace(day=1)
        end = start + relativedelta(months=1)
    else:
        start = midnight.replace(month=1, day=1)
        end = start + relativedelta(years=1)
    # relativedelta keeps wall-clock time across DST changes, which is what a
    # person means by "this week". Re-attach the zone so offsets are correct.
    zone = ZoneInfo(tz)
    return start.replace(tzinfo=zone), end.replace(tzinfo=zone)


def spent_in_window(budget: Budget, txns: list[Transaction], start: datetime, end: datetime) -> Money:
    total = Money(minor=0, currency=budget.amount.currency)
    for t in txns:
        if start <= t.occurred_at < end and budget.applies_to(t.category):
            total = total + t.amount
    return total


def remaining_for(category: str, cs: ConstraintSet, txns: list[Transaction], now: datetime) -> dict[str, Money]:
    """Remaining amount of every budget that applies to `category`."""
    out: dict[str, Money] = {}
    for b in cs.budgets:
        if not b.applies_to(category):
            continue
        start, end = window(b.period, now, cs.timezone, cs.week_starts_on)
        out[b.id] = b.amount - spent_in_window(b, txns, start, end)
    return out

