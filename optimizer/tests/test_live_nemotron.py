"""Smoke tests against a real Nemotron endpoint. Skipped unless
NEMOTRON_BASE_URL is set. Run with:  NEMOTRON_BASE_URL=... uv run pytest tests/test_live_nemotron.py -v
"""

import os

import pytest

from optimizer.nemotron import jobs
from optimizer.nemotron.client import NemotronClient

from .factories import intent, item, place
from .test_nemotron import PROFILE, ROUTINE

pytestmark = pytest.mark.skipif(not os.environ.get("NEMOTRON_BASE_URL"), reason="no Nemotron endpoint configured")


@pytest.fixture(scope="module")
def llm():
    return NemotronClient()


def test_live_compile_extracts_quoted_budget(llm):
    cp = jobs.compile_profile(llm, ROUTINE, PROFILE, version="live")
    assert any(b.amount.minor == 6000 for b in cp.constraints.budgets), cp.report.dropped
    assert any("peanut" in r.description.lower() for r in cp.constraints.restrictions)
    assert any(r.purpose == "commute" for r in cp.constraints.routine)


def test_live_judge_rejects_cookie_for_lunch(llm):
    cs = jobs.compile_profile(llm, ROUTINE, PROFILE, version="live").constraints
    p = place("cafe", name="Corner Cafe")
    cookie = item("cookie", "cafe", 300, desc="one chocolate chip cookie")
    wrap = item("veg-wrap", "cafe", 900, desc="grilled vegetable and hummus wrap with side salad")
    js, _ = jobs.judge_suitability(llm, intent(), cs, [(cookie, p), (wrap, p)])
    v = {j.item_id: j.verdict.value for j in js}
    assert v["cookie"] != "suitable"
    assert v["veg-wrap"] == "suitable"


def test_live_pipeline_end_to_end(llm):
    """TEST-ONLY data. Real model for judge and explanation; code for the rest."""
    from optimizer import forecast as fc
    from optimizer.models import Decision
    from optimizer.pipeline import World, run

    from .factories import CARD2, DEBIT, NOW, fix
    from .test_nemotron import BOWL, CHIP

    cp = jobs.compile_profile(llm, ROUTINE, PROFILE, version="live")
    snap = fc.project(cp.facts, NOW, cp.constraints.timezone)
    assert snap is not None
    tacos = place("tacos", 0.003, name="Taco Shop")
    world = World(
        places=[CHIP, tacos],
        items=[BOWL, item("tacos-veg", "tacos", 900, desc="three black bean tacos with salsa")],
        offers=[],
        payment_methods=[DEBIT, CARD2],
        transactions=[],
    )
    res = run(llm, cp.constraints, snap, fix(), world, NOW)
    assert res.recommendation is not None, res.trace
    assert res.recommendation.decision is Decision.RECOMMEND, (res.recommendation.reasons, res.recommendation.rejections)
    assert res.recommendation.chosen.item_id == "tacos-veg"
    assert res.explanation is not None
    print("\nTRACE:", *res.trace, sep="\n  ")
    print("EXPLANATION:", res.explanation.source, "|", res.explanation.headline, "|", res.explanation.body, res.explanation.rejected_reason or "")
