"""Real Dialer: dispatch nessi-agent to a room, then create the SIP participant in that same room."""
import json
from typing import Optional

from livekit import api

from src.settings import Settings

AGENT_NAME = "nessi-agent"


class LiveKitDialer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    async def dial(self, room_name: str, to_number: str, scenario: Optional[str] = None,
                   user_id: str = "demo-user") -> None:
        lk = api.LiveKitAPI(self._s.livekit_url, self._s.livekit_api_key, self._s.livekit_api_secret)
        try:
            await lk.agent_dispatch.create_dispatch(
                api.CreateAgentDispatchRequest(
                    agent_name=AGENT_NAME, room=room_name, metadata=json.dumps({"user_id": user_id, "scenario": scenario or ""})
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
        finally:
            await lk.aclose()
