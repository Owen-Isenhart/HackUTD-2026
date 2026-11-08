"""Real Dialer: dispatch nessi-agent to a room, then create the SIP participant in that same room."""
import asyncio
import json
import os
from typing import Optional

import logging

from livekit import api

from src.settings import Settings

AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "nessi-agent")
log = logging.getLogger("nessi.calls")


def is_first_dial_permission_denied(error: Exception) -> bool:
    """The first dial after a quiet period has returned SIP 403 permission_denied and then
    succeeded on an immediate retry (Calls.md open item)."""
    return getattr(error, "sip_status_code", None) == 403 or getattr(error, "code", None) == "permission_denied"


async def create_participant_with_retry(create, request, *, delay: float = 1.0):
    """One bounded retry, only for that error. Anything else (busy, no answer, declined) is final."""
    try:
        return await create(request)
    except Exception as error:
        if not is_first_dial_permission_denied(error):
            raise
        log.warning("SIP 403 permission_denied on dial; retrying once")
        await asyncio.sleep(delay)
        return await create(request)


class LiveKitDialer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    async def dial(self, room_name: str, to_number: str, scenario: Optional[str] = None,
                   user_id: str = "demo-user", *, call_id: Optional[str] = None,
                   profile: str = "phone_details", identity_verified: bool = False,
                   returning: bool = False) -> None:
        lk = api.LiveKitAPI(self._s.livekit_url, self._s.livekit_api_key, self._s.livekit_api_secret)
        metadata = {"user_id": user_id, "scenario": scenario or "",
                    "profile": profile, "identity_verified": identity_verified, "phone_number": to_number}
        if call_id:
            metadata["call_id"] = call_id
        if returning:
            metadata["returning"] = True
        try:
            await lk.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(
                    agent_name=AGENT_NAME, room=room_name, metadata=json.dumps(metadata)
                )
            )
            request = api.CreateSIPParticipantRequest(
                sip_trunk_id=self._s.outbound_trunk_id,
                sip_call_to=to_number,
                room_name=room_name,
                participant_identity="phone_user",
                participant_name="Recipient",
                wait_until_answered=True,
            )
            await create_participant_with_retry(lk.sip.create_sip_participant, request)
        except api.SipCallError:
            try:
                await lk.room.delete_room(api.DeleteRoomRequest(room=room_name))
            except Exception:
                log.warning("could not remove room after SIP rejection room=%s", room_name)
            raise
        finally:
            await lk.aclose()
