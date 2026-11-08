"""Live smoke test for the in-app voice profile (needs .env.local with LiveKit + NVIDIA keys and a running agent).

Joins a room as the app with a token from build_voice_token, sets screen attributes, exercises the
push-to-talk RPCs, then types a request to the agent and waits for it to ask the app to navigate.
Usage (from services/calls): PYTHONPATH=. uv run python scripts/app_voice_smoke.py [user_id]
"""
import asyncio
import json
import os
import sys

from dotenv import load_dotenv
from livekit import rtc

load_dotenv(".env.local")
from src.voice_routes import build_voice_token, new_room_name  # noqa: E402


async def main(user_id: str) -> int:
    room_name = new_room_name()
    token = build_voice_token(api_key=os.environ["LIVEKIT_API_KEY"], api_secret=os.environ["LIVEKIT_API_SECRET"],
                              user_id=user_id, room=room_name)
    room = rtc.Room()
    navigated: list = []
    replies: list = []
    got_nav = asyncio.Event()

    async def on_navigate(data: rtc.RpcInvocationData) -> str:
        navigated.append(json.loads(data.payload))
        got_nav.set()
        return "ok"

    await room.connect(os.environ["LIVEKIT_URL"], token)
    room.local_participant.register_rpc_method("navigate", on_navigate)
    print("joined", room_name, "as", room.local_participant.identity)

    async def on_text(reader, participant_identity):
        replies.append(await reader.read_all())

    room.register_text_stream_handler("lk.transcription", lambda r, i: asyncio.ensure_future(on_text(r, i)))

    agent = None
    for _ in range(60):
        agent = next((p for p in room.remote_participants.values()
                      if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT), None)
        if agent:
            break
        await asyncio.sleep(0.5)
    if not agent:
        print("FAIL: agent never joined (is it running, and is the dispatch name nessi-agent?)")
        await room.disconnect()
        return 1
    print("agent joined:", agent.identity)

    await room.local_participant.set_attributes({"page": "spending", "visible": json.dumps(["Food", "Transport", "Fun"])})
    await asyncio.sleep(1.5)
    print("start_turn ->", await room.local_participant.perform_rpc(destination_identity=agent.identity, method="start_turn", payload=""))
    print("cancel_turn ->", await room.local_participant.perform_rpc(destination_identity=agent.identity, method="cancel_turn", payload=""))
    print("end_turn without start ->", await room.local_participant.perform_rpc(destination_identity=agent.identity, method="end_turn", payload=""))

    await room.local_participant.send_text("Please open the deals page.", topic="lk.chat")
    try:
        await asyncio.wait_for(got_nav.wait(), timeout=25)
        print("PASS: agent asked the app to navigate:", navigated)
        code = 0
    except asyncio.TimeoutError:
        print("FAIL: no navigate RPC within 25 s")
        code = 2
    await room.disconnect()
    return code


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "smoke-user")))
