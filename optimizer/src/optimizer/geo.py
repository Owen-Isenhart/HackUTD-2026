"""Distance and the search radius (spec OPT-02).

Distances use Karney's geodesic algorithm on the WGS-84 ellipsoid via
geographiclib, accurate to nanometres. Units are metres everywhere. The radius
boundary is inclusive.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from geographiclib.geodesic import Geodesic

from .models import LocationFix, Place

_WGS84 = Geodesic.WGS84


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return _WGS84.Inverse(lat1, lon1, lat2, lon2, Geodesic.DISTANCE)["s12"]


class StaleLocation(ValueError):
    pass


def check_fix(fix: LocationFix, now: datetime, max_age: timedelta) -> None:
    """Refuse to recommend from an old reading (spec OPT-01: stale fixes are explicit)."""
    age = now - fix.timestamp
    if age > max_age:
        raise StaleLocation(f"location fix is {age} old; limit is {max_age}")
    if age < -timedelta(minutes=1):
        raise StaleLocation(f"location fix is {-age} in the future")


def places_in_bubble(fix: LocationFix, places: list[Place], bubble_m: float) -> tuple[dict[str, float], dict[str, float]]:
    """Split places into (inside, outside), each mapping place id to distance."""
    inside: dict[str, float] = {}
    outside: dict[str, float] = {}
    for p in places:
        d = distance_m(fix.lat, fix.lon, p.lat, p.lon)
        (inside if d <= bubble_m else outside)[p.id] = d
    return inside, outside
