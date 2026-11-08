"""Deterministic purchase intent from the routine.

If the user is at a place their routine names, at a time and weekday the
routine covers, the intent is read straight from the routine. No model is
needed. Nemotron is only asked when this finds nothing (nemotron.jobs.infer_intent).
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from . import geo
from .models import ConstraintSet, Item, LocationFix, Place, PurchaseIntent, RoutineEntry, Weekday

_DAYS = list(Weekday)


def _same_place(entry: RoutineEntry, place: Place) -> bool:
    if entry.merchant_id:
        return entry.merchant_id == place.merchant_id
    return entry.place_name.strip().lower() == place.name.strip().lower()


def _active(entry: RoutineEntry, local: datetime) -> bool:
    return _DAYS[local.weekday()] in entry.days and entry.start <= local.time() <= entry.end


def routine_match(cs: ConstraintSet, fix: LocationFix, places: list[Place], now: datetime, at_place_m: float = 150.0) -> tuple[RoutineEntry, Place] | None:
    """The routine entry for a place the user is at right now, if any."""
    local = now.astimezone(ZoneInfo(cs.timezone))
    for p in sorted(places, key=lambda p: geo.distance_m(fix.lat, fix.lon, p.lat, p.lon)):
        if geo.distance_m(fix.lat, fix.lon, p.lat, p.lon) > at_place_m:
            break
        for e in cs.routine:
            if _same_place(e, p) and _active(e, local):
                return e, p
    return None


def intent_from_routine(entry: RoutineEntry, place: Place, items: list[Item]) -> PurchaseIntent | None:
    """None for commute-type entries: passing by is not shopping (spec 9.1)."""
    if entry.purpose != "purchase":
        return None
    here = [i for i in items if i.place_id == place.id and i.category == entry.category]
    want = entry.typical_item.strip().lower()
    anchor = next((i for i in sorted(here, key=lambda i: i.id) if want and (want in i.name.lower() or i.name.lower() in want)), None)
    return PurchaseIntent(
        categories=[entry.category],
        description=f"{entry.typical_item} at {entry.place_name}",
        anchor_item_id=anchor.id if anchor else None,
        source="routine",
        confidence="high",
        evidence=entry.evidence,
    )
