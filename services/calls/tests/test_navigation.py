import asyncio
import json

import pytest
from livekit import rtc

from src.navigation import ROUTES, navigate

ALL = ["deals", "spending", "upcoming", "account"]  # the four tabs of app/


class FakeParticipant:
    def __init__(self, exc=None):
        self.calls = []
        self.exc = exc

    async def perform_rpc(self, **kwargs):
        self.calls.append(kwargs)
        if self.exc:
            raise self.exc
        return "ok"


class FakeRoom:
    def __init__(self, exc=None):
        self.local_participant = FakeParticipant(exc)


def run(room, dest):
    return asyncio.run(navigate(room, "app-1", dest))


def test_routes_count():
    assert len(ROUTES) == 4
    assert ROUTES == frozenset(ALL)


@pytest.mark.parametrize("dest", ALL)
def test_each_route(dest):
    room = FakeRoom()
    assert run(room, dest) == {"ok": True, "opened": dest}
    calls = room.local_participant.calls
    assert len(calls) == 1
    c = calls[0]
    assert c["method"] == "navigate"
    assert c["destination_identity"] == "app-1"
    assert json.loads(c["payload"]) == {"route": dest}
    assert c["response_timeout"] == 5.0


def test_normalized():
    room = FakeRoom()
    assert run(room, " Deals ") == {"ok": True, "opened": "deals"}
    assert json.loads(room.local_participant.calls[0]["payload"]) == {"route": "deals"}


@pytest.mark.parametrize("dest", ["settings", "budgets", "", "../etc", "deals; drop", None, 5])
def test_unknown(dest):
    room = FakeRoom()
    assert run(room, dest) == {"ok": False, "error": "unknown destination"}
    assert room.local_participant.calls == []


def test_runtime_error():
    r = run(FakeRoom(RuntimeError("app not ready")), "deals")
    assert r["ok"] is False
    assert "app not ready" in r["error"]


def test_rpc_error():
    err = rtc.RpcError(rtc.RpcError.ErrorCode.RESPONSE_TIMEOUT, "timed out")
    r = run(FakeRoom(err), "deals")
    assert r["ok"] is False
    assert r["error"]


def test_truncated():
    r = run(FakeRoom(RuntimeError("x" * 500)), "deals")
    assert r["ok"] is False
    assert len(r["error"]) <= 120
