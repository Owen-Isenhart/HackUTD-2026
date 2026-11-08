import asyncio
from types import SimpleNamespace

import pytest
from livekit.agents import StopResponse

from src.agent import NessiAgent
from src.navigation import match_destination
from src.profiles import PROFILES, CallContext


def run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("text,dest", [
    ("open deals", "deals"),
    ("Open the spending page.", "spending"),
    ("go to my account", "account"),
    ("Show me upcoming", "upcoming"),
    ("take me to the deal page", "deals"),
    ("navigate to account screen", "account"),
    ("please open spending", "spending"),
    ("Can you open the upcoming?", "upcoming"),
    ("switch to deals tab", "deals"),
])
def test_clear_navigation_requests_are_matched(text, dest):
    assert match_destination(text) == dest


@pytest.mark.parametrize("text", [
    "", "open", "what's in my budget", "open the settings", "open the budgets", "I want to open an account",
    "go to the store", "show me my spending habits", "open the deals page and delete everything",
    "tell me about the forecast", "deals",
])
def test_everything_else_is_left_to_the_model(text):
    assert match_destination(text) is None


def app_agent(monkeypatch, rpc, bound=True):
    p = PROFILES["app_voice"]
    agent = NessiAgent("", "room-1", "alex", profile=p, ctx=CallContext(p.name, "alex", "", True, None))
    if bound:
        agent.bind_app(SimpleNamespace(local_participant=SimpleNamespace(perform_rpc=rpc)), "app-alex")
    spoken = []
    monkeypatch.setattr(NessiAgent, "session", property(lambda _: SimpleNamespace(say=lambda t, **k: spoken.append(t))))
    return agent, spoken


def test_a_clear_request_navigates_without_asking_the_model(monkeypatch):
    calls = []

    async def rpc(**kw):
        calls.append(kw)
        return "ok"

    agent, spoken = app_agent(monkeypatch, rpc)
    with pytest.raises(StopResponse):
        run(agent.on_user_turn_completed(None, SimpleNamespace(text_content="Open the deals page")))
    assert [c["payload"] for c in calls] == ['{"route": "deals"}'] and spoken == ["Opening Deals."]


def test_a_failed_navigation_is_reported_honestly_not_claimed(monkeypatch):
    async def rpc(**kw):
        raise RuntimeError("app not ready")

    agent, spoken = app_agent(monkeypatch, rpc)
    with pytest.raises(StopResponse):
        run(agent.on_user_turn_completed(None, SimpleNamespace(text_content="open deals")))
    assert spoken == ["I couldn't open that page."]


def test_not_connected_app_is_reported_not_claimed(monkeypatch):
    agent, spoken = app_agent(monkeypatch, None, bound=False)
    with pytest.raises(StopResponse):
        run(agent.on_user_turn_completed(None, SimpleNamespace(text_content="open deals")))
    assert spoken == ["I couldn't open that page."]


def test_other_requests_and_phone_profiles_are_unaffected(monkeypatch):
    async def rpc(**kw):
        raise AssertionError("must not navigate")

    agent, spoken = app_agent(monkeypatch, rpc)
    run(agent.on_user_turn_completed(None, SimpleNamespace(text_content="what is in my spending")))  # no raise
    phone = NessiAgent("s", "r", "u")
    run(phone.on_user_turn_completed(None, SimpleNamespace(text_content="open deals")))  # phone: no navigation
    assert spoken == []
