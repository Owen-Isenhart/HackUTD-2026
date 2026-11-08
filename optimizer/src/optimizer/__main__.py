"""Command line.

    python -m optimizer compile   --routine R.md --profile P.md
    python -m optimizer recommend --routine R.md --profile P.md --world world.json \
        --lat 32.98 --lon -96.75 [--source demo] [--now 2026-11-10T12:00:00-06:00] [--intent "lunch"]

Nemotron settings come from NEMOTRON_BASE_URL / NEMOTRON_MODEL / NEMOTRON_API_KEY.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from pydantic import TypeAdapter

from . import forecast as fc
from .models import Item, LocationFix, Offer, PaymentMethod, Place, Transaction
from .nemotron.client import NemotronClient
from .pipeline import World, load_profile, run

CACHE = Path(".cache/profiles")


def load_world(path: Path) -> World:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return World(
        places=TypeAdapter(list[Place]).validate_python(raw.get("places", [])),
        items=TypeAdapter(list[Item]).validate_python(raw.get("items", [])),
        offers=TypeAdapter(list[Offer]).validate_python(raw.get("offers", [])),
        payment_methods=TypeAdapter(list[PaymentMethod]).validate_python(raw.get("payment_methods", [])),
        transactions=TypeAdapter(list[Transaction]).validate_python(raw.get("transactions", [])),
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="optimizer")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("compile", "recommend"):
        p = sub.add_parser(name)
        p.add_argument("--routine", type=Path, required=True)
        p.add_argument("--profile", type=Path, required=True)
        p.add_argument("--no-cache", action="store_true")
    r = sub.choices["recommend"]
    r.add_argument("--world", type=Path, required=True)
    r.add_argument("--lat", type=float, required=True)
    r.add_argument("--lon", type=float, required=True)
    r.add_argument("--accuracy", type=float, default=10.0)
    r.add_argument("--source", choices=["live", "demo"], default="demo")
    r.add_argument("--now", type=datetime.fromisoformat, default=None)
    r.add_argument("--intent", default=None, help="What the user said they want, if anything.")
    a = ap.parse_args(argv)

    llm = NemotronClient()
    compiled = load_profile(llm, a.routine, a.profile, None if a.no_cache else CACHE)
    cs = compiled.constraints
    if a.cmd == "compile":
        print(json.dumps({"constraints": cs.model_dump(mode="json"), "dropped": compiled.report.dropped, "accepted": compiled.report.accepted}, indent=2))
        return 0

    now = a.now or datetime.now(timezone.utc)
    snapshot = fc.project(compiled.facts, now, cs.timezone)
    if snapshot is None:
        print("The financial profile has no current balance, so affordability cannot be checked.", file=sys.stderr)
        return 2
    fix = LocationFix(lat=a.lat, lon=a.lon, accuracy_m=a.accuracy, timestamp=now, source=a.source)
    res = run(llm, cs, snapshot, fix, load_world(a.world), now, stated_intent=a.intent)
    out = {
        "trace": res.trace,
        "intent": res.intent.model_dump(mode="json") if res.intent else None,
        "explanation": res.explanation.__dict__ if res.explanation else None,
        "recommendation": res.recommendation.model_dump(mode="json") if res.recommendation else None,
    }
    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
