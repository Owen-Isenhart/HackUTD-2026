"""ASGI entry: uv run uvicorn src.main:app --host 127.0.0.1 --port 8000"""
import os

from dotenv import load_dotenv

from src.call_state import CallStore
from src.calls_api import create_app
from src.livekit_dialer import LiveKitDialer
from src.settings import load_settings

load_dotenv(".env.local")
_settings = load_settings(os.environ)
app = create_app(_settings, LiveKitDialer(_settings), CallStore())
