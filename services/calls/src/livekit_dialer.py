"""Real Dialer: dispatch nessi-agent to a room, then create the SIP participant in that same room."""
import json
import os
from typing import Optional

import logging

from livekit import api

from src.settings import Settings

AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "nessi-agent")
log = logging.getLogger("nessi.calls")


class LiveKitDialer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    async def dial(self, room_name: str, to_number: str, scenario: Optional[str] = None,
                   user_id: str = "demo-user", *, call_id: Optional[str] = None,
                   profile: str = "phone_details", identity_verified: bool = False) -> None:
        lk = api.LiveKitAPI(self._s.livekit_url, self._s.livekit_api_key, self._s.livekit_api_secret)
        metadata = {"user_id": user_id, "scenario": scenario or "",
                    "profile": profile, "identity_verified": identity_verified, "phone_number": to_number}
        if call_id:
            metadata["call_id"] = call_id
        try:
            await lk.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(
                    agent_name=AGENT_NAME, room=room_name, metadata=json.dumps(metadata)
                )
            )
            await lk.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    sip_trunk_id=self._s.outbound_trunk_id,
                    sip_call_to=to_number,
                    room_name=room_name,
                    participant_identity="phone_user",
                    participant_name="Recipient",
                    wait_until_answered=True,
                )
            )
        except api.SipCallError:
            try:
                await lk.room.delete_room(api.DeleteRoomRequest(room=room_name))
            except Exception:
                log.warning("could not remove room after SIP rejection room=%s", room_name)
            raise
        finally:
            await lk.aclose()
