import asyncio
from types import SimpleNamespace

import pytest
from livekit import rtc

from src.push_to_talk import PushToTalk

APP = "app-alex"


def run(coro):
    return asyncio.run(coro)


class FakeSession:
    def __init__(self, interrupt_raises=False):
        self.events = []
        self.interrupt_raises = interrupt_raises
        self.input = SimpleNamespace(set_audio_enabled=lambda on: self.events.append(("audio", on)))
        self.room_io = SimpleNamespace(set_participant=lambda ident: self.events.append(("listen_to", ident)))
        self.handlers = {}

    def on(self, name, fn):
        self.handlers[name] = fn

    def interrupt(self):
        self.events.append(("interrupt",))
        if self.interrupt_raises:
            raise RuntimeError("uninterruptible speech")

    def clear_user_turn(self):
        self.events.append(("clear",))

    async def commit_user_turn(self, **kw):
        self.events.append(("commit", kw))
        return "hello"


class FakeRoom:
    def __init__(self):
        self.methods = {}
        self.rpcs = []

        async def perform_rpc(**kw):
            self.rpcs.append(kw)
            return "ok"

        self.local_participant = SimpleNamespace(
            register_rpc_method=lambda name, fn: self.methods.__setitem__(name, fn), perform_rpc=perform_rpc)


def data(caller=APP):
    return SimpleNamespace(caller_identity=caller, payload="")


def make(idle_seconds=120.0, on_idle=None, silence=0.05, **kw):
    session, room = FakeSession(**kw), FakeRoom()
    ptt = PushToTalk(session, room, APP, idle_seconds=idle_seconds, on_idle=on_idle or (lambda: None), silence_seconds=silence)
    ptt.attach()
    return ptt, session, room


def test_attach_mutes_input_and_registers_the_three_turn_methods():
    _, session, room = make()
    assert session.events == [("audio", False)]
    assert set(room.methods) == {"start_turn", "end_turn", "cancel_turn"}


def test_start_turn_interrupts_clears_targets_the_app_and_opens_the_mic_in_order():
    _, session, room = make()
    session.events.clear()
    assert run(room.methods["start_turn"](data())) == "ok"
    assert session.events == [("interrupt",), ("clear",), ("listen_to", APP), ("audio", True)]


def test_start_turn_from_another_identity_is_refused_and_touches_nothing():
    _, session, room = make()
    session.events.clear()
    with pytest.raises(rtc.RpcError):
        run(room.methods["start_turn"](data("app-mallory")))
    assert session.events == []


def test_uninterruptible_speech_does_not_block_a_new_turn():
    _, session, room = make(interrupt_raises=True)
    session.events.clear()
    assert run(room.methods["start_turn"](data())) == "ok"
    assert ("audio", True) in session.events


def test_end_turn_closes_the_mic_before_committing_with_a_bounded_wait():
    _, session, room = make()
    run(room.methods["start_turn"](data()))
    session.events.clear()
    assert run(room.methods["end_turn"](data())) == "ok"
    assert session.events[0] == ("audio", False)
    assert session.events[1][0] == "commit" and session.events[1][1]["transcript_timeout"] == 3.0


def test_end_turn_without_a_start_is_ignored():
    _, session, room = make()
    session.events.clear()
    assert run(room.methods["end_turn"](data())) == "ignored"
    assert session.events == []


def test_cancel_turn_discards_the_input_without_committing():
    _, session, room = make()
    run(room.methods["start_turn"](data()))
    session.events.clear()
    assert run(room.methods["cancel_turn"](data())) == "ok"
    assert session.events == [("audio", False), ("clear",)]


def test_end_and_cancel_from_another_identity_are_refused():
    _, session, room = make()
    run(room.methods["start_turn"](data()))
    session.events.clear()
    for name in ("end_turn", "cancel_turn"):
        with pytest.raises(rtc.RpcError):
            run(room.methods[name](data("app-mallory")))
    assert session.events == []


def test_idle_session_ends_after_the_timeout_and_activity_resets_it():
    fired = []

    async def scenario():
        ptt, _, room = make(idle_seconds=0.15, on_idle=lambda: fired.append(True))
        ptt.start_idle_watch()
        await asyncio.sleep(0.1)
        await room.methods["start_turn"](data())  # activity re-arms the timer
        await asyncio.sleep(0.1)
        assert fired == []
        await asyncio.sleep(0.2)
        return fired

    assert run(scenario()) == [True]


def test_detach_cancels_the_idle_watch():
    fired = []

    async def scenario():
        ptt, _, _ = make(idle_seconds=0.05, on_idle=lambda: fired.append(True))
        ptt.start_idle_watch()
        ptt.stop()
        await asyncio.sleep(0.15)

    run(scenario())
    assert fired == []


def state(old, new):
    return SimpleNamespace(old_state=old, new_state=new)


def test_silence_after_speech_ends_the_turn_and_tells_the_app():
    async def scenario():
        _, session, room = make()
        await room.methods["start_turn"](data())
        session.events.clear()
        session.handlers["user_state_changed"](state("listening", "speaking"))
        session.handlers["user_state_changed"](state("speaking", "listening"))
        await asyncio.sleep(0.2)
        return session, room

    session, room = run(scenario())
    assert session.events[0] == ("audio", False)
    assert session.events[1][0] == "commit"
    assert [r["method"] for r in room.rpcs] == ["turn_ended"] and room.rpcs[0]["destination_identity"] == APP


def test_speaking_again_before_the_pause_ends_cancels_the_auto_end():
    async def scenario():
        _, session, room = make(silence=0.15)
        await room.methods["start_turn"](data())
        session.events.clear()
        session.handlers["user_state_changed"](state("listening", "speaking"))
        session.handlers["user_state_changed"](state("speaking", "listening"))
        await asyncio.sleep(0.05)
        session.handlers["user_state_changed"](state("listening", "speaking"))
        await asyncio.sleep(0.25)
        return session, room

    session, room = run(scenario())
    assert session.events == [] and room.rpcs == []


def test_no_auto_end_when_the_turn_is_closed_or_nothing_was_said():
    async def scenario():
        _, session, room = make()
        session.handlers["user_state_changed"](state("speaking", "listening"))  # no open turn
        await room.methods["start_turn"](data())
        session.events.clear()
        session.handlers["user_state_changed"](state("listening", "listening"))  # never spoke
        await asyncio.sleep(0.2)
        return session, room

    session, room = run(scenario())
    assert session.events == [] and room.rpcs == []


def test_manual_end_after_an_auto_end_is_ignored():
    async def scenario():
        _, session, room = make()
        await room.methods["start_turn"](data())
        session.handlers["user_state_changed"](state("listening", "speaking"))
        session.handlers["user_state_changed"](state("speaking", "listening"))
        await asyncio.sleep(0.2)
        return await room.methods["end_turn"](data())

    assert run(scenario()) == "ignored"
