"""Recommendation calls pick Mia (positive) or fearful Sofia (negative), leaning positive."""
import asyncio

import pytest

from src import tone
from src.agent import DEFAULT_VOICE, call_voice
from src.profiles import CallContext

CALL_ID = "8d3f2a4e-1b2c-4d5e-8f90-123456789abc"


def reply(word):
    return lambda url, headers, body: {"choices": [{"message": {"content": word}}]}


@pytest.mark.parametrize(("answer", "expected"), [
    ("negative", "negative"), (" Negative.", "negative"), ("positive", "positive"),
    ("", "positive"), ("neg", "positive"), ("negative positive", "positive"), (None, "positive"),
])
def test_only_a_clear_negative_counts(answer, expected):
    assert tone.classify("You are near your dining budget.", env={}, post=reply(answer)) == expected


def test_errors_and_empty_text_lean_positive():
    def boom(url, headers, body):
        raise TimeoutError
    assert tone.classify("You are over budget.", env={}, post=boom) == "positive"
    assert tone.classify("   ", env={}, post=reply("negative")) == "positive"
    assert tone.classify("x", env={}, post=lambda *a: {"choices": []}) == "positive"


def test_request_is_tiny_and_goes_to_bolt_by_default():
    seen = {}

    def capture(url, headers, body):
        seen.update(url=url, headers=headers, body=body)
        return {"choices": [{"message": {"content": "positive"}}]}

    tone.classify("Use Venture X at Chipotle for 5% back.", env={}, post=capture)
    assert seen["url"] == "http://127.0.0.1:8000/v1/chat/completions"
    assert seen["body"]["model"] == "nemotron-bolt" and seen["body"]["max_tokens"] == 2
    assert seen["body"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert "Authorization" not in seen["headers"]


def test_nvidia_key_only_goes_to_nvidia_and_remote_http_is_refused():
    seen = {}
    tone.classify("x", env={"TONE_BASE_URL": "https://integrate.api.nvidia.com/v1", "NVIDIA_API_KEY": "k"},
                  post=lambda u, h, b: seen.update(h=h) or {"choices": [{"message": {"content": "positive"}}]})
    assert seen["h"]["Authorization"] == "Bearer k"
    seen.clear()
    tone.classify("x", env={"TONE_BASE_URL": "https://example.com/v1", "NVIDIA_API_KEY": "k"},
                  post=lambda u, h, b: seen.update(h=h) or {"choices": [{"message": {"content": "positive"}}]})
    assert "Authorization" not in seen["h"]
    called = []
    assert tone.classify("x", env={"TONE_BASE_URL": "http://example.com/v1"},
                         post=lambda *a: called.append(1) or {"choices": [{"message": {"content": "negative"}}]}) == "positive"
    assert not called


def test_voices():
    assert tone.voice_for("positive", env={}) == "Magpie-Multilingual.EN-US.Mia"
    assert tone.voice_for("negative", env={}) == "Magpie-Multilingual.EN-US.Sofia.Fearful"
    assert tone.voice_for("negative", env={"TONE_NEGATIVE_VOICE": "X"}) == "X"


def test_only_recommendation_calls_are_classified():
    rec = CallContext(profile="phone_details", call_id=CALL_ID, scenario="You are over your coffee budget.")
    assert asyncio.run(call_voice(rec, classify=lambda t: "negative")) == "Magpie-Multilingual.EN-US.Sofia.Fearful"
    assert asyncio.run(call_voice(rec, classify=lambda t: "positive")) == "Magpie-Multilingual.EN-US.Mia"

    def never(t):
        raise AssertionError("must not classify")
    for ctx in [CallContext(profile="onboarding", scenario="New user onboarding."),
                CallContext(profile="phone_details", scenario="Returning caller.", returning=True),
                CallContext(profile="phone_details", call_id=CALL_ID, scenario="")]:
        assert asyncio.run(call_voice(ctx, classify=never)) == DEFAULT_VOICE
