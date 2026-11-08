"""Authenticated call-initiation API. POST /calls only requests a dial; it never proves an answer."""
import hmac
import logging
import time
import uuid
import asyncio
from typing import Callable, Literal, Optional, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from livekit.api import SipCallError
from pydantic import BaseModel, Field, StrictBool

from src.call_state import CallStatus, CallStore
from src.numbers import OWN_NUMBER, is_allowed, normalize_e164
from src.settings import Settings
from src.voice_routes import add_voice_routes

log = logging.getLogger("nessi.calls")

RATE_LIMIT = 3
RATE_WINDOW_S = 600
SIP_OUTCOME = {408: CallStatus.no_answer, 480: CallStatus.no_answer, 486: CallStatus.busy, 603: CallStatus.declined}


class Dialer(Protocol):
    async def dial(self, room_name: str, to_number: str, scenario: Optional[str] = None,
                   user_id: str = "demo-user", *, call_id: Optional[str] = None,
                   profile: str = "phone_details", identity_verified: bool = False,
                   returning: bool = False) -> None: ...


class CallRequest(BaseModel):
    to_number: str
    profile: Literal["onboarding", "phone_details"] = "phone_details"
    identity_verified: StrictBool = False
    scenario: Optional[str] = Field(default=None, max_length=500)
    user_id: str = Field(default="demo-user", min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    idempotency_key: Optional[str] = Field(default=None, max_length=128)
    call_id: Optional[uuid.UUID] = None


# Expo's web dev server. A browser build of the app calls /voice/session from one of these.
DEV_WEB_ORIGINS = ("http://localhost:8081", "http://127.0.0.1:8081", "http://localhost:19006", "http://127.0.0.1:19006")


SessionSeeder = Callable[[str, str, str], bool]


def create_app(settings: Settings, dialer: Dialer, store: CallStore,
               seed_session: Optional[SessionSeeder] = None) -> FastAPI:
    """seed_session(room, user_id, number) pre-verifies an outbound phone_details call in the lookup
    service; it only succeeds when the number is the user's own linked phone in Tiger."""
    app = FastAPI(title="nessi-calls")
    # Explicit origins only, never "*". CORS does not replace the API key: every route still needs it.
    app.add_middleware(
        CORSMiddleware, allow_origins=[*DEV_WEB_ORIGINS, *settings.voice_allowed_origins],
        allow_methods=["POST", "OPTIONS"], allow_headers=["x-api-key", "content-type"], allow_credentials=False)

    def require_key(x_api_key: Optional[str] = Header(default=None)) -> None:
        if not x_api_key or not hmac.compare_digest(x_api_key, settings.calls_api_key):
            raise HTTPException(status_code=401, detail="invalid or missing API key")

    add_voice_routes(app, settings, require_key)  # in-app push-to-talk sessions (LiveKit only, no dialing)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.post("/calls", dependencies=[Depends(require_key)])
    async def create_call(req: CallRequest) -> dict:
        """Trusted server-to-server only: identity_verified requires the backend to have
        checked that to_number is registered to user_id. The allowlist alone is not identity.
        Onboarding always establishes identity itself.
        """
        if req.profile == 'onboarding' and (req.identity_verified or req.user_id == 'demo-user'):
            raise HTTPException(status_code=422, detail='Onboarding requires an explicit user and unverified identity')
        try:
            number = normalize_e164(req.to_number)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        if number == OWN_NUMBER or not is_allowed(number, settings.allowed_numbers):
            raise HTTPException(status_code=403, detail="number not allowed")

        call_id = str(req.call_id) if req.call_id else None
        if call_id and req.idempotency_key not in (None, call_id):
            raise HTTPException(status_code=422, detail="idempotency key must match call ID")
        key = call_id or req.idempotency_key or f"{number}:{int(time.time() // 60)}"
        # A replayed key returns the original record below without dialing again;
        # only genuinely new requests count against the rate limit.
        if not store.has_key(key) and store.recent_count(number, RATE_WINDOW_S) >= RATE_LIMIT:
            raise HTTPException(status_code=429, detail="too many calls to this number")

        room = f"nessi-out-{req.call_id.hex if req.call_id else uuid.uuid4().hex[:12]}"
        try:
            rec, created = store.create(key, number, room, req.scenario, call_id=call_id, user_id=req.user_id)
        except ValueError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        if not created:
            return {"call_id": rec.call_id, "room_name": rec.room_name,
                    "status": rec.status.value}
        try:
            verified = req.identity_verified
            if verified and req.profile == "phone_details" and seed_session is not None:
                # Seed before dialing, so the session is verified before the callee can speak. If the
                # lookup service does not confirm the link, the agent verifies the caller itself.
                verified = await asyncio.to_thread(seed_session, rec.room_name, req.user_id, number)
                log.info("phone_details session seeded call_id=%s verified=%s", rec.call_id, verified)
            metadata = {"profile": req.profile, "identity_verified": verified}
            if verified and seed_session is not None and req.profile == "phone_details":
                metadata["returning"] = True
            if call_id:
                metadata["call_id"] = call_id
            await dialer.dial(rec.room_name, number, req.scenario, req.user_id, **metadata)
        except Exception as e:
            outcome = SIP_OUTCOME.get(e.sip_status_code) if isinstance(e, SipCallError) else None
            if outcome:
                store.update(rec.call_id, outcome)
                log.info("dial completed call_id=%s outcome=%s", rec.call_id, outcome.value)
                return {"call_id": rec.call_id, "room_name": rec.room_name, "status": outcome.value}
            store.update(rec.call_id, CallStatus.failed)
            log.error("dial failed call_id=%s room=%s error_type=%s code=%s", rec.call_id, rec.room_name,
                      type(e).__name__, getattr(e, "code", None))
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
