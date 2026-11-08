"""Authenticated call-initiation API. POST /calls only requests a dial; it never proves an answer."""
import hmac
import logging
import time
import uuid
from typing import Optional, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from src.call_state import CallStatus, CallStore
from src.numbers import OWN_NUMBER, is_allowed, normalize_e164
from src.settings import Settings

log = logging.getLogger("nessi.calls")

RATE_LIMIT = 3
RATE_WINDOW_S = 600


class Dialer(Protocol):
    async def dial(self, room_name: str, to_number: str, scenario: Optional[str] = None,
                   user_id: str = "demo-user") -> None: ...


class CallRequest(BaseModel):
    to_number: str
    scenario: Optional[str] = Field(default=None, max_length=500)
    user_id: str = Field(default="demo-user", min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    idempotency_key: Optional[str] = Field(default=None, max_length=128)


def create_app(settings: Settings, dialer: Dialer, store: CallStore) -> FastAPI:
    app = FastAPI(title="nessi-calls")

    def require_key(x_api_key: Optional[str] = Header(default=None)) -> None:
        if not x_api_key or not hmac.compare_digest(x_api_key, settings.calls_api_key):
            raise HTTPException(status_code=401, detail="invalid or missing API key")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.post("/calls", dependencies=[Depends(require_key)])
    async def create_call(req: CallRequest) -> dict:
        try:
            number = normalize_e164(req.to_number)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        if number == OWN_NUMBER or not is_allowed(number, settings.allowed_numbers):
            raise HTTPException(status_code=403, detail="number not allowed")

        key = req.idempotency_key or f"{number}:{int(time.time() // 60)}"
        # A replayed key returns the original record below without dialing again;
        # only genuinely new requests count against the rate limit.
        if not store.has_key(key) and store.recent_count(number, RATE_WINDOW_S) >= RATE_LIMIT:
            raise HTTPException(status_code=429, detail="too many calls to this number")

        room = f"nessi-out-{uuid.uuid4().hex[:12]}"
        rec, created = store.create(key, number, room, req.scenario)
        if not created:
            return {"call_id": rec.call_id, "room_name": rec.room_name,
                    "status": rec.status.value}
        try:
            await dialer.dial(rec.room_name, number, req.scenario, req.user_id)
        except Exception as e:
            store.update(rec.call_id, CallStatus.failed)
            log.error("dial failed call_id=%s room=%s error=%s", rec.call_id, rec.room_name, e)
            raise HTTPException(status_code=502, detail="dial failed")
        log.info("dial_requested call_id=%s room=%s", rec.call_id, rec.room_name)
        return {"call_id": rec.call_id, "room_name": rec.room_name,
                "status": CallStatus.dial_requested.value}

    @app.get("/calls/{call_id}", dependencies=[Depends(require_key)])
    def get_call(call_id: str) -> dict:
        rec = store.get(call_id)
        if rec is None:
            raise HTTPException(status_code=404, detail="unknown call")
        return {"call_id": rec.call_id, "room_name": rec.room_name,
                "status": rec.status.value, "decision": rec.decision}

    return app
