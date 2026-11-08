import pytest

from src.call_state import CallStatus, CallStore
from src.demo_tools import check_connection, get_call_note, save_call_note
from src.numbers import is_allowed, normalize_e164
from src.recommend import evaluate_reply
from src.settings import DEFAULT_BASE_URL, DEFAULT_MODEL, load_settings

BASE_ENV = {
    "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s",
    "NVIDIA_API_KEY": "n", "LIVEKIT_OUTBOUND_TRUNK_ID": "ST_QwVKCdLTwF7b", "CALLS_API_KEY": "c",
}


# settings
def test_load_settings_defaults():
    s = load_settings(BASE_ENV)
    assert s.nemotron_base_url == DEFAULT_BASE_URL and s.nemotron_model == DEFAULT_MODEL
    assert s.recommendation_api_url is None


def test_missing_required_names_variable():
    env = {k: v for k, v in BASE_ENV.items() if k != "CALLS_API_KEY"}
    with pytest.raises(ValueError, match="CALLS_API_KEY"):
        load_settings(env)


def test_livekit_url_must_be_wss():
    with pytest.raises(ValueError):
        load_settings({**BASE_ENV, "LIVEKIT_URL": "sips:6c26ulfdp8h.sip.livekit.cloud"})


def test_allowed_numbers_parsed_and_normalized():
    s = load_settings({**BASE_ENV, "DEMO_ALLOWED_NUMBERS": "+19725550100, (469) 555-0101"})
    assert s.allowed_numbers == frozenset({"+19725550100", "+14695550101"})


# numbers
@pytest.mark.parametrize("raw", ["(972) 555-0100", "972-555-0100", "+1 972 555 0100", "19725550100"])
def test_formats_normalize(raw):
    assert normalize_e164(raw) == "+19725550100"


@pytest.mark.parametrize("raw", ["", "abc", "+1", "+1972555", "1" * 20, "972-555-01xx"])
def test_rejects_garbage(raw):
    with pytest.raises(ValueError):
        normalize_e164(raw)


def test_is_allowed_uses_normalized_form():
    assert is_allowed("(972) 555-0100", frozenset({"+19725550100"}))
    assert not is_allowed("+19725550199", frozenset({"+19725550100"}))


def test_photon_number_never_allowed():
    assert not is_allowed("+15076169071", frozenset({"+15076169071"}))


# demo tools
def test_check_connection():
    assert check_connection()["ok"] is True


def test_save_then_independent_readback(tmp_path):
    db = str(tmp_path / "n.sqlite3")
    res = save_call_note(db, "c1", "budget is 20 dollars")
    assert res["ok"] and get_call_note(db, res["note_id"]) == "budget is 20 dollars"


def test_save_failure_reports_error(tmp_path):
    res = save_call_note(str(tmp_path / "nope" / "n.sqlite3"), "c1", "x")
    assert res["ok"] is False and "note_id" not in res


def test_note_validation(tmp_path):
    db = str(tmp_path / "n.sqlite3")
    assert save_call_note(db, "c", "a" * 501)["ok"] is False
    assert save_call_note(db, "c", "   ")["ok"] is False


# call state
def test_create_is_idempotent():
    s = CallStore()
    a, new_a = s.create("k", "+19725550100", "r1")
    b, new_b = s.create("k", "+19725550100", "r2")
    assert a.call_id == b.call_id and new_a and not new_b


def test_terminal_status_is_final():
    s = CallStore()
    r, _ = s.create("k", "+19725550100", "r1")
    s.update(r.call_id, CallStatus.ended)
    with pytest.raises(ValueError):
        s.update(r.call_id, CallStatus.answered)


def test_get_unknown_and_recent_count():
    s = CallStore()
    assert s.get("nope") is None
    s.create("k1", "+19725550100", "r1")
    s.create("k2", "+19725550100", "r2")
    assert s.recent_count("+19725550100", 60) == 2
    assert s.recent_count("+14695550101", 60) == 0


# recommend
def test_stub_when_no_url_says_unavailable_not_fake_suggestion():
    r = evaluate_reply("u", "scn", "I don't like fast food", None)
    assert r["ok"] and r["source"] == "stub"
    assert r["result"]["status"] == "unavailable" and "suggestions" not in r["result"]


def test_api_gets_raw_text_and_json_passes_through():
    seen = {}

    def post(url, payload):
        seen.update(payload)
        return {"suggestions": [{"name": "Salad place", "savings_minor": 250}]}

    r = evaluate_reply("alex", "Chick-fil-A nearby", "I don't like fast food", "http://x", post)
    assert r == {"ok": True, "source": "api",
                 "result": {"suggestions": [{"name": "Salad place", "savings_minor": 250}]}}
    assert seen == {"user_id": "alex", "scenario": "Chick-fil-A nearby", "user_text": "I don't like fast food", "session_id": None, "profile": "phone_details"}


def test_api_failure_and_bad_json_return_error_dict():
    def boom(url, payload):
        raise TimeoutError("slow")

    assert evaluate_reply("u", "s", "hi", "http://x", boom)["ok"] is False
    assert evaluate_reply("u", "s", "hi", "http://x", lambda u, p: "not a dict")["ok"] is False
    assert evaluate_reply("u", "s", "hi", "http://x", lambda u, p: {})["ok"] is False


def test_empty_text_rejected_and_long_text_truncated():
    assert evaluate_reply("u", "s", "   ", "http://x")["ok"] is False
    seen = {}
    evaluate_reply("u", "s", "a" * 5000, "http://x", lambda u, p: seen.update(p) or {"ok": 1})
    assert len(seen["user_text"]) == 1000


def test_failed_dials_do_not_count_toward_rate_limit():
    s = CallStore()
    a, _ = s.create("k1", "+19725550100", "r1")
    s.update(a.call_id, CallStatus.failed)
    s.create("k2", "+19725550100", "r2")
    assert s.recent_count("+19725550100", 60) == 1
