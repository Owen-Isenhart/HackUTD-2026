from fastapi.testclient import TestClient

from src.call_state import CallStore
from src.calls_api import create_app
from src.settings import load_settings

ENV = {
    "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s-long-enough-secret-value-0123456789",
    "NVIDIA_API_KEY": "n", "LIVEKIT_OUTBOUND_TRUNK_ID": "ST_QwVKCdLTwF7b", "CALLS_API_KEY": "secret",
}


class NoDial:
    async def dial(self, *a, **k):
        raise AssertionError("must not dial")


def client(**extra):
    return TestClient(create_app(load_settings({**ENV, **extra}), NoDial(), CallStore()))


def preflight(c, origin, path="/voice/session"):
    return c.options(path, headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                    "Access-Control-Request-Headers": "x-api-key,content-type"})


def test_expo_web_dev_origin_can_call_the_voice_session_route():
    r = preflight(client(), "http://localhost:8081")
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:8081"
    assert "x-api-key" in r.headers["access-control-allow-headers"].lower()


def test_unknown_origins_get_no_cors_permission():
    for origin in ("https://evil.example", "http://localhost.evil.example", "null"):
        assert "access-control-allow-origin" not in preflight(client(), origin).headers


def test_extra_origins_come_from_the_environment_not_a_wildcard():
    c = client(VOICE_ALLOWED_ORIGINS="https://app.example, http://10.0.0.5:8081")
    assert preflight(c, "https://app.example").headers["access-control-allow-origin"] == "https://app.example"
    assert preflight(c, "http://10.0.0.5:8081").headers["access-control-allow-origin"] == "http://10.0.0.5:8081"
    assert "access-control-allow-origin" not in preflight(c, "https://other.example").headers


def test_cors_does_not_replace_the_api_key_requirement():
    c = client()
    assert c.post("/voice/session", json={"user_id": "alex"}, headers={"Origin": "http://localhost:8081"}).status_code == 401
