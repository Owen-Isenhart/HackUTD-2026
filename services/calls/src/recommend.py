"""Client for the recommendation endpoint.

The endpoint receives the caller's raw words, runs its own Nemotron interpretation, and returns
structured JSON suggestions. This module only forwards text and passes the JSON through unchanged;
the agent's Nemotron turns that JSON into speech. The endpoint contract is not final: keep it
isolated in build_payload.
"""
import json
import os
import urllib.request
from urllib.parse import urlsplit, urlunsplit
from typing import Callable, Optional

MAX_USER_TEXT = 1000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(NoRedirect())


def build_payload(user_id: str, scenario: str, user_text: str, call_id: Optional[str] = None) -> dict:
    payload = {"user_id": user_id, "scenario": scenario, "user_text": user_text}
    if call_id:
        payload["call_id"] = call_id
    return payload


def _default_post(url: str, payload: dict) -> dict:
    parsed = urlsplit(url)
    if parsed.username or parsed.password or parsed.fragment or parsed.query or (
        parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1"))
    ):
        raise ValueError("recommendation service must use HTTPS or loopback HTTP")
    headers = {"Content-Type": "application/json"}
    if os.getenv("RECOMMENDATION_API_KEY"):
        headers["x-api-key"] = os.environ["RECOMMENDATION_API_KEY"]
    req = urllib.request.Request(url, json.dumps(payload).encode(), headers)
    with _opener.open(req, timeout=8) as r:
        return json.loads(r.read())


def evaluate_reply(user_id: str, scenario: str, user_text: str, api_url: Optional[str],
                   http_post: Callable = _default_post, *, call_id: Optional[str] = None) -> dict:
    """Return {"ok": True, "source": "stub"|"api", "result": dict} or {"ok": False, "error": str}."""
    user_text = user_text or ""
    if not user_text.strip():
        return {"ok": False, "error": "no caller text to evaluate"}
    if len(user_text) > MAX_USER_TEXT:
        user_text = user_text[:MAX_USER_TEXT]
    if not api_url:
        return {"ok": True, "source": "stub",
                "result": {"status": "unavailable", "message": "We can't process that right now."}}
    try:
        res = http_post(api_url, build_payload(user_id, scenario, user_text, call_id))
    except Exception as e:  # network/timeout/parse: report honestly, never fabricate
        return {"ok": False, "error": f"recommendation service failed: {e}"}
    if not isinstance(res, dict) or not res:
        return {"ok": False, "error": "recommendation service returned no usable JSON"}
    return {"ok": True, "source": "api", "result": res}


def end_call(api_url: str, call_id: str, user_id: str, decision: Optional[str]) -> None:
    url = urlsplit(api_url)
    action_url = urlunsplit((url.scheme, url.netloc, f"/internal/v1/calls/{call_id}/actions", "", ""))
    _default_post(action_url, {"action": "end", "user_id": user_id, "decision": decision})
