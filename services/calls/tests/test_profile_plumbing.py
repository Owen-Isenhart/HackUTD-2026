import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from src import recommend
from src.agent import NessiAgent
from src.call_state import CallStore
from src.calls_api import create_app
from src.livekit_dialer import LiveKitDialer
from src.profiles import PROFILES, CallContext
from src.settings import load_settings

ENV = {
    "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s",
    "NVIDIA_API_KEY": "n", "LIVEKIT_OUTBOUND_TRUNK_ID": "ST_QwVKCdLTwF7b", "CALLS_API_KEY": "secret",
    "DEMO_ALLOWED_NUMBERS": "+19725550100",
}
H = {"x-api-key": "secret"}


def run(coro):
    return asyncio.run(coro)


class ProfileDialer:
    def __init__(self):
        self.calls = []

    async def dial(self, room_name, to_number, scenario=None, user_id="demo-user", *, call_id=None,
                   profile="phone_details", identity_verified=False):
        self.calls.append({"profile": profile, "identity_verified": identity_verified, "user_id": user_id})


def client(dialer):
    return TestClient(create_app(load_settings(ENV), dialer, CallStore()))


def post(c, body):
    return c.post("/calls", json={"to_number": "+19725550100", **body}, headers=H)


def test_default_request_reaches_the_phone_details_dialer():
    d = ProfileDialer()
    assert post(client(d), {}).status_code == 200
    assert d.calls == [{"profile": "phone_details", "identity_verified": False, "user_id": "demo-user"}]


def test_onboarding_reaches_the_dialer_without_preverification():
    d = ProfileDialer()
    assert post(client(d), {"profile": "onboarding", "user_id": "alex"}).status_code == 200
    assert d.calls == [{"profile": "onboarding", "identity_verified": False, "user_id": "alex"}]


@pytest.mark.parametrize("profile", ["app_voice", "admin", ""])
def test_app_voice_and_unknown_profiles_are_rejected_without_dialing(profile):
    d = ProfileDialer()
    assert post(client(d), {"profile": profile}).status_code == 422 and d.calls == []


class FakeLK:
    instances = []

    def __init__(self, *a):
        self.dispatches = []
        FakeLK.instances.append(self)
        outer = self

        class Dispatch:
            async def create_dispatch(self, req):
                outer.dispatches.append(json.loads(req.metadata))

        class Sip:
            async def create_sip_participant(self, req):
                return None

        self.agent_dispatch, self.sip = Dispatch(), Sip()

    async def aclose(self):
        pass


def dispatch_metadata(monkeypatch, **kw):
    FakeLK.instances.clear()
    monkeypatch.setattr("src.livekit_dialer.api.LiveKitAPI", FakeLK)
    run(LiveKitDialer(load_settings(ENV)).dial("r1", "+19725550100", "scn", "alex", **kw))
    return FakeLK.instances[0].dispatches[0]


def test_dispatch_metadata_carries_the_profile_and_callee(monkeypatch):
    assert dispatch_metadata(monkeypatch) == {
        "user_id": "alex", "scenario": "scn", "profile": "phone_details",
        "identity_verified": False, "phone_number": "+19725550100"}
    assert dispatch_metadata(monkeypatch, profile="onboarding") == {
        "user_id": "alex", "scenario": "scn", "profile": "onboarding",
        "identity_verified": False, "phone_number": "+19725550100"}


def test_payload_includes_app_session_id_and_profile():
    assert recommend.build_payload("u", "s", "hi", session_id="room1", profile="app_voice") == {
        "user_id": "u", "scenario": "s", "user_text": "hi", "session_id": "room1", "profile": "app_voice"}


def test_agent_sends_room_and_profile_to_the_endpoint(monkeypatch):
    seen = {}

    def fake(user_id, scenario, text, url, **kw):
        seen.update(kw)
        return {"ok": True, "source": "api", "result": {"status": "ok"}}

    monkeypatch.setattr(recommend, "evaluate_reply", fake)
    p = PROFILES["app_voice"]
    agent = NessiAgent("s", "room-9", "alex", profile=p, ctx=CallContext(p.name, "alex", "s", True, None))
    run(agent.respond_to_caller(None, "what is on this page"))
    assert seen["session_id"] == "room-9" and seen["profile"] == "app_voice"


def test_profile_specific_endpoint_url_wins_over_the_shared_one(monkeypatch):
    monkeypatch.setenv("RECOMMENDATION_API_URL", "https://shared.example/evaluate")
    monkeypatch.setenv("RECOMMENDATION_API_URL_APP_VOICE", "https://app.example/voice")
    app = NessiAgent("s", "r", "u", profile=PROFILES["app_voice"])
    phone = NessiAgent("s", "r", "u", profile=PROFILES["phone_details"])
    assert app._api_url == "https://app.example/voice"
    assert phone._api_url == "https://shared.example/evaluate"
    monkeypatch.delenv("RECOMMENDATION_API_URL_APP_VOICE")
    assert NessiAgent("s", "r", "u", profile=PROFILES["app_voice"])._api_url == "https://shared.example/evaluate"
