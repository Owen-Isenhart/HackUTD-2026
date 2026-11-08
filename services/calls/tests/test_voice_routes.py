import json
from datetime import timedelta

import jwt
import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from src.settings import load_settings
from src.voice_routes import add_voice_routes, build_voice_token, new_room_name

ENV = {
    "LIVEKIT_URL": "wss://x.livekit.cloud",
    "LIVEKIT_API_KEY": "k",
    "LIVEKIT_API_SECRET": "s-long-enough-secret-value-0123456789",
    "NVIDIA_API_KEY": "n",
    "LIVEKIT_OUTBOUND_TRUNK_ID": "ST_QwVKCdLTwF7b",
    "CALLS_API_KEY": "secret",
}
HDR = {"x-api-key": "secret"}


def require_key(x_api_key: str = Header(default="")):
    if x_api_key != "secret":
        raise HTTPException(status_code=401, detail="unauthorized")


@pytest.fixture
def client():
    app = FastAPI()
    add_voice_routes(app, load_settings(ENV), require_key)
    return TestClient(app)


def test_auth_required(client):
    assert client.post("/voice/session", json={"user_id": "alex"}).status_code == 401
    r = client.post("/voice/session", json={"user_id": "alex"}, headers={"x-api-key": "bad"})
    assert r.status_code == 401


def test_session_ok_and_claims(client):
    r = client.post("/voice/session", json={"user_id": "alex"}, headers=HDR)
    assert r.status_code == 200
    body = r.json()
    assert body["url"] == "wss://x.livekit.cloud"
    assert body["room"].startswith("app-voice-")
    claims = jwt.decode(body["token"], options={"verify_signature": False})
    assert claims["sub"] == "app-alex"
    assert claims["video"]["room"] == body["room"]
    assert claims["video"]["roomJoin"] is True
    assert claims["video"]["canPublishData"] is True
    assert claims["exp"] - claims["nbf"] <= 600
    agent = claims["roomConfig"]["agents"][0]
    assert agent["agentName"] == "nessi-agent"
    meta = json.loads(agent["metadata"])
    assert meta["profile"] == "app_voice"
    assert meta["user_id"] == "alex"
    assert meta["identity_verified"] is True


@pytest.mark.parametrize("uid", ["a b; drop", "", "x" * 65])
def test_bad_user_id_422(client, uid):
    assert client.post("/voice/session", json={"user_id": uid}, headers=HDR).status_code == 422


def test_rate_limit(client):
    for _ in range(5):
        assert client.post("/voice/session", json={"user_id": "alex"}, headers=HDR).status_code == 200
    assert client.post("/voice/session", json={"user_id": "alex"}, headers=HDR).status_code == 429
    assert client.post("/voice/session", json={"user_id": "sam"}, headers=HDR).status_code == 200


def test_build_rejects_bad_input():
    kw = dict(api_key="k", api_secret=ENV["LIVEKIT_API_SECRET"], room="r")
    with pytest.raises(ValueError):
        build_voice_token(user_id="alex", ttl=timedelta(minutes=11), **kw)
    with pytest.raises(ValueError):
        build_voice_token(user_id="alex", ttl=timedelta(0), **kw)
    with pytest.raises(ValueError):
        build_voice_token(user_id="bad id", **kw)


def test_rooms_unique():
    assert new_room_name() != new_room_name()


def test_user_id_with_a_trailing_newline_is_rejected():
    from src.voice_routes import USER_ID_RE, build_voice_token
    assert not USER_ID_RE.fullmatch("alex\n")
    with pytest.raises(ValueError):
        build_voice_token(api_key="k", api_secret="s-long-enough-secret-value-0123456789",
                          user_id="alex\n", room="app-voice-x")


def test_token_lets_the_app_set_its_own_attributes_for_screen_context():
    import jwt
    from src.voice_routes import build_voice_token
    token = build_voice_token(api_key="k", api_secret="s-long-enough-secret-value-0123456789",
                              user_id="alex", room="app-voice-x")
    video = jwt.decode(token, options={"verify_signature": False})["video"]
    assert video.get("canUpdateOwnMetadata") is True  # without it the page/visible attributes are rejected
