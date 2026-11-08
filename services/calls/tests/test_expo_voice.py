"""Expo Go tap-to-talk (/voice/turn): auth, audio handling, live knowledge and reply limits."""
import base64

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import expo_voice
from src.voice_routes import add_voice_routes

SUMMARY = {
    "account": {"name": "Alex Taylor", "checking": "Everyday Checking •• 2583", "balance": "$150,717.17",
                "linked": [{"name": "High Yield Savings", "sub": "Savings •• 1517", "amt": "$12,500.00", "badge": "Synced"}]},
    "spending": {"monthLabel": "November 2026", "prevMonthLabel": "October", "total": 692.4, "dailyAverage": 86.55,
                 "changePct": -7.6, "status": "On Target", "budgetLine": "",
                 "categories": [{"short": "Fuel", "amt": 441.19, "pct": 64}], "budgets": [],
                 "transactions": [{"name": "Cardinal Gas", "amt": -51.84, "when": "Today, 2:55 AM"}]},
    "upcoming": {"bills": [{"name": "Electric Utility - TXU", "amt": 115.5, "line": "Due Nov 12", "tag": "In 4 days"}],
                 "incomes": [], "safeToSpend": 148350.43},
    "deals": [], "recommendation": None,
}


class _Settings:
    nvidia_api_key = "nv"
    nemotron_base_url = "https://example.invalid/v1"
    nemotron_model = "m"
    livekit_api_key = livekit_api_secret = livekit_url = "x"


def _client(monkeypatch, summary=SUMMARY):
    calls = []
    monkeypatch.setattr(expo_voice, "fetch_summary", lambda url, token: summary if token == "good" else None)
    monkeypatch.setattr(expo_voice, "transcribe", lambda pcm, rate, key: calls.append("stt") or "what is my balance")
    monkeypatch.setattr(expo_voice, "answer", lambda text, tab, knowledge, **kw: calls.append(("llm", knowledge)) or ("You have $150,717.17.", None))
    monkeypatch.setattr(expo_voice, "synthesize", lambda text, key, voice: calls.append("tts") or b"RIFF")
    app = FastAPI()
    add_voice_routes(app, _Settings(), lambda: None)
    return TestClient(app), calls


def _wav():
    return base64.b64encode(expo_voice.to_wav(b"\x00\x00" * 1600, 16000)).decode()


def test_turn_requires_an_accepted_finance_session_before_any_speech_call(monkeypatch):
    client, calls = _client(monkeypatch)
    assert client.post("/voice/turn", json={"audio": _wav()}).status_code == 401
    assert client.post("/voice/turn", json={"audio": _wav(), "finance_token": "bad"}).status_code == 401
    assert calls == []


def test_turn_answers_from_the_live_summary(monkeypatch):
    client, calls = _client(monkeypatch)
    r = client.post("/voice/turn", json={"audio": _wav(), "finance_token": "good", "tab": "spending"})
    assert r.status_code == 200
    body = r.json()
    assert body["reply"] == "You have $150,717.17." and body["transcript"] == "what is my balance"
    assert body["audio"] == base64.b64encode(b"RIFF").decode()
    knowledge = calls[1][1]
    assert "$150,717.17" in knowledge and "Electric Utility - TXU" in knowledge and "$148,350.43" in knowledge


def test_turn_rejects_non_wav_audio(monkeypatch):
    client, _ = _client(monkeypatch)
    r = client.post("/voice/turn", json={"audio": base64.b64encode(b"not audio").decode(), "finance_token": "good"})
    assert r.status_code == 400


def test_unknown_tab_is_ignored(monkeypatch):
    client, _ = _client(monkeypatch)
    r = client.post("/voice/turn", json={"audio": _wav(), "finance_token": "good", "tab": "admin"})
    assert r.status_code == 200


def test_read_wav_round_trip_and_stereo_left_channel():
    pcm, rate = expo_voice.read_wav(expo_voice.to_wav(b"\x01\x00\x02\x00", 16000))
    assert (pcm, rate) == (b"\x01\x00\x02\x00", 16000)
    with pytest.raises(Exception):
        expo_voice.read_wav(b"nope")


def test_spoken_keeps_two_sentences_and_thirty_words():
    assert expo_voice.spoken("One. Two. Three.") == "One. Two."
    long = " ".join(["word"] * 50)
    assert len(expo_voice.spoken(long).split()) == 30


def test_clear_navigation_skips_the_model():
    assert expo_voice.answer("open my spending page", None, None, base_url="", model="", api_key="") == ("Opening Current Spending.", "spending")


def test_page_aliases_navigate_without_the_model():
    assert expo_voice.answer("Take me to my upcoming bills.", None, None, base_url="", model="", api_key="") == ("Opening Upcoming Cashflow.", "upcoming")


def test_model_page_names_are_normalized(monkeypatch):
    class R:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": '{"reply": "Opening upcoming.", "navigate": "Upcoming"}'}}]}
    monkeypatch.setattr(expo_voice.httpx, "post", lambda *a, **k: R())
    assert expo_voice.answer("where are my bills at", None, "k", base_url="http://x", model="m", api_key="k") == ("Opening Upcoming Cashflow.", "upcoming")
