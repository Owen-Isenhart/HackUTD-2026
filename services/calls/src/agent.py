"""LiveKit voice agent `nessi-agent`: NVIDIA STT + Nemotron LLM + NVIDIA Magpie TTS.

Run locally:  uv run python -m src.agent dev
STT default is Parakeet streaming ASR (not Nemotron ASR); Nemotron is the reasoning LLM.
"""
import asyncio
import json
import logging
import os
import time
from typing import Optional

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, RunContext, function_tool
from livekit.agents.beta.tools import EndCallTool
from livekit.plugins import nvidia, openai

from src import demo_tools, recommend
from src.livekit_dialer import AGENT_NAME
from src.settings import DEFAULT_BASE_URL, DEFAULT_MODEL

load_dotenv(".env.local")
log = logging.getLogger("nessi.agent")

DEFAULT_USER_ID = "demo-user"  # used for inbound calls, which carry no backend-set metadata

INSTRUCTIONS = """You are Nessiessential's AI assistant on a phone call. This is speech: reply in ONE short
sentence, no lists, no filler. You already said hello and the scenario.
When the caller says anything about what to buy, eat or spend, call respond_to_caller with their
words exactly as said. It returns JSON. If it says "status": "unavailable" or ok is false, say exactly:
"We can't process that right now. Any other questions?" Never mention dummy, sample or placeholder
data. Otherwise say its main suggestion in one sentence and ask if they want it. Use only facts in the
JSON; never invent prices, balances or savings.
Ending: if the caller says no, no thanks, never mind, that's all, nothing else, goodbye, or otherwise
declines or finishes, call end_call right away (it says goodbye and hangs up). If a suggestion was
offered and they accepted or declined it, call record_decision first. Call check_connection or
save_call_note only when the caller asks."""


class NessiAgent(Agent):
    def __init__(self, scenario: Optional[str], room_name: str, user_id: str = DEFAULT_USER_ID) -> None:
        super().__init__(
            instructions=INSTRUCTIONS + (f"\nScenario: {scenario}" if scenario else ""),
            tools=[EndCallTool(
                extra_description="Call when the caller declines, says no, never mind, that's all, nothing else or goodbye.",
                end_instructions="Say one short goodbye.",
            )],
        )
        self._scenario = scenario or ""
        self._room = room_name
        self._db = os.getenv("DEMO_NOTES_DB", "demo_call_notes.sqlite3")
        self._user_id = user_id  # set by the backend at dial time; never supplied by the LLM
        self._api_url = os.getenv("RECOMMENDATION_API_URL") or None
        self.decision: Optional[str] = None

    @function_tool
    async def check_connection(self, context: RunContext) -> dict:
        """Check that the backend tools are reachable."""
        res = demo_tools.check_connection()
        log.info("tool check_connection room=%s result=%s", self._room, res)
        return res

    @function_tool
    async def save_call_note(self, context: RunContext, note: str) -> dict:
        """Save a short, non-sensitive note the caller explicitly asked to save."""
        res = demo_tools.save_call_note(self._db, self._room, note)
        log.info("tool save_call_note room=%s ok=%s", self._room, res.get("ok"))
        return res

    @function_tool
    async def respond_to_caller(self, context: RunContext, caller_words: str) -> dict:
        """Send the caller's exact words to the recommendation service and get JSON suggestions back."""
        t0 = time.monotonic()
        res = await asyncio.to_thread(  # blocking HTTP must not stall the audio loop
            recommend.evaluate_reply, self._user_id, self._scenario, caller_words, self._api_url)
        ms = int((time.monotonic() - t0) * 1000)
        log.info("tool respond_to_caller room=%s ok=%s source=%s endpoint_ms=%d", self._room,
                 res.get("ok"), res.get("source"), ms)
        return res

    @function_tool
    async def record_decision(self, context: RunContext, accepted: bool) -> dict:
        """Record whether the caller accepted or declined the recommendation."""
        self.decision = "accepted" if accepted else "declined"
        log.info("tool record_decision room=%s decision=%s", self._room, self.decision)
        return {"ok": True, "decision": self.decision}


def opening_line(scenario: Optional[str]) -> str:
    """Fixed spoken opening: no LLM round trip, always discloses it is an AI. Scenario is spoken as given."""
    line = "Hi, I'm Nessiessential's AI assistant."
    if scenario:
        line += " " + scenario.strip()
    return line


def parse_metadata(raw: Optional[str]):
    """Dispatch metadata is JSON {"user_id", "scenario"} set by the backend; tolerate absence/garbage."""
    try:
        data = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    return data.get("scenario") or None, data.get("user_id") or DEFAULT_USER_ID


def attach_call_logging(session: AgentSession, room_name: str) -> None:
    """Log conversation metadata, state changes and per-turn metrics; text only if LOG_TRANSCRIPTS=1."""

    @session.on("conversation_item_added")
    def _item(ev) -> None:
        item = ev.item
        text = getattr(item, "text_content", None)
        if not text:
            return
        role = getattr(item, "role", "?")
        metrics = getattr(item, "metrics", None)
        if os.getenv("LOG_TRANSCRIPTS") == "1":  # off by default: spoken words are personal data
            log.info("say room=%s role=%s text=%r metrics=%s", room_name, role, text[:300], metrics)
        else:
            log.info("say room=%s role=%s chars=%d metrics=%s", room_name, role, len(text), metrics)

    @session.on("user_state_changed")
    def _user(ev) -> None:
        log.info("user_state room=%s %s->%s", room_name, ev.old_state, ev.new_state)

    @session.on("agent_state_changed")
    def _agent(ev) -> None:
        log.info("agent_state room=%s %s->%s", room_name, ev.old_state, ev.new_state)

    @session.on("error")
    def _err(ev) -> None:
        log.error("session error room=%s %s", room_name, ev.error)


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: agents.JobContext) -> None:
    session = AgentSession(
        stt=nvidia.STT(language_code="en-US"),
        llm=openai.LLM(
            model=os.getenv("NEMOTRON_MODEL") or DEFAULT_MODEL,
            base_url=os.getenv("NEMOTRON_BASE_URL") or DEFAULT_BASE_URL,
            temperature=0.3,  # steadier tool calls than the model's default of 1.0
            # Thinking off: first token ~0.3s instead of 4-6s after a tool result, and no empty replies.
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            # Self-hosted vLLM (Brev) takes any token; hosted NVIDIA needs the real key.
            api_key=os.getenv("NEMOTRON_API_KEY") or os.environ["NVIDIA_API_KEY"],
        ),
        tts=nvidia.TTS(voice="Magpie-Multilingual.EN-US.Leo", language_code="en-US"),
        turn_detection="stt",
        session_close_transcript_timeout=0.1,  # default 2.0 s delayed hang-up after goodbye
    )
    attach_call_logging(session, ctx.room.name)
    scenario, user_id = parse_metadata(ctx.job.metadata)
    await session.start(room=ctx.room, agent=NessiAgent(scenario, ctx.room.name, user_id))
    await asyncio.sleep(0.8)  # let the phone media path settle so the first words are not clipped
    await session.say(opening_line(scenario), allow_interruptions=False)


if __name__ == "__main__":
    agents.cli.run_app(server)
