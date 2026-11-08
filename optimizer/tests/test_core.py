"""Money, geography and budget-window tests (OPT-02, FORECAST-07, QA-01)."""

from datetime import datetime, timezone

import pytest

from optimizer import budgets, geo
from optimizer.models import Budget, Period, Transaction
from optimizer.money import CurrencyMismatch, Money, dollar_amounts_in, format_minor, parse_amount

from .factories import NOW, constraints, usd


def test_money_is_integer_and_currency_checked():
    assert (usd(1050) + usd(5)).minor == 1055
    with pytest.raises(CurrencyMismatch):
        usd(1) + Money(minor=1, currency="EUR")


@pytest.mark.parametrize(
    "text,minor",
    [("$200", 20000), ("$1,234.5", 123450), ("12.99 USD", 1299), ("USD 7", 700), ("$0.05", 5)],
)
def test_parse_amount(text, minor):
    assert parse_amount(text).minor == minor


def test_parse_amount_rejects_ambiguous():
    with pytest.raises(ValueError):
        parse_amount("$5 or $6")
    with pytest.raises(ValueError):
        parse_amount("about fifty dollars")


def test_dollar_amounts_and_format():
    assert dollar_amounts_in("Pay $11.20 now, get $1.30 back, total $1,000") == [1120, 130, 100000]
    assert format_minor(-1234) == "-$12.34"


def test_distance_known_value_and_inclusive_boundary():
    # One degree of latitude at the equator is 110,574.4 m on WGS-84.
    assert geo.distance_m(0, 0, 1, 0) == pytest.approx(110_574.4, abs=0.5)
    from .factories import fix, place

    p = place("edge", dlat=0.01)
    d = geo.distance_m(fix().lat, fix().lon, p.lat, p.lon)
    inside, outside = geo.places_in_bubble(fix(), [p], bubble_m=d)
    assert "edge" in inside and not outside
    inside, outside = geo.places_in_bubble(fix(), [p], bubble_m=d - 0.01)
    assert "edge" in outside


def test_month_window_uses_user_timezone():
    # 03:00 UTC on 1 Nov is still 31 Oct (22:00) in Chicago, so it is October spend.
    b = Budget(id="b", scope_categories=["lunch"], period=Period.MONTH, amount=usd(10_000), evidence="t")
    cs = constraints(budget_cents=None, budgets=[b])
    txns = [
        Transaction(id="oct", amount=usd(4000), occurred_at=datetime(2026, 11, 1, 3, 0, tzinfo=timezone.utc), category="lunch"),
        Transaction(id="nov", amount=usd(1500), occurred_at=datetime(2026, 11, 2, 18, 0, tzinfo=timezone.utc), category="lunch"),
        Transaction(id="other", amount=usd(999), occurred_at=datetime(2026, 11, 2, 18, 0, tzinfo=timezone.utc), category="fuel"),
    ]
    assert budgets.remaining_for("lunch", cs, txns, NOW)["b"].minor == 10_000 - 1500


def test_week_window_starts_monday_local():
    # NOW is Tue 10 Nov 12:00 in Chicago, so the week runs Mon 9 Nov 00:00 to Mon 16 Nov.
    start, end = budgets.window(Period.WEEK, NOW, "America/Chicago")
    assert (start.year, start.month, start.day, start.hour) == (2026, 11, 9, 0)
    assert (end - start).days == 7
