"""ASGI entry: uv run uvicorn src.main:app --host 127.0.0.1 --port 8000"""
import os

from dotenv import load_dotenv

load_dotenv(".env.local")

from src.call_state import CallStore
from src.calls_api import create_app
from src.livekit_dialer import LiveKitDialer
from src.recommend import seed_verified_session
from src.settings import load_settings

_settings = load_settings(os.environ)
_sessions_url = os.getenv("VOICE_SESSIONS_URL", "").strip() or None


def _seed(room: str, user_id: str, number: str) -> bool:
    return bool(_sessions_url) and seed_verified_session(_sessions_url, room, user_id, number)


app = create_app(_settings, LiveKitDialer(_settings), CallStore(), seed_session=_seed if _sessions_url else None)
