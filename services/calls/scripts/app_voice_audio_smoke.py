"""Live AUDIO smoke test for the in-app voice profile.

Joins as the app, publishes synthesized speech as the microphone between start_turn and end_turn,
and waits for the agent to ask the app to navigate. Exercises the real path: push-to-talk RPCs,
manual turn control, NVIDIA speech-to-text, on_user_turn_completed and the navigate RPC.
Needs .env.local (LiveKit + NVIDIA keys) and a running agent (scripts/dev_up.sh).
Usage (from services/calls): PYTHONPATH=. uv run python scripts/app_voice_audio_smoke.py ["open the budgets page"]
"""
import asyncio
import json
import os
import sys
import time

from dotenv import load_dotenv
from livekit import rtc
from livekit.plugins import nvidia

load_dotenv(".env.local")
from src.voice_routes import build_voice_token, new_room_name  # noqa: E402


async def synth(text: str) -> list:
    tts = nvidia.TTS(voice="Magpie-Multilingual.EN-US.Leo", language_code="en-US")
    frames = [ev.frame async for ev in tts.synthesize(text)]
    await tts.aclose()
    return frames


async def main(phrase: str) -> int:
    frames = await synth(phrase)
    sr, ch = frames[0].sample_rate, frames[0].num_channels
    print(f"synthesized {len(frames)} frames at {sr} Hz for: {phrase!r}")

    room_name = new_room_name()
    token = build_voice_token(api_key=os.environ["LIVEKIT_API_KEY"], api_secret=os.environ["LIVEKIT_API_SECRET"],
                              user_id="audio-smoke", room=room_name)
    room = rtc.Room()
    navigated: list = []
    got_nav = asyncio.Event()

    async def on_navigate(data: rtc.RpcInvocationData) -> str:
        navigated.append((json.loads(data.payload), time.monotonic()))
        got_nav.set()
        return "ok"

    await room.connect(os.environ["LIVEKIT_URL"], token)
    room.local_participant.register_rpc_method("navigate", on_navigate)

    agent = None
    for _ in range(60):
        agent = next((p for p in room.remote_participants.values()
                      if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT), None)
        if agent:
            break
        await asyncio.sleep(0.5)
    if not agent:
        print("FAIL: agent never joined")
        await room.disconnect()
        return 1

    source = rtc.AudioSource(sr, ch)
    track = rtc.LocalAudioTrack.create_audio_track("mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
    await room.local_participant.set_attributes({"page": "account", "visible": json.dumps(["Profile", "Linked accounts"])})
    await asyncio.sleep(1.5)

    rpc = room.local_participant.perform_rpc
    print("start_turn ->", await rpc(destination_identity=agent.identity, method="start_turn", payload=""))
    silence = rtc.AudioFrame.create(sr, ch, sr // 2)  # 0.5 s of silence before and after
    await source.capture_frame(silence)
    for f in frames:
        await source.capture_frame(f)
    await source.capture_frame(silence)
    await source.wait_for_playout()
    released = time.monotonic()
    print("end_turn ->", await rpc(destination_identity=agent.identity, method="end_turn", payload=""))

    try:
        await asyncio.wait_for(got_nav.wait(), timeout=25)
        payload, at = navigated[0]
        print(f"PASS: app was asked to navigate {payload} {at - released:.1f}s after the button was released")
        code = 0
    except asyncio.TimeoutError:
        print("FAIL: no navigate RPC within 25 s (see logs/agent.log for the transcript and any errors)")
        code = 2
    await asyncio.sleep(1.0)  # let the agent's reply finish before leaving
    await room.disconnect()
    return code


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "Open the deals page.")))
