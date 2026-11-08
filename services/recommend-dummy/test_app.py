from fastapi.testclient import TestClient

from app import app

c = TestClient(app)
BODY = {"user_id": "alex", "scenario": "Chick-fil-A nearby", "user_text": "I dont like fast food"}


def test_labelled_dummy_and_echo(monkeypatch):
    monkeypatch.setenv("RECOMMENDATION_API_KEY", "k")
    r = c.post("/api/recommendations/evaluate", json=BODY, headers={"x-api-key": "k"})
    assert r.status_code == 200
    j = r.json()
    assert j["source"] == "dummy" and j["status"] == "unavailable" and j["heard"] == "I dont like fast food"
    assert "suggestions" not in j


def test_fails_closed_when_key_unset(monkeypatch):
    monkeypatch.delenv("RECOMMENDATION_API_KEY", raising=False)
    assert c.post("/api/recommendations/evaluate", json=BODY).status_code == 503
    assert c.post("/api/recommendations/evaluate", json=BODY, headers={"x-api-key": ""}).status_code == 503


def test_key_enforced_when_configured(monkeypatch):
    monkeypatch.setenv("RECOMMENDATION_API_KEY", "k")
    assert c.post("/api/recommendations/evaluate", json=BODY).status_code == 401
    assert c.post("/api/recommendations/evaluate", json=BODY, headers={"x-api-key": "bad"}).status_code == 401
    assert c.post("/api/recommendations/evaluate", json=BODY, headers={"x-api-key": "k"}).status_code == 200


def test_validation(monkeypatch):
    monkeypatch.setenv("RECOMMENDATION_API_KEY", "k")
    assert c.post("/api/recommendations/evaluate", json={**BODY, "user_text": ""}, headers={"x-api-key": "k"}).status_code == 422


def test_accepts_session_id_and_profile_fields(monkeypatch):
    monkeypatch.setenv("RECOMMENDATION_API_KEY", "k")
    body = {**BODY, "session_id": "nessi-out-abc", "profile": "app_voice"}
    r = c.post("/api/recommendations/evaluate", json=body, headers={"x-api-key": "k"})
    assert r.status_code == 200 and r.json()["status"] == "unavailable"
