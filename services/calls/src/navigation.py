"""Ask the mobile app (a LiveKit participant) to open a screen via RPC."""

import json
import re
from typing import Optional

ROUTES = frozenset({"deals", "spending", "upcoming", "account"})  # the tabs of app/


async def navigate(room, app_identity: str, destination) -> dict:
    if not isinstance(destination, str):
        return {"ok": False, "error": "unknown destination"}
    dest = destination.strip().lower()
    if dest not in ROUTES:
        return {"ok": False, "error": "unknown destination"}
    try:
        await room.local_participant.perform_rpc(
            destination_identity=app_identity,
            method="navigate",
            payload=json.dumps({"route": dest}),
            response_timeout=5.0,
        )
    except Exception as exc:  # noqa: BLE001 - never raise to the agent
        msg = (str(exc) or type(exc).__name__).replace("\n", " ")
        return {"ok": False, "error": msg[:120]}
    return {"ok": True, "opened": dest}


_SINGULAR = {"deal": "deals"}
_NAV = re.compile(
    r"^(?:please )?(?:(?:can|could|would) you )?(?:please )?"
    r"(?:open|go to|show me|show|take me to|navigate to|switch to)(?: the| my)? "
    r"([a-z ]+?)(?: page| screen| tab| section)?(?: please)?$")


def match_destination(text) -> Optional[str]:
    """A clear 'open budgets' style request -> its route, else None (the model handles anything fuzzy).

    Whole-sentence match only: 'open the budgets page and delete everything' is not a navigation request.
    """
    if not isinstance(text, str):
        return None
    t = re.sub(r"\s+", " ", re.sub(r"[^a-z' ]", " ", text.lower())).strip()
    m = _NAV.match(t)
    if not m:
        return None
    word = m.group(1).strip()
    word = _SINGULAR.get(word, word)
    return word if word in ROUTES else None
