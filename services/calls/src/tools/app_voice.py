"""Tools that only the in-app voice profile exposes (see prompts/implementation/app_voice.md)."""
import logging

from livekit.agents import function_tool

from src import navigation
from src.tools import register

log = logging.getLogger("nessi.agent")


@register("navigate_app")
def build_navigate_tool(agent):
    """Open an app screen over RPC. The agent is bound to the app participant after it joins."""

    async def navigate_app(destination: str) -> dict:
        if agent.app_room is None or not agent.app_identity:
            return {"ok": False, "error": "app not connected"}
        res = await navigation.navigate(agent.app_room, agent.app_identity, destination)
        log.info("tool navigate_app dest=%r ok=%s error=%s", destination, res.get("ok"), res.get("error"))
        return res

    return function_tool(
        navigate_app, name="navigate_app",
        description="Open a screen in the app. destination must be one of: " + ", ".join(sorted(navigation.ROUTES)) + ".")
