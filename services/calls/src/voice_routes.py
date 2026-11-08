"""Voice session routes: mint a LiveKit token that joins an app user to a
room and dispatches the voice agent."""
import json
import re
import time
import uuid
from datetime import timedelta
from typing import Callable

from fastapi import Depends, FastAPI, HTTPException
from livekit import api
from pydantic import BaseModel, field_validator

from src.livekit_dialer import AGENT_NAME
from src.settings import Settings

USER_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
MAX_TTL = timedelta(minutes=10)
MIN_TTL = timedelta(seconds=1)
RATE_LIMIT = 5
RATE_WINDOW_S = 600.0


def new_room_name() -> str:
    return "app-voice-" + uuid.uuid4().hex[:12]


def build_voice_token(
    *,
    api_key: str,
    api_secret: str,
    user_id: str,
    room: str,
    ttl: timedelta = timedelta(minutes=10),
) -> str:
    if not USER_ID_RE.fullmatch(user_id):
        raise ValueError("invalid user_id")
    if not (MIN_TTL <= ttl <= MAX_TTL):
        raise ValueError("ttl must be between 1 second and 10 minutes")
    # identity_verified is true only because the app already authenticated the user.
    metadata = json.dumps(
        {"profile": "app_voice", "user_id": user_id, "scenario": "", "identity_verified": True}
    )
    return (
        api.AccessToken(api_key, api_secret)
        .with_identity(f"app-{user_id}")
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
                can_update_own_metadata=True,  # the app sets page/visible attributes for screen context
            )
        )
        .with_room_config(
            api.RoomConfiguration(
                agents=[api.RoomAgentDispatch(agent_name=AGENT_NAME, metadata=metadata)]
            )
        )
        .with_ttl(ttl)
        .to_jwt()
    )


class VoiceSessionRequest(BaseModel):
    user_id: str

    @field_validator("user_id")
    @classmethod
    def _check_user_id(cls, v: str) -> str:
        if not USER_ID_RE.fullmatch(v):
            raise ValueError("invalid user_id")
        return v


def add_voice_routes(app: FastAPI, settings: Settings, require_key: Callable) -> None:
    sessions: dict = {}

    @app.post("/voice/session", dependencies=[Depends(require_key)])
    def create_voice_session(req: VoiceSessionRequest):
        """Create a voice session token.

        For now the trusted backend supplies user_id; the real version must
        derive it from the app user's session, never from a client-controlled body.
        """
        now = time.monotonic()
        recent = [t for t in sessions.get(req.user_id, []) if now - t < RATE_WINDOW_S]
        if len(recent) >= RATE_LIMIT:
            sessions[req.user_id] = recent
            raise HTTPException(status_code=429, detail="too many voice sessions")
        recent.append(now)
        sessions[req.user_id] = recent
        room = new_room_name()
        token = build_voice_token(
            api_key=settings.livekit_api_key,
            api_secret=settings.livekit_api_secret,
            user_id=req.user_id,
            room=room,
        )
        return {"url": settings.livekit_url, "token": token, "room": room}
