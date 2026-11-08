"""Push-to-talk turn control for the in-app voice profile (LiveKit manual turn detection).

The app calls three RPC methods on the agent: start_turn when the talk button is pressed,
end_turn when it is released, cancel_turn when the press is abandoned. Audio input stays
disabled between turns, so background noise is never transcribed. Every call is checked against
the app participant's identity; anyone else in the room is refused.
Pattern from LiveKit's docs, "Turns overview: manual turn control".
"""
import asyncio
import logging
from typing import Callable, Optional

from livekit import rtc

log = logging.getLogger("nessi.ptt")

FORBIDDEN = 1403  # application error code for "not the app participant"


class PushToTalk:
    def __init__(self, session, room, app_identity: str, *, idle_seconds: float = 120.0,
                 on_idle: Optional[Callable[[], object]] = None, silence_seconds: float = 0.7) -> None:
        self._session = session
        self._room = room
        self._app = app_identity
        self._idle_seconds = idle_seconds
        self._on_idle = on_idle
        self._listening = False
        self._idle_task: Optional[asyncio.Task] = None
        self._watching = False
        self._silence = silence_seconds
        self._spoke = False
        self._auto_task: Optional[asyncio.Task] = None

    def attach(self) -> None:
        """Mute input and register the three RPC methods. Call once, before the user can speak."""
        self._session.input.set_audio_enabled(False)
        participant = self._room.local_participant
        participant.register_rpc_method("start_turn", self._start_turn)
        participant.register_rpc_method("end_turn", self._end_turn)
        participant.register_rpc_method("cancel_turn", self._cancel_turn)
        self._session.on("user_state_changed", self._on_user_state)

    def start_idle_watch(self) -> None:
        self._watching = True
        self._arm_idle()

    def stop(self) -> None:
        self._cancel_auto()
        self._watching = False
        if self._idle_task:
            self._idle_task.cancel()
            self._idle_task = None

    def _check(self, data: "rtc.RpcInvocationData") -> None:
        if data.caller_identity != self._app:
            raise rtc.RpcError(FORBIDDEN, "not the app participant")

    def _arm_idle(self) -> None:
        if not self._watching:
            return
        if self._idle_task:
            self._idle_task.cancel()
        self._idle_task = asyncio.get_running_loop().create_task(self._idle_timer())

    async def _idle_timer(self) -> None:
        await asyncio.sleep(self._idle_seconds)
        log.warning("voice session idle for %.0fs; ending", self._idle_seconds)
        if self._on_idle:
            result = self._on_idle()
            if asyncio.iscoroutine(result):
                await result

    def _cancel_auto(self) -> None:
        if self._auto_task:
            self._auto_task.cancel()
            self._auto_task = None

    def _on_user_state(self, ev) -> None:
        """VAD: once the user has spoken and then stays quiet, end the turn without a second tap."""
        if not self._listening:
            return
        if ev.new_state == "speaking":
            self._spoke = True
            self._cancel_auto()
        elif ev.old_state == "speaking" and ev.new_state == "listening" and self._spoke:
            self._cancel_auto()
            self._auto_task = asyncio.get_running_loop().create_task(self._auto_end())

    async def _auto_end(self) -> None:
        await asyncio.sleep(self._silence)
        self._auto_task = None
        if not self._listening:
            return
        log.info("silence after speech; ending the turn")
        await self._finish()
        try:  # tell the app so it closes its mic and shows "thinking"
            await self._room.local_participant.perform_rpc(
                destination_identity=self._app, method="turn_ended", payload="", response_timeout=5.0)
        except Exception as e:  # the app may already have tapped to send
            log.info("turn_ended notice failed: %s", e)

    async def _finish(self) -> None:
        self._listening = False
        self._spoke = False
        self._session.input.set_audio_enabled(False)
        self._arm_idle()
        # Resolves with the transcript once STT finishes; short bounds keep the reply fast and a slow STT from hanging.
        await self._session.commit_user_turn(transcript_timeout=3.0, stt_flush_duration=0.6)

    async def _start_turn(self, data) -> str:
        self._check(data)
        try:
            self._session.interrupt()  # stop any agent speech
        except RuntimeError:
            log.info("agent speech could not be interrupted; continuing")
        self._session.clear_user_turn()
        self._cancel_auto()
        self._spoke = False
        self._session.room_io.set_participant(data.caller_identity)  # listen only to the app
        self._session.input.set_audio_enabled(True)
        self._listening = True
        self._arm_idle()
        return "ok"

    async def _end_turn(self, data) -> str:
        self._check(data)
        if not self._listening:
            return "ignored"
        self._cancel_auto()
        await self._finish()
        return "ok"

    async def _cancel_turn(self, data) -> str:
        self._check(data)
        self._cancel_auto()
        self._listening = False
        self._spoke = False
        self._session.input.set_audio_enabled(False)
        self._session.clear_user_turn()
        self._arm_idle()
        return "ok"
