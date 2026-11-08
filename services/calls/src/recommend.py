"""Client for the recommendation endpoint.

The endpoint receives the caller's raw words, runs its own Nemotron interpretation, and returns
structured JSON suggestions. This module only forwards text and passes the JSON through unchanged;
the agent's Nemotron turns that JSON into speech. The endpoint contract is not final: keep it
isolated in build_payload.
"""
import json
import os
import urllib.request
from typing import Callable, Optional

MAX_USER_TEXT = 1000


def build_payload(user_id: str, scenario: str, user_text: str) -> dict:
    return {"user_id": user_id, "scenario": scenario, "user_text": user_text}


def _default_post(url: str, payload: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    if os.getenv("RECOMMENDATION_API_KEY"):
        headers["x-api-key"] = os.environ["RECOMMENDATION_API_KEY"]
    req = urllib.request.Request(url, json.dumps(payload).encode(), headers)
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read())


def evaluate_reply(user_id: str, scenario: str, user_text: str, api_url: Optional[str],
                   http_post: Callable = _default_post) -> dict:
    """Return {"ok": True, "source": "stub"|"api", "result": dict} or {"ok": False, "error": str}."""
    user_text = (user_text or "").strip()
    if not user_text:
        return {"ok": False, "error": "no caller text to evaluate"}
    if len(user_text) > MAX_USER_TEXT:
        user_text = user_text[:MAX_USER_TEXT]
    if not api_url:
        return {"ok": True, "source": "stub",
                "result": {"status": "unavailable", "message": "We can't process that right now."}}
    try:
        res = http_post(api_url, build_payload(user_id, scenario, user_text))
    except Exception as e:  # network/timeout/parse: report honestly, never fabricate
        return {"ok": False, "error": f"recommendation service failed: {e}"}
    if not isinstance(res, dict) or not res:
        return {"ok": False, "error": "recommendation service returned no usable JSON"}
    return {"ok": True, "source": "api", "result": res}
