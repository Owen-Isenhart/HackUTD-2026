"""Typed environment loading."""
from dataclasses import dataclass
from typing import Mapping, Optional

from src.numbers import normalize_e164

DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"
DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"


@dataclass(frozen=True)
class Settings:
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    nvidia_api_key: str
    nemotron_base_url: str
    nemotron_model: str
    outbound_trunk_id: str
    calls_api_key: str
    allowed_numbers: frozenset
    notes_db: str
    recommendation_api_url: Optional[str] = None


def _req(env: Mapping, name: str) -> str:
    v = env.get(name, "").strip()
    if not v:
        raise ValueError(f"missing required environment variable: {name}")
    return v


def load_settings(env: Mapping) -> Settings:
    url = _req(env, "LIVEKIT_URL")
    if not url.startswith("wss://"):
        raise ValueError("LIVEKIT_URL must be a wss:// URL, not a SIP address")
    allowed = frozenset(
        normalize_e164(p) for p in env.get("DEMO_ALLOWED_NUMBERS", "").split(",") if p.strip()
    )
    return Settings(
        livekit_url=url,
        livekit_api_key=_req(env, "LIVEKIT_API_KEY"),
        livekit_api_secret=_req(env, "LIVEKIT_API_SECRET"),
        nvidia_api_key=_req(env, "NVIDIA_API_KEY"),
        nemotron_base_url=env.get("NEMOTRON_BASE_URL", "").strip() or DEFAULT_BASE_URL,
        nemotron_model=env.get("NEMOTRON_MODEL", "").strip() or DEFAULT_MODEL,
        outbound_trunk_id=_req(env, "LIVEKIT_OUTBOUND_TRUNK_ID"),
        calls_api_key=_req(env, "CALLS_API_KEY"),
        allowed_numbers=allowed,
        notes_db=env.get("DEMO_NOTES_DB", "").strip() or "demo_call_notes.sqlite3",
        recommendation_api_url=env.get("RECOMMENDATION_API_URL", "").strip() or None,
    )
