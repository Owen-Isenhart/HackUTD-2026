import asyncio

from src.agent import NessiAgent, opening_line, parse_metadata
from src.livekit_dialer import LiveKitDialer
from src.settings import load_settings

ENV = {
    "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s",
    "NVIDIA_API_KEY": "n", "LIVEKIT_OUTBOUND_TRUNK_ID": "ST_QwVKCdLTwF7b", "CALLS_API_KEY": "c",
}


def run(coro):
    return asyncio.run(coro)


def test_tool_failure_returns_error_dict(tmp_path, monkeypatch):
    monkeypatch.setenv("DEMO_NOTES_DB", str(tmp_path / "ok.sqlite3"))
    agent = NessiAgent("Chick-fil-A is nearby", "room1")
    agent._db = str(tmp_path / "missing" / "n.sqlite3")
    res = run(agent.save_call_note(None, "hello"))
    assert res["ok"] is False


def test_respond_to_caller_stub_and_user_binding(tmp_path, monkeypatch):
    monkeypatch.setenv("DEMO_NOTES_DB", str(tmp_path / "p.sqlite3"))
    monkeypatch.delenv("RECOMMENDATION_API_URL", raising=False)
    agent = NessiAgent("Chick-fil-A is nearby", "room1", "alex")
    assert agent._user_id == "alex"
    res = run(agent.respond_to_caller(None, "I don't like fast food"))
    assert res["ok"] and res["source"] == "stub" and res["result"]["status"] == "unavailable"


def test_parse_metadata():
    assert parse_metadata('{"user_id": "alex", "scenario": "s"}') == ("s", "alex")
    assert parse_metadata("plain string") == (None, "demo-user")
    assert parse_metadata(None) == (None, "demo-user")
    assert parse_metadata("[1]") == (None, "demo-user")


def test_record_decision(tmp_path, monkeypatch):
    monkeypatch.setenv("DEMO_NOTES_DB", str(tmp_path / "d.sqlite3"))
    agent = NessiAgent(None, "room1")
    assert run(agent.record_decision(None, False))["decision"] == "declined"


def test_dialer_dispatches_before_sip(monkeypatch):
    order = []

    class FakeDispatch:
        async def create_dispatch(self, req):
            order.append(("dispatch", req.room, req.agent_name, req.metadata))

    class FakeSip:
        async def create_sip_participant(self, req):
            order.append(("sip", req.room_name, req.sip_trunk_id, req.sip_call_to))

    class FakeLK:
        agent_dispatch, sip = FakeDispatch(), FakeSip()

        def __init__(self, *a):
            pass

        async def aclose(self):
            order.append(("close",))

    monkeypatch.setattr("src.livekit_dialer.api.LiveKitAPI", FakeLK)
    run(LiveKitDialer(load_settings(ENV)).dial("r1", "+19725550100", "scn"))
    assert order[0] == ("dispatch", "r1", "nessi-agent", '{"user_id": "demo-user", "scenario": "scn"}')
    assert order[1] == ("sip", "r1", "ST_QwVKCdLTwF7b", "+19725550100")
    assert order[2] == ("close",)


def test_opening_line_discloses_ai_and_speaks_scenario_verbatim():
    assert opening_line(None) == "Hi, I'm Nessiessential's AI assistant."
    assert opening_line("  Chick-fil-A is nearby. ") == "Hi, I'm Nessiessential's AI assistant. Chick-fil-A is nearby."
