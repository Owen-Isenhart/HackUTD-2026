"""Picks the voice for a recommendation call from the tone of what it will say.

A small Nemotron model (the team's Bolt, about 4 billion parameters) reads the suggestion once,
before the call speaks, and answers one word:
- positive: the call offers extra cash back or savings. Spoken by Mia in her default tone.
- negative: the call reminds the user of a budget they are near or over. Spoken by Sofia, fearful.

It leans positive. Only an exact "negative" answer counts as negative; an empty, odd or late answer,
or any error, gives the positive voice.
"""
import json
import os
import urllib.request
from typing import Callable, Optional
from urllib.parse import urlsplit

POSITIVE_VOICE = "Magpie-Multilingual.EN-US.Mia"
NEGATIVE_VOICE = "Magpie-Multilingual.EN-US.Sofia.Fearful"
DEFAULT_TONE_BASE_URL = "http://127.0.0.1:8000/v1"  # the team's vLLM on the Brev machine
DEFAULT_TONE_MODEL = "nemotron-bolt"
NVIDIA_HOST = "integrate.api.nvidia.com"
TIMEOUT_SECONDS = 2.0
MAX_TEXT = 600

PROMPT = (
    "Classify this phone message from a banking assistant. Answer with one word.\n"
    "positive: it offers extra cash back, a deal, rewards or savings.\n"
    "negative: it warns or reminds the user about their budget or spending limit.\n"
    "If it does both or you are unsure, answer positive.\n\nMessage: "
)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect())


def _endpoint(env) -> tuple[str, dict]:
    """Chat-completions URL and headers. Plain HTTP only for this machine; NVIDIA's key only for NVIDIA's host."""
    base = (env.get("TONE_BASE_URL") or DEFAULT_TONE_BASE_URL).rstrip("/")
    parts = urlsplit(base)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" and not (parts.scheme == "http" and host in ("127.0.0.1", "localhost", "::1")):
        raise ValueError("TONE_BASE_URL must use https unless it points at this machine")
    headers = {"Content-Type": "application/json"}
    key = env.get("TONE_API_KEY") or (env.get("NVIDIA_API_KEY") if host == NVIDIA_HOST else None)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return base + "/chat/completions", headers


def _default_post(url: str, headers: dict, body: dict) -> dict:
    req = urllib.request.Request(url, json.dumps(body).encode(), headers)
    with _opener.open(req, timeout=TIMEOUT_SECONDS) as r:
        return json.loads(r.read())


def classify(text: Optional[str], env=os.environ, post: Callable = _default_post) -> str:
    """Return "positive" or "negative". Never raises."""
    if not text or not text.strip():
        return "positive"
    try:
        url, headers = _endpoint(env)
        res = post(url, headers, {
            "model": env.get("TONE_MODEL") or DEFAULT_TONE_MODEL,
            "messages": [{"role": "user", "content": PROMPT + text.strip()[:MAX_TEXT]}],
            "max_tokens": 2,
            "temperature": 0,
            "chat_template_kwargs": {"enable_thinking": False},
        })
        answer = res["choices"][0]["message"]["content"]
    except Exception:
        return "positive"
    word = answer.strip().strip(".!\"'").lower() if isinstance(answer, str) else ""
    return "negative" if word == "negative" else "positive"


def voice_for(tone: str, env=os.environ) -> str:
    """Magpie voice names, overridable if the server spells them differently."""
    if tone == "negative":
        return env.get("TONE_NEGATIVE_VOICE") or NEGATIVE_VOICE
    return env.get("TONE_POSITIVE_VOICE") or POSITIVE_VOICE
