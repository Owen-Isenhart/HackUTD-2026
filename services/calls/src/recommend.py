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


def build_payload(user_id: str, scenario: str, user_text: str, call_id: Optional[str] = None, session_id: Optional[str] = None,
                  profile: str = "phone_details", phone_number: Optional[str] = None) -> dict:
    payload = {"user_id": user_id, "scenario": scenario, "user_text": user_text,
               "session_id": session_id, "profile": profile}
    if phone_number:
        payload["phone_number"] = phone_number
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
    # Identity lookups call Nemotron and Nessie in turn, so they get more time than data questions.
    timeout = {"onboarding": 25, "phone_details": 15}.get(payload.get("profile"), 8)
    with _opener.open(req, timeout=timeout) as r:
        return json.loads(r.read())


def evaluate_reply(user_id: str, scenario: str, user_text: str, api_url: Optional[str],
                   http_post: Callable = _default_post, *, call_id: Optional[str] = None, session_id: Optional[str] = None,
                  profile: str = "phone_details", phone_number: Optional[str] = None) -> dict:
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
        res = http_post(api_url, build_payload(user_id, scenario, user_text, call_id, session_id, profile, phone_number))
    except Exception:  # network/timeout/parse: report honestly, never fabricate
        return {"ok": False, "error": "recommendation service unavailable"}
    if not isinstance(res, dict) or not res:
        return {"ok": False, "error": "recommendation service returned no usable JSON"}
    return {"ok": True, "source": "api", "result": res}


def end_call(api_url: str, call_id: str, user_id: str, decision: Optional[str]) -> None:
    url = urlsplit(api_url)
    action_url = urlunsplit((url.scheme, url.netloc, f"/internal/v1/calls/{call_id}/actions", "", ""))
    _default_post(action_url, {"action": "end", "user_id": user_id, "decision": decision})


def resolve_onboarding(api_url: str, phone_number: str, session_id: str) -> dict:
    """Resolve a SIP caller to a pending app signup; caller ID alone never verifies identity."""
    url = urlsplit(api_url)
    target = urlunsplit((url.scheme, url.netloc, '/internal/onboarding/resolve', '', ''))
    try:
        result = _default_post(target, {'phone_number': phone_number, 'session_id': session_id})
        return result if isinstance(result, dict) else {'status': 'unavailable'}
    except Exception:
        return {'status': 'unavailable'}


def route_inbound(route_url: str, phone_number: str, session_id: str) -> dict:
    """Ask the lookup service which sequence this caller gets: phone_details for a number linked to an
    onboarded user, onboarding otherwise. Caller ID alone never verifies identity."""
    try:
        result = _default_post(route_url, {"phone_number": phone_number, "session_id": session_id})
        return result if isinstance(result, dict) else {"status": "unavailable"}
    except Exception:
        return {"status": "unavailable"}


def seed_verified_session(sessions_url: str, session_id: str, user_id: str, phone_number: str) -> bool:
    """Outbound only: pre-verify a phone_details session for a call placed to the user's own linked number."""
    try:
        result = _default_post(sessions_url, {"session_id": session_id, "user_id": user_id, "phone_number": phone_number})
        return isinstance(result, dict) and result.get("status") == "verified"
    except Exception:
        return False
