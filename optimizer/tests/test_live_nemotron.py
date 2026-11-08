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
