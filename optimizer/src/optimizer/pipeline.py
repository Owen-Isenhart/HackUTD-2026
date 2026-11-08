"""Glue: routine/profile files + world data + location -> recommendation.

    profile files --Nemotron compile (cached)--> constraints + money facts
    money facts   --forecast.project---------->  forecast snapshot
    location      --routine match, else Nemotron intent--> purchase intent
    candidates    --Nemotron judge------------>  suitability verdicts
    everything    --engine.optimize----------->  recommendation   (no model)
    recommendation--Nemotron explain + check-->  notification text
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from pydantic import TypeAdapter

from . import forecast as fc
from . import geo
from .engine import Inputs, OptimizerConfig, optimize, retrieve_candidates
from .intent import intent_from_routine, routine_match
from .models import (
    ConstraintSet,
    Decision,
    ForecastSnapshot,
    Item,
    LocationFix,
    Offer,
    PaymentMethod,
    Place,
    PurchaseIntent,
    Recommendation,
    SuitabilityJudgement,
    Transaction,
)
from .nemotron.client import LLM
from .nemotron.jobs import CompiledProfile, CompileReport, Explanation, compile_profile, explain, infer_intent, judge_suitability


# --------------------------------------------------------------------------- #
# Profile loading with a content-addressed cache
# --------------------------------------------------------------------------- #

_FACTS = TypeAdapter(fc.FinancialFacts)


def profile_digest(routine_md: str, profile_md: str) -> str:
    return hashlib.sha256((routine_md + "\x00" + profile_md).encode()).hexdigest()[:16]


def load_profile(llm: LLM, routine_path: Path, profile_path: Path, cache_dir: Path | None = None, **kw) -> CompiledProfile:
    routine_md = routine_path.read_text(encoding="utf-8")
    profile_md = profile_path.read_text(encoding="utf-8")
    version = "profile-" + profile_digest(routine_md, profile_md)
    if cache_dir:
        hit = cache_dir / f"{version}.json"
        if hit.exists():
            import json

            raw = json.loads(hit.read_text(encoding="utf-8"))
            return CompiledProfile(ConstraintSet.model_validate(raw["constraints"]), _FACTS.validate_python(raw["facts"]), CompileReport(**raw["report"]))
    compiled = compile_profile(llm, routine_md, profile_md, version=version, **kw)
    if cache_dir:
        import json

        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / f"{version}.json").write_text(
            json.dumps(
                {
                    "constraints": compiled.constraints.model_dump(mode="json"),
                    "facts": _FACTS.dump_python(compiled.facts, mode="json"),
                    "report": {"accepted": compiled.report.accepted, "dropped": compiled.report.dropped, "reasoning": None},
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    return compiled


# --------------------------------------------------------------------------- #
# One recommendation
# --------------------------------------------------------------------------- #


@dataclass
class World:
    places: list[Place]
    items: list[Item]
    offers: list[Offer]
    payment_methods: list[PaymentMethod]
    transactions: list[Transaction]


@dataclass
class PipelineResult:
    recommendation: Recommendation | None
    explanation: Explanation | None
    intent: PurchaseIntent | None
    judgements: list[SuitabilityJudgement] = field(default_factory=list)
    trace: list[str] = field(default_factory=list)  # which step did what, for the demo and audit


def run(
    llm: LLM,
    cs: ConstraintSet,
    forecast: ForecastSnapshot,
    fix: LocationFix,
    world: World,
    now: datetime,
    stated_intent: str | None = None,
    config: OptimizerConfig = OptimizerConfig(),
) -> PipelineResult:
    trace: list[str] = []

    # ---- intent ------------------------------------------------------------ #
    intent: PurchaseIntent | None = None
    if stated_intent:
        trace.append("intent: Nemotron (thinking off) from what the user said")
        intent = infer_intent(llm, cs, _local(now, cs), _nearby(fix, world, cs), stated_intent)
    else:
        m = routine_match(cs, fix, world.places, now)
        if m:
            entry, place = m
            intent = intent_from_routine(entry, place, world.items)
            if intent is None:
                trace.append(f"intent: routine says '{entry.evidence}' is a {entry.purpose}, so no recommendation")
                return PipelineResult(None, None, None, trace=trace)
            trace.append(f"intent: code, from routine entry {entry.id}")
        else:
            nearby = _nearby(fix, world, cs)
            if not nearby:
                trace.append("intent: nothing nearby")
                return PipelineResult(None, None, None, trace=trace)
            trace.append("intent: Nemotron (thinking off), no routine entry matched")
            intent = infer_intent(llm, cs, _local(now, cs), nearby)

    # ---- suitability ------------------------------------------------------- #
    judgements: list[SuitabilityJudgement] = []
    if intent.confidence != "low":
        cands, _, _ = retrieve_candidates(cs, fix, world.places, world.items, intent, config)
        if cands:
            by_place = {p.id: p for p in world.places}
            judgements, rep = judge_suitability(llm, intent, cs, [(i, by_place[i.place_id]) for i in cands])
            mode = "thinking on" if any(rep.thinking_used) else "thinking off"
            trace.append(f"suitability: Nemotron ({mode}) judged {len(cands)} items; {len(rep.downgraded)} downgraded by checks")
            trace += [f"  downgraded {d}" for d in rep.downgraded]

    # ---- optimisation (no model) ------------------------------------------- #
    inp = Inputs(cs, forecast, fix, world.places, world.items, world.offers, world.payment_methods, world.transactions, intent, judgements)
    rec = optimize(inp, now, config)
    trace.append(f"optimizer: code (CP-SAT), decision {rec.decision.value}, {len(rec.ranked)} ranked, {len(rec.rejections)} rejected")

    # ---- explanation ------------------------------------------------------- #
    ex = explain(llm, rec)
    trace.append(
        "explanation: Nemotron (thinking off), numbers verified"
        if ex.source == "nemotron"
        else f"explanation: template ({ex.rejected_reason or 'not needed'})"
    )
    return PipelineResult(rec, ex, intent, judgements, trace)


def _local(now: datetime, cs: ConstraintSet) -> str:
    from zoneinfo import ZoneInfo

    return now.astimezone(ZoneInfo(cs.timezone)).strftime("%A %H:%M")


def _nearby(fix: LocationFix, world: World, cs: ConstraintSet, limit: int = 5) -> list[tuple[Place, list[Item]]]:
    inside, _ = geo.places_in_bubble(fix, world.places, cs.bubble_m)
    near = sorted(inside, key=inside.get)[:limit]
    by_id = {p.id: p for p in world.places}
    return [(by_id[pid], [i for i in world.items if i.place_id == pid]) for pid in near]


def decision_needs_user(rec: Recommendation | None) -> bool:
    return rec is not None and rec.decision is Decision.INSUFFICIENT_DATA
