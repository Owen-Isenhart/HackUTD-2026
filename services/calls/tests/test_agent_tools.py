import asyncio
import json
from types import SimpleNamespace

import pytest

from src.agent import NessiAgent, is_end_phrase, opening_line, parse_metadata, wait_until_answered
from src.profiles import CallContext
from src.livekit_dialer import LiveKitDialer
from src.settings import load_settings

ENV = {
    "LIVEKIT_URL": "wss://x.livekit.cloud", "LIVEKIT_API_KEY": "k", "LIVEKIT_API_SECRET": "s",
    "NVIDIA_API_KEY": "n", "LIVEKIT_OUTBOUND_TRUNK_ID": "ST_QwVKCdLTwF7b", "CALLS_API_KEY": "c",
}
CALL_ID = "7faefab6-1496-4638-bd6e-fc0aa88bfb68"


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
    assert parse_metadata(json.dumps({"user_id": "alex", "scenario": "s", "call_id": CALL_ID})) == CallContext(scenario="s", user_id="alex", call_id=CALL_ID)
    assert parse_metadata('{"call_id": "../bad"}') == CallContext()
    assert parse_metadata("plain string") == CallContext()
    assert parse_metadata(None) == CallContext()
    assert parse_metadata("[1]") == CallContext()


def test_bound_turn_forwards_the_actual_transcript_and_speaks_api_output(monkeypatch):
    from livekit.agents import StopResponse

    transcript = "No, wait. Anything below $10?"
    spoken = []
    seen = []
    message = "Your typical purchase at Starbucks is $8.00, with $0.32 in demo cashback."
    monkeypatch.setenv("RECOMMENDATION_API_URL", "http://127.0.0.1:8787/api/recommendations/evaluate")
    monkeypatch.setattr(NessiAgent, "session", property(lambda _: SimpleNamespace(say=spoken.append)))

    def evaluate(user, scenario, text, url, *, call_id, session_id, profile, phone_number):
        seen.append((user, scenario, text, url, call_id))
        return {"ok": True, "result": {"status": "recommendation", "message": message}}

    monkeypatch.setattr("src.recommend.evaluate_reply", evaluate)
    agent = NessiAgent("Opening offer", "room1", "alex", CALL_ID)
    with pytest.raises(StopResponse):
        run(agent.on_user_turn_completed(None, SimpleNamespace(text_content=transcript)))
    assert seen == [("alex", "Opening offer", transcript, agent._api_url, CALL_ID)]
    assert spoken == [message]


def test_record_decision_sets_decision_and_hangs_up_without_model_reply(tmp_path, monkeypatch):
    import pytest
    from livekit.agents import StopResponse
    monkeypatch.setenv("DEMO_NOTES_DB", str(tmp_path / "d.sqlite3"))
    agent = NessiAgent(None, "room1")
    started = []
    agent._start_hang_up = lambda text: started.append(text)
    with pytest.raises(StopResponse):
        run(agent.record_decision(None, False))
    assert agent.decision == "declined" and started == ["Got it, thank you. Goodbye!"]


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
    run(LiveKitDialer(load_settings(ENV)).dial("r1", "+19725550100", "scn", call_id=CALL_ID))
    assert order[0][:3] == ("dispatch", "r1", "nessi-agent")
    assert json.loads(order[0][3]) == {"user_id": "demo-user", "scenario": "scn", "call_id": CALL_ID, "profile": "phone_details", "identity_verified": False, "phone_number": "+19725550100"}
    assert order[1] == ("sip", "r1", "ST_QwVKCdLTwF7b", "+19725550100")
    assert order[2] == ("close",)


def test_opening_line_discloses_ai_and_speaks_scenario_verbatim():
    assert opening_line(None) == "Hi, I'm the Nessential agent, an AI assistant."
    assert opening_line("  Chick-fil-A is nearby. ") == "Hi, I'm the Nessential agent, an AI assistant. Chick-fil-A is nearby."


def test_llm_credentials_never_leak_to_other_hosts(monkeypatch):
    import pytest
    from src.agent import resolve_llm_credentials
    monkeypatch.setenv("NVIDIA_API_KEY", "nvkey")
    monkeypatch.delenv("NEMOTRON_API_KEY", raising=False)
    monkeypatch.delenv("NEMOTRON_BASE_URL", raising=False)
    assert resolve_llm_credentials()[1] == "nvkey"
    monkeypatch.setenv("NEMOTRON_BASE_URL", "https://evil.example.com/v1")
    with pytest.raises(ValueError):
        resolve_llm_credentials()
    monkeypatch.setenv("NEMOTRON_BASE_URL", "http://evil.example.com/v1")
    with pytest.raises(ValueError):
        resolve_llm_credentials()
    monkeypatch.setenv("NEMOTRON_API_KEY", "own")
    monkeypatch.setenv("NEMOTRON_BASE_URL", "https://vllm.mine.example/v1")
    assert resolve_llm_credentials() == ("https://vllm.mine.example/v1", "own")


def test_end_phrases_match_whole_short_utterances_only():
    for t in ["No.", "no thanks", "That's all", "No, that'll be all.", "nothing else", "Goodbye!", "never mind", "I'm good", "Bye"]:
        assert is_end_phrase(t), t
    for t in ["no wait, what about vegan?", "yes", "I want a salad", "Are you supposed to end the call?", ""]:
        assert not is_end_phrase(t), t


def test_plain_no_after_suggestion_records_decline_and_hangs_up():
    import pytest
    from livekit.agents import StopResponse

    class Msg:
        text_content = "No."

    agent = NessiAgent(None, "room1")
    agent._offered = True
    started = []
    agent._start_hang_up = lambda text: started.append(text)
    with pytest.raises(StopResponse):
        run(agent.on_user_turn_completed(None, Msg()))
    assert agent.decision == "declined" and started


def test_non_end_utterance_lets_model_respond():
    class Msg:
        text_content = "Are there vegan options?"

    agent = NessiAgent(None, "room1")
    started = []
    agent._start_hang_up = lambda text: started.append(text)
    run(agent.on_user_turn_completed(None, Msg()))  # must not raise
    assert started == []


def test_wait_until_answered_waits_for_active_status():
    class P:
        identity = "phone_user"
        attributes = {"sip.callStatus": "ringing"}

    class Room:
        def __init__(self):
            self.cb = None

        def on(self, ev, cb):
            self.cb = cb

        def off(self, ev, cb):
            self.cb = None

    async def go():
        room, p = Room(), P()
        task = asyncio.create_task(wait_until_answered(room, p, timeout=2))
        await asyncio.sleep(0.05)
        assert not task.done()
        p.attributes = {"sip.callStatus": "active"}
        room.cb({}, p)
        return await task

    assert run(go()) is True


def test_wait_until_answered_times_out():
    class P:
        identity = "x"
        attributes = {"sip.callStatus": "ringing"}

    class Room:
        def on(self, *a): pass
        def off(self, *a): pass

    assert run(wait_until_answered(Room(), P(), timeout=0.05)) is False


def test_hang_up_always_deletes_room_even_when_goodbye_fails(monkeypatch):
    deleted = []

    class Ctx:
        async def delete_room(self):
            deleted.append(True)

    class Session:
        def say(self, *a, **k):
            raise RuntimeError("tts down")

    monkeypatch.setattr("src.agent.get_job_context", lambda: Ctx())
    agent = NessiAgent(None, "room1")
    monkeypatch.setattr(NessiAgent, "session", property(lambda self: Session()))
    run(agent._hang_up("bye"))
    assert deleted == [True]


def test_hang_up_deletes_room_when_goodbye_never_finishes(monkeypatch):
    deleted = []

    class Ctx:
        async def delete_room(self):
            deleted.append(True)

    class Handle:
        async def wait_for_playout(self):
            await asyncio.sleep(3600)

    class Session:
        def say(self, *a, **k):
            return Handle()

    real_wait_for = asyncio.wait_for
    monkeypatch.setattr("src.agent.asyncio.wait_for", lambda aw, timeout: real_wait_for(aw, 0.05))
    monkeypatch.setattr("src.agent.get_job_context", lambda: Ctx())
    agent = NessiAgent(None, "room1")
    monkeypatch.setattr(NessiAgent, "session", property(lambda self: Session()))
    run(agent._hang_up("bye"))
    assert deleted == [True]
