"""Voice session routes: mint a LiveKit token that joins an app user to a
room and dispatches the voice agent."""
import base64
import binascii
import hashlib
import json
import logging
import os
import re
import time
import uuid
import wave
from datetime import timedelta
from typing import Callable, Optional

from fastapi import Depends, FastAPI, HTTPException
from livekit import api
from pydantic import BaseModel, Field, field_validator

from src import expo_voice
from src.livekit_dialer import AGENT_NAME
from src.settings import Settings

log = logging.getLogger("nessi.voice_routes")

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

    turns: dict = {}

    @app.post("/voice/turn")
    def voice_turn(req: VoiceTurnRequest):
        """One Expo Go tap-to-talk turn: WAV in, transcript + reply + spoken WAV out.

        Authenticated by the app user's own finance session (no service key in the app): the
        finance backend must accept the token before any speech service is called, and the
        summary it returns is owner-scoped, so a caller only ever hears their own data.
        """
        if not req.finance_token:
            raise HTTPException(status_code=401, detail="sign in first")
        summary = expo_voice.fetch_summary(os.getenv("FINANCE_API_URL", ""), req.finance_token)
        if summary is None:
            raise HTTPException(status_code=401, detail="finance session not accepted")
        key = hashlib.sha256(req.finance_token.encode()).hexdigest()[:16]
        now = time.monotonic()
        recent = [t for t in turns.get(key, []) if now - t < 60.0]
        if len(recent) >= 20:
            raise HTTPException(status_code=429, detail="too many voice turns")
        turns[key] = [*recent, now]
        try:
            audio = base64.b64decode(req.audio, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=400, detail="audio must be base64 WAV")
        if not audio or len(audio) > expo_voice.MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio too large")
        try:
            pcm, rate = expo_voice.read_wav(audio)
        except (ValueError, EOFError, wave.Error):
            raise HTTPException(status_code=400, detail="audio must be 16-bit PCM WAV")
        try:
            transcript = expo_voice.transcribe(pcm, rate, settings.nvidia_api_key)
        except Exception as exc:  # noqa: BLE001 - surface a clean error to the app
            log.warning("voice turn transcription failed: %s", type(exc).__name__)
            raise HTTPException(status_code=502, detail="speech recognition failed")
        if not transcript:
            return {"transcript": "", "reply": "I didn't catch that. Try again?", "navigate": None,
                    "audio": base64.b64encode(expo_voice.synthesize("I didn't catch that. Try again?", settings.nvidia_api_key, _voice())).decode()}
        knowledge = expo_voice.knowledge_from_summary(summary)
        try:
            reply, nav = expo_voice.answer(transcript, req.tab, knowledge, base_url=settings.nemotron_base_url,
                                           model=settings.nemotron_model, api_key=settings.nvidia_api_key)
        except Exception as exc:  # noqa: BLE001
            log.warning("voice turn answer failed: %s", type(exc).__name__)
            reply, nav = "Sorry, I couldn't answer that just now.", None
        try:
            spoken = base64.b64encode(expo_voice.synthesize(reply, settings.nvidia_api_key, _voice())).decode()
        except Exception as exc:  # noqa: BLE001 - the text still shows in the bubble
            log.warning("voice turn speech failed: %s", type(exc).__name__)
            spoken = None
        return {"transcript": transcript, "reply": reply, "navigate": nav, "audio": spoken, "live": bool(summary)}


def _voice() -> str:
    return (os.getenv("TTS_VOICE") or "").strip() or "Magpie-Multilingual.EN-US.Mia"


class VoiceTurnRequest(BaseModel):
    audio: str = Field(max_length=6_000_000)
    tab: Optional[str] = None
    finance_token: Optional[str] = Field(default=None, max_length=200)

    @field_validator("tab")
    @classmethod
    def _check_tab(cls, v):
        return v if v is None or v in expo_voice.PAGES else None
