import asyncio
import re
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from livekit.agents import StopResponse

from src import tools as tool_registry
from src.agent import NessiAgent, session_options
from src.call_state import CallStore
from src.calls_api import create_app
from src.navigation import ROUTES
from src.profiles import PROFILES, PROMPT_DIR, CallContext
from src.settings import load_settings

ENV = {
    "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s-long-enough-secret-value-0123456789",
    "NVIDIA_API_KEY": "n", "LIVEKIT_OUTBOUND_TRUNK_ID": "ST_QwVKCdLTwF7b", "CALLS_API_KEY": "secret",
    "DEMO_ALLOWED_NUMBERS": "+19725550100",
}


def run(coro):
    return asyncio.run(coro)


class NoDial:
    async def dial(self, *a, **k):
        raise AssertionError("must not dial")


def app_agent():
    p = PROFILES["app_voice"]
    return NessiAgent("", "room-1", "alex", profile=p, ctx=CallContext(p.name, "alex", "", True, None))


def test_voice_session_route_is_mounted_and_protected():
    c = TestClient(create_app(load_settings(ENV), NoDial(), CallStore()))
    assert c.post("/voice/session", json={"user_id": "alex"}).status_code == 401
    r = c.post("/voice/session", json={"user_id": "alex"}, headers={"x-api-key": "secret"})
    assert r.status_code == 200 and r.json()["room"].startswith("app-voice-")


def test_app_voice_exposes_navigation_without_live_recommendations():
    assert {t.id for t in app_agent().tools} == {"navigate_app"}


def test_app_prompt_grounds_finance_answers_in_the_knowledge_section():
    text = (PROMPT_DIR / "app_voice.txt").read_text(encoding="utf-8")
    assert "KNOWLEDGE" in text and "don't have that information" in text
    assert "under 30 words" in text
    assert "respond_to_caller" not in text


def test_phone_profiles_never_expose_navigate_app():
    for name in ("onboarding", "phone_details"):
        agent = NessiAgent("s", "r", "u", profile=PROFILES[name])
        assert "navigate_app" not in {t.id for t in agent.tools}


def test_navigate_tool_fails_cleanly_before_the_app_is_bound():
    agent = app_agent()
    tool = next(t for t in agent.tools if t.id == "navigate_app")
    assert run(tool(destination="deals"))["ok"] is False


def test_navigate_tool_sends_the_rpc_once_bound():
    calls = []

    async def perform_rpc(**kw):
        calls.append(kw)
        return "ok"

    room = SimpleNamespace(local_participant=SimpleNamespace(perform_rpc=perform_rpc))
    agent = app_agent()
    agent.bind_app(room, "app-alex")
    tool = next(t for t in agent.tools if t.id == "navigate_app")
    assert run(tool(destination="Deals")) == {"ok": True, "opened": "deals"}
    assert calls[0]["destination_identity"] == "app-alex" and calls[0]["method"] == "navigate"
    assert run(tool(destination="settings"))["ok"] is False and len(calls) == 1


def test_prompt_route_list_matches_the_routes_constant():
    text = (PROMPT_DIR / "app_voice.txt").read_text(encoding="utf-8")
    listed = re.search(r"from this list: ([a-z, ]+)\.", text)
    assert listed, "prompt must list the destinations"
    assert set(re.split(r",\s*", listed.group(1).strip())) == set(ROUTES)


def test_empty_turn_gets_no_reply_in_the_app_but_phone_flow_is_unchanged():
    with pytest.raises(StopResponse):
        run(app_agent().on_user_turn_completed(None, SimpleNamespace(text_content="  ")))
    phone = NessiAgent("s", "r", "u")
    run(phone.on_user_turn_completed(None, SimpleNamespace(text_content="")))  # must not raise


def test_session_options_use_manual_turns_only_for_the_app():
    assert session_options(PROFILES["app_voice"]) == {"turn_handling": {"turn_detection": "manual"}}
    assert session_options(PROFILES["phone_details"]) == {"turn_detection": "stt"}
    assert session_options(PROFILES["onboarding"]) == {"turn_detection": "stt"}


def test_prompt_has_no_concrete_screen_example_the_model_could_parrot():
    text = (PROMPT_DIR / "app_voice.txt").read_text(encoding="utf-8")
    for sample in ("Food, Transport", "Budgets, looking at", "Visible: Food"):
        assert sample not in text, f"concrete example {sample!r} gets copied instead of the real screen"
