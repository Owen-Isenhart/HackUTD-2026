"""Money as whole minor units (cents) plus a currency code.

The spec (context.md, "Recommendation and forecast semantics") requires integer
minor-unit money with currency. Floats never appear in money arithmetic here.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field


class CurrencyMismatch(ValueError):
    pass


class Money(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    minor: int = Field(description="Amount in minor units, e.g. cents.")
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")

    def _check(self, other: Money) -> None:
        if self.currency != other.currency:
            raise CurrencyMismatch(f"{self.currency} vs {other.currency}")

    def __add__(self, other: Money) -> Money:
        self._check(other)
        return Money(minor=self.minor + other.minor, currency=self.currency)

    def __sub__(self, other: Money) -> Money:
        self._check(other)
        return Money(minor=self.minor - other.minor, currency=self.currency)

    def __lt__(self, other: Money) -> bool:
        self._check(other)
        return self.minor < other.minor

    def __le__(self, other: Money) -> bool:
        self._check(other)
        return self.minor <= other.minor

    def __gt__(self, other: Money) -> bool:
        self._check(other)
        return self.minor > other.minor

    def __ge__(self, other: Money) -> bool:
        self._check(other)
        return self.minor >= other.minor

    def __str__(self) -> str:
        return format_minor(self.minor, self.currency)


def zero(currency: str = "USD") -> Money:
    return Money(minor=0, currency=currency)


def format_minor(minor: int, currency: str = "USD") -> str:
    sign = "-" if minor < 0 else ""
    whole, cents = divmod(abs(minor), 100)
    symbol = "$" if currency == "USD" else f"{currency} "
    return f"{sign}{symbol}{whole:,}.{cents:02d}"


# Matches "$1,234.56", "$12", "12.50 USD", "USD 12.50". Used to turn amounts
# quoted by Nemotron into integers in code, so the model never does arithmetic.
_AMOUNT = re.compile(
    r"(?:\$\s?|USD\s?)?(?P<whole>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?P<frac>\d{1,2}))?(?:\s?USD)?"
)


def parse_amount(text: str, currency: str = "USD") -> Money:
    """Parse exactly one money amount from text. Raises ValueError otherwise."""
    matches = [m for m in _AMOUNT.finditer(text) if m.group(0).strip()]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one amount in {text!r}, found {len(matches)}")
    m = matches[0]
    whole = int(m.group("whole").replace(",", ""))
    frac = (m.group("frac") or "0").ljust(2, "0")
    return Money(minor=whole * 100 + int(frac), currency=currency)


_DOLLARS_IN_PROSE = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?!\d)")


def dollar_amounts_in(text: str) -> list[int]:
    """Every "$x" or "$x.yy" amount in prose, as minor units."""
    out = []
    for whole, frac in _DOLLARS_IN_PROSE.findall(text):
        out.append(int(whole.replace(",", "")) * 100 + int(frac or "0"))
    return out
