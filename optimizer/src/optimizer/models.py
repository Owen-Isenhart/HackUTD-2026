"""Typed inputs and outputs of the optimizer.

Field names follow the data contracts in context.md section 14. Everything is
frozen and rejects unknown fields, so a malformed input fails loudly instead of
being half-read.
"""

from __future__ import annotations

from datetime import datetime, time
from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from .money import Money


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# --------------------------------------------------------------------------- #
# World: where the user is and what is around them
# --------------------------------------------------------------------------- #


class LocationFix(Frozen):
    """One location reading. Live GPS and the demo's dragged marker share this
    shape, so both go through the same pipeline (spec DEMO-01)."""

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0)
    timestamp: AwareDatetime
    source: Literal["live", "demo"]


class Place(Frozen):
    id: str
    name: str
    merchant_id: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    categories: list[str] = []


class Item(Frozen):
    """Something purchasable at a place, with a supported price."""

    id: str
    place_id: str
    name: str
    description: str = ""
    category: str
    price: Money
    price_observed_at: AwareDatetime
    price_source: str


class PaymentMethod(Frozen):
    id: str
    name: str
    kind: Literal["debit", "credit", "cash"]
    base_cashback_bps: int = Field(default=0, ge=0, le=10_000, description="Card's own cashback, basis points.")
    points_program: str | None = None
    points_per_dollar: int = Field(default=0, ge=0, description="Whole points per whole dollar paid.")
    is_default: bool = False


class OfferKind(StrEnum):
    AMOUNT_OFF = "amount_off"  # value = minor units off the price, paid now
    PERCENT_OFF = "percent_off"  # value = basis points off the price, paid now
    CASHBACK_AMOUNT = "cashback_amount"  # value = minor units returned later
    CASHBACK_PERCENT = "cashback_percent"  # value = basis points of payable, returned later
    POINTS_FLAT = "points_flat"  # value = points
    POINTS_PER_DOLLAR = "points_per_dollar"  # value = points per whole dollar paid


class Offer(Frozen):
    id: str
    source: str
    merchant_id: str
    terms_text: str
    kind: OfferKind
    value: int = Field(ge=0)
    points_program: str | None = None
    min_spend: Money | None = None
    max_benefit: Money | None = None
    starts_at: AwareDatetime | None = None
    expires_at: AwareDatetime
    required_payment_method_ids: list[str] = Field(default_factory=list, description="Empty means any method.")
    eligible_item_categories: list[str] = Field(default_factory=list, description="Empty means all.")
    eligible_item_ids: list[str] = Field(default_factory=list, description="Empty means all.")
    requires_activation: bool = False
    activated: bool = False
    stack_group: str | None = Field(default=None, description="At most one offer per group may apply.")
    stackable: bool = Field(default=True, description="False means it must be the only offer applied.")
    verified: bool = Field(description="Terms are complete and evidenced (REWARD-04). Unverified offers never count as savings.")
    cashback_delay_days: int = Field(default=0, ge=0)


class Transaction(Frozen):
    id: str
    amount: Money
    occurred_at: AwareDatetime
    category: str
    merchant_id: str | None = None


# --------------------------------------------------------------------------- #
# The user: constraints compiled from the routine and financial-profile files
# --------------------------------------------------------------------------- #


class Period(StrEnum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"


class Budget(Frozen):
    """A hard spending limit the user stated (spec 7.2: budgets are hard)."""

    id: str
    all_spending: bool = False
    scope_categories: list[str] = []
    period: Period
    amount: Money
    version: int = 1
    evidence: str

    @model_validator(mode="after")
    def _scope(self) -> Budget:
        if not self.all_spending and not self.scope_categories:
            raise ValueError("budget needs all_spending or at least one category")
        return self

    def applies_to(self, category: str) -> bool:
        return self.all_spending or category in self.scope_categories


class Preference(Frozen):
    """Soft: affects ranking only."""

    id: str
    description: str
    applies_to_categories: list[str] = []
    weight: int = Field(ge=1, le=5)
    stated_explicitly: bool
    evidence: str


class Restriction(Frozen):
    """Hard: a candidate violating it is rejected."""

    id: str
    description: str
    applies_to_categories: list[str] = []
    evidence: str


class Weekday(StrEnum):
    MON = "mon"
    TUE = "tue"
    WED = "wed"
    THU = "thu"
    FRI = "fri"
    SAT = "sat"
    SUN = "sun"


class RoutineEntry(Frozen):
    id: str
    place_name: str
    merchant_id: str | None = None
    days: list[Weekday]
    start: time
    end: time
    category: str
    typical_item: str
    typical_spend_low: Money | None = None
    typical_spend_high: Money | None = None
    purpose: Literal["purchase", "commute", "other"] = "purchase"
    evidence: str


class PendingConfirmation(Frozen):
    """Something Nemotron inferred but the user never stated. Not enforced
    until confirmed (spec 8.3: distinguish stated from inferred)."""

    kind: Literal["budget", "restriction"]
    description: str
    evidence: str


class ConstraintSet(Frozen):
    version: str
    currency: str = "USD"
    timezone: str
    week_starts_on: Weekday = Weekday.MON
    bubble_m: float = Field(gt=0, description="Search radius in metres.")
    budgets: list[Budget] = []
    preferences: list[Preference] = []
    restrictions: list[Restriction] = []
    routine: list[RoutineEntry] = []
    pending_confirmation: list[PendingConfirmation] = []


class ForecastSnapshot(Frozen):
    """Output of the forecast. Lower bounds already include the upper bound of
    every uncertain obligation that has bounds."""

    version: str
    as_of: AwareDatetime
    valid_until: AwareDatetime
    horizon_days: int = Field(gt=0)
    available_now: Money
    min_projected_balance_lower: Money
    reserve: Money
    unbounded_obligations: list[str] = Field(
        default_factory=list,
        description="Obligations with no amount bounds yet. Any entry makes affordability unverifiable.",
    )


class PurchaseIntent(Frozen):
    categories: list[str] = Field(min_length=1)
    description: str
    anchor_item_id: str | None = Field(default=None, description="The item the user would buy by default; the baseline.")
    source: Literal["routine", "nemotron", "user"]
    confidence: Literal["high", "medium", "low"]
    evidence: str


class Verdict(StrEnum):
    SUITABLE = "suitable"
    UNSUITABLE = "unsuitable"
    UNVERIFIED = "unverified"


class SuitabilityJudgement(Frozen):
    item_id: str
    verdict: Verdict
    reasons: list[str]
    satisfied_preference_ids: list[str] = []
    violated_restriction_ids: list[str] = []


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #


class Decision(StrEnum):
    RECOMMEND = "recommend"
    SKIP = "skip"
    INSUFFICIENT_DATA = "insufficient_data"


class PricedOption(Frozen):
    """The cheapest valid way to buy one item: which card and which offers."""

    item_id: str
    place_id: str
    place_name: str
    item_name: str
    distance_m: float
    list_price: Money
    payment_method_id: str
    applied_offer_ids: list[str]
    instant_discount: Money
    payable_now: Money
    verified_cashback: Money
    effective_cost: Money
    points: dict[str, int] = Field(default_factory=dict, description="Unvalued points, shown separately.")
    preference_score: int
    satisfied_preference_ids: list[str] = []
    unverified_offer_ids: list[str] = Field(default_factory=list, description="Shown but not counted.")


class Rejection(Frozen):
    item_id: str
    stage: Literal["geography", "suitability", "restriction", "offer", "budget", "funds", "forecast"]
    reason: str


class Recommendation(Frozen):
    decision: Decision
    chosen: PricedOption | None
    ranked: list[PricedOption]
    rejections: list[Rejection]
    baseline: PricedOption | None = Field(description="The anchor item at list price with the default card.")
    savings_vs_baseline: Money | None
    budget_remaining: dict[str, Money]
    reasons: list[str]
    input_versions: dict[str, str]
    created_at: datetime
    expires_at: datetime
