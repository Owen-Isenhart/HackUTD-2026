from fastapi.testclient import TestClient

from app import app

c = TestClient(app)
BODY = {"user_id": "alex", "scenario": "Chick-fil-A nearby", "user_text": "I dont like fast food"}


def test_labelled_dummy_and_echo(monkeypatch):
    monkeypatch.delenv("RECOMMEND_API_KEY", raising=False)
    r = c.post("/api/recommendations/evaluate", json=BODY)
    assert r.status_code == 200
    j = r.json()
    assert j["source"] == "dummy" and j["status"] == "unavailable" and j["heard"] == "I dont like fast food"
    assert "suggestions" not in j


def test_key_enforced_when_configured(monkeypatch):
    monkeypatch.setenv("RECOMMEND_API_KEY", "k")
    assert c.post("/api/recommendations/evaluate", json=BODY).status_code == 401
    assert c.post("/api/recommendations/evaluate", json=BODY, headers={"x-api-key": "bad"}).status_code == 401
    assert c.post("/api/recommendations/evaluate", json=BODY, headers={"x-api-key": "k"}).status_code == 200


def test_validation(monkeypatch):
    monkeypatch.delenv("RECOMMEND_API_KEY", raising=False)
    assert c.post("/api/recommendations/evaluate", json={**BODY, "user_text": ""}).status_code == 422
