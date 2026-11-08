import pytest
from fastapi.testclient import TestClient
from livekit.api import SipCallError

from src.call_state import CallStatus, CallStore
from src.calls_api import create_app
from src.settings import load_settings

ENV = {
    "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s",
    "NVIDIA_API_KEY": "n", "LIVEKIT_OUTBOUND_TRUNK_ID": "ST_QwVKCdLTwF7b", "CALLS_API_KEY": "secret",
    "DEMO_ALLOWED_NUMBERS": "+19725550100,+15076169071",
}
H = {"x-api-key": "secret"}


class FakeDialer:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    async def dial(self, room_name, to_number, scenario=None, user_id="demo-user", **metadata):
        if self.fail:
            raise RuntimeError("sip error")
        self.calls.append((room_name, to_number, scenario, user_id))


@pytest.fixture
def ctx():
    dialer, store = FakeDialer(), CallStore()
    return TestClient(create_app(load_settings(ENV), dialer, store)), dialer, store


def post(client, body, headers=H):
    return client.post("/calls", json=body, headers=headers)


def test_health_open(ctx):
    assert ctx[0].get("/health").json() == {"status": "ok"}


def test_missing_and_wrong_key_401_no_dial(ctx):
    c, d, _ = ctx
    assert post(c, {"to_number": "+19725550100"}, {}).status_code == 401
    assert post(c, {"to_number": "+19725550100"}, {"x-api-key": "bad"}).status_code == 401
    assert d.calls == []


def test_non_allowlisted_403_no_dial(ctx):
    c, d, _ = ctx
    assert post(c, {"to_number": "+19725550199"}).status_code == 403
    assert d.calls == []


def test_own_photon_number_403(ctx):
    c, d, _ = ctx
    assert post(c, {"to_number": "+15076169071"}).status_code == 403
    assert d.calls == []


def test_bad_number_422(ctx):
    assert post(ctx[0], {"to_number": "abc"}).status_code == 422


def test_formatted_number_matches_allowlist_and_scenario_forwarded(ctx):
    c, d, _ = ctx
    r = post(c, {"to_number": "(972) 555-0100", "scenario": "Chick-fil-A is nearby"})
    assert r.status_code == 200 and r.json()["status"] == "dial_requested"
    assert d.calls[0][1:] == ("+19725550100", "Chick-fil-A is nearby", "demo-user")


def test_retry_same_idempotency_key_dials_once(ctx):
    c, d, _ = ctx
    a = post(c, {"to_number": "+19725550100", "idempotency_key": "k1"}).json()
    b = post(c, {"to_number": "+19725550100", "idempotency_key": "k1"}).json()
    assert a["call_id"] == b["call_id"] and len(d.calls) == 1


def test_dialer_error_sets_failed_and_502():
    dialer, store = FakeDialer(fail=True), CallStore()
    c = TestClient(create_app(load_settings(ENV), dialer, store))
    r = post(c, {"to_number": "+19725550100", "idempotency_key": "k"})
    assert r.status_code == 502
    assert store._by_id[next(iter(store._by_id))].status == CallStatus.failed


@pytest.mark.parametrize(("sip_code", "outcome"), [(486, "busy"), (603, "declined"), (480, "no_answer")])
def test_provider_outcome_is_reported(sip_code, outcome):
    class RejectDialer:
        async def dial(self, *_, **metadata):
            raise SipCallError("unknown", "test error", status=502, metadata={"sip_status_code": str(sip_code)})

    c = TestClient(create_app(load_settings(ENV), RejectDialer(), CallStore()))
    result = post(c, {"to_number": "+19725550100"})
    assert result.status_code == 200
    assert result.json()["status"] == outcome
    assert c.get(f"/calls/{result.json()['call_id']}", headers=H).json()["status"] == outcome


def test_rate_limit_429(ctx):
    c, d, _ = ctx
    for i in range(3):
        assert post(c, {"to_number": "+19725550100", "idempotency_key": f"k{i}"}).status_code == 200
    assert post(c, {"to_number": "+19725550100", "idempotency_key": "k9"}).status_code == 429
    assert len(d.calls) == 3


def test_scenario_too_long_422(ctx):
    assert post(ctx[0], {"to_number": "+19725550100", "scenario": "x" * 501}).status_code == 422


def test_get_call_requires_key(ctx):
    c, _, _ = ctx
    cid = post(c, {"to_number": "+19725550100"}).json()["call_id"]
    assert c.get(f"/calls/{cid}").status_code == 401
    assert c.get(f"/calls/{cid}", headers=H).json()["status"] == "dial_requested"
    assert c.get("/calls/nope", headers=H).status_code == 404


def test_user_id_forwarded_and_validated(ctx):
    c, d, _ = ctx
    assert post(c, {"to_number": "+19725550100", "user_id": "alex_1"}).status_code == 200
    assert d.calls[0][3] == "alex_1"
    assert post(c, {"to_number": "+19725550100", "user_id": "a b; drop"}).status_code == 422


@pytest.mark.parametrize('profile', ['app_voice', 'unknown'])
def test_calls_api_rejects_app_voice_and_unknown_profile(ctx, profile):
    assert post(ctx[0], {'to_number': '+19725550100', 'profile': profile}).status_code == 422
    assert not ctx[1].calls


def test_onboarding_requires_explicit_user_and_unverified_identity(ctx):
    body = {'to_number': '+19725550100', 'profile': 'onboarding'}
    assert post(ctx[0], body).status_code == 422
    assert post(ctx[0], {**body, 'user_id': 'maya', 'identity_verified': True}).status_code == 422
    assert post(ctx[0], {**body, 'user_id': 'maya'}).status_code == 200
