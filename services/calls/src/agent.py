"""LiveKit voice agent `nessi-agent`: NVIDIA STT + Nemotron LLM + NVIDIA Magpie TTS.

Run locally:  uv run python -m src.agent dev
STT default is Parakeet streaming ASR (not Nemotron ASR); Nemotron is the reasoning LLM.
"""
import asyncio
import json
import logging
import os
import re
import time
from uuid import UUID
from urllib.parse import urlparse
from typing import Optional

from dotenv import load_dotenv

load_dotenv(".env.local")
from livekit import agents, rtc
from livekit.agents import (Agent, AgentServer, AgentSession, RunContext, StopResponse,
                            get_job_context)
from livekit.plugins import nvidia, openai

from src import demo_tools, recommend
from src.profiles import CallContext, Profile, get_profile, build_instructions
from src.tools import build_tools
from src.livekit_dialer import AGENT_NAME
from src.numbers import normalize_e164
from src.settings import DEFAULT_BASE_URL, DEFAULT_MODEL

NVIDIA_HOST = "integrate.api.nvidia.com"

log = logging.getLogger("nessi.agent")

END_PHRASE = re.compile(
    r"^(no )?(thanks|thank you|that's all|that is all|that'll be all|that will be all|that's it|nothing|nothing else|i'm good|i am good|"
    r"i'm done|goodbye|bye|never ?mind)$|^(no|nope|stop)$"
)
DECLINE_PHRASE = re.compile(r"^(no|nope|no thanks|no thank you|never ?mind)$")
ACCEPT_PHRASE = re.compile(r"^(yes|yes please|sounds good|i'll take it)$")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", (text or "").lower())).strip()


def is_end_phrase(text: str) -> bool:
    """True when a short caller utterance means 'I'm done'. Whole-utterance match only, so
    'no wait, what about vegan?' never hangs up."""
    return bool(END_PHRASE.match(_norm(text)))


def sensitive_onboarding_input(text: str) -> bool:
    """Reject obvious oversharing before it can be forwarded to the lookup service."""
    digits = {'zero', 'oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'}
    count = 0
    for token in re.findall(r"[a-z]+|[0-9]+", text.lower()):
        count = count + len(token) if token.isdigit() else count + 1 if token in digits else 0
        if count > 4:
            return True
    return bool(re.search(r"\b(cvv|cvc|pin|password|social security|date of birth|expiry|expiration)\b", text, re.I))


async def wait_until_answered(room, participant, timeout: float = 60.0) -> bool:
    """Outbound SIP participants join the room while the phone still rings; wait for 'active'."""
    attr = "sip.callStatus"
    if participant.attributes.get(attr) == "active":
        return True
    done = asyncio.Event()

    def on_attrs(changed, p) -> None:
        if p.identity == participant.identity and p.attributes.get(attr) == "active":
            done.set()

    room.on("participant_attributes_changed", on_attrs)
    try:
        if participant.attributes.get(attr) == "active":
            return True
        await asyncio.wait_for(done.wait(), timeout)
        return True
    except asyncio.TimeoutError:
        return False
    finally:
        room.off("participant_attributes_changed", on_attrs)


async def enforce_max_duration(ctx, seconds: int) -> None:
    """Safety net: end the call for everyone after `seconds`, whatever the conversation is doing."""
    await asyncio.sleep(seconds)
    log.warning("max call duration reached room=%s; ending call", ctx.room.name)
    await ctx.delete_room()


class NessiAgent(Agent):
    def __init__(self, scenario: Optional[str], room_name: str, user_id: Optional[str] = None,
                 call_id: Optional[str] = None, *, profile: Optional[Profile] = None,
                 ctx: Optional[CallContext] = None) -> None:
        self.profile = profile or get_profile(ctx.profile if ctx else None)
        ctx = ctx or CallContext(profile=self.profile.name, scenario=scenario or '', user_id=user_id, call_id=call_id)
        scenario, user_id, call_id = ctx.scenario, ctx.user_id, ctx.call_id
        self._phone_number = ctx.phone_number
        super().__init__(instructions=build_instructions(self.profile, ctx), tools=build_tools(self.profile.tools, self))
        self._offered = False  # a real suggestion was spoken, so a plain 'no' means decline
        self._hanging_up = False
        self._tasks: set = set()
        self._scenario = scenario or ""
        self._room = room_name
        self._db = os.getenv("DEMO_NOTES_DB", "demo_call_notes.sqlite3")
        self._user_id = user_id  # set by the backend at dial time; never supplied by the LLM
        self._call_id = call_id
        self._answered = False
        self._onboarding_verified = False
        self._onboarding_failures = 0
        self._api_url = (os.getenv("ONBOARDING_API_URL") if self.profile.name == "onboarding" else None) or os.getenv("RECOMMENDATION_API_URL") or None
        self.decision: Optional[str] = None

    async def check_connection(self, context: RunContext) -> dict:
        """Check that the backend tools are reachable."""
        res = demo_tools.check_connection()
        log.info("tool check_connection room=%s result=%s", self._room, res)
        return res

    async def save_call_note(self, context: RunContext, note: str) -> dict:
        """Save a short, non-sensitive note the caller explicitly asked to save."""
        res = demo_tools.save_call_note(self._db, self._room, note)
        log.info("tool save_call_note room=%s ok=%s", self._room, res.get("ok"))
        return res

    async def respond_to_caller(self, context: RunContext, caller_words: str) -> dict:
        """Send the caller's exact words to the recommendation service and get JSON suggestions back."""
        return await self._evaluate(caller_words)

    async def _evaluate(self, caller_words: str) -> dict:
        if self.profile.name == 'onboarding':
            if self._onboarding_failures >= 2 or sensitive_onboarding_input(caller_words):
                return {'ok': False, 'result': {'status': 'unavailable'}}
        t0 = time.monotonic()
        res = await asyncio.to_thread(  # blocking HTTP must not stall the audio loop
            recommend.evaluate_reply, self._user_id, self._scenario, caller_words, self._api_url, call_id=self._call_id, session_id=self._room,
            profile=self.profile.name, phone_number=self._phone_number)
        ms = int((time.monotonic() - t0) * 1000)
        log.info("tool respond_to_caller room=%s ok=%s source=%s endpoint_ms=%d", self._room,
                 res.get("ok"), res.get("source"), ms)
        result = res.get("result") if isinstance(res, dict) else None
        if self.profile.name == 'onboarding' and res.get('ok') and isinstance(result, dict):
            if result.get('status') in ('verified', 'found'):
                self._onboarding_verified = True
            elif result.get('status') in ('not_found', 'not_matched'):
                self._onboarding_failures += 1
        self._offered = bool(res.get("ok") and isinstance(result, dict) and result.get("status") == "recommendation")
        return res

    async def record_decision(self, context: RunContext, accepted: bool) -> dict:
        """Record whether the caller accepted or declined the recommendation. The call then ends."""
        if self.profile.name == 'onboarding' and accepted and not self._onboarding_verified:
            return {'ok': False, 'status': 'unavailable'}
        self.decision = "accepted" if accepted else "declined"
        log.info("tool record_decision room=%s decision=%s", self._room, self.decision)
        if not self.profile.decision_hangs_up:
            return {"ok": True, "accepted": accepted}
        if self.profile.name == 'onboarding':
            if accepted:
                goodbye = "Onboarding successful. You can now get better insights into your finances through the app or phone calls. Goodbye."
            elif self._onboarding_failures >= 2:
                goodbye = "I couldn't verify your details. Please finish onboarding in the app. Goodbye."
            else:
                goodbye = "We can't process onboarding right now. Please try again later. Goodbye."
        else:
            goodbye = "Got it, thank you. Goodbye!"
        self._start_hang_up(goodbye)
        raise StopResponse()  # no model reply: the fixed goodbye above is the last thing said

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        """Bound calls send the actual speech transcript and speak the validated API message."""
        text = getattr(new_message, "text_content", "") or ""
        if self.profile.name == 'onboarding' and sensitive_onboarding_input(text):
            self.session.say("Please don't share that. I only need the last four digits.")
            raise StopResponse()
        if self.profile.end_phrase_hangup and is_end_phrase(text):
            log.info("end phrase detected room=%s chars=%d", self._room, len(text))
            if self._offered and self.decision is None and DECLINE_PHRASE.match(_norm(text)):
                self.decision = "declined"
                log.info("decision room=%s decision=declined (plain no after a suggestion)", self._room)
            self._start_hang_up("Okay, thanks for your time. Goodbye!")
            raise StopResponse()
        if self.profile.name == "phone_details" and self._call_id and text.strip():
            if self._offered and ACCEPT_PHRASE.match(_norm(text)):
                self.decision = "accepted"
                self._start_hang_up("Got it, thank you. Goodbye!")
                raise StopResponse()
            response = await self._evaluate(text)
            result = response.get("result", {})
            message = result.get("message") or "I can’t check a new option right now."
            self.session.say(message)
            raise StopResponse()

    async def bind_inbound_onboarding(self, participant) -> bool:
        """Only provider SIP attributes choose the pending signup, never model arguments."""
        if participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_SIP or not participant.attributes.get('sip.ruleID'):
            return False
        try:
            phone = normalize_e164(participant.attributes.get('sip.phoneNumber', ''))
        except ValueError:
            return False
        if not self._api_url:
            return False
        result = await asyncio.to_thread(recommend.resolve_onboarding, self._api_url, phone, self._room)
        user_id = result.get('user_id')
        if result.get('status') != 'pending' or not isinstance(user_id, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', user_id):
            return False
        self._user_id = user_id
        self._phone_number = phone
        return True

    async def close_call_context(self) -> None:
        if self.profile.name == "phone_details" and self._answered and self._call_id and self._api_url:
            try:
                await asyncio.to_thread(recommend.end_call, self._api_url, self._call_id, self._user_id, self.decision)
            except Exception:
                log.warning("could not close recommendation context room=%s", self._room)

    def _start_hang_up(self, goodbye: str) -> None:
        if self._hanging_up:
            return
        self._hanging_up = True
        task = asyncio.create_task(self._hang_up(goodbye))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _hang_up(self, goodbye: str) -> None:
        """Say goodbye, then always delete the room, even if the goodbye fails or stalls."""
        try:
            await asyncio.sleep(0.3)  # let the current user turn finish unwinding first
            log.info("hang-up: goodbye room=%s", self._room)
            handle = self.session.say(goodbye, allow_interruptions=False)
            await asyncio.wait_for(handle.wait_for_playout(), timeout=12)
        except Exception:
            log.exception("hang-up goodbye failed room=%s", self._room)
        finally:
            try:
                await get_job_context().delete_room()  # disconnects the SIP caller immediately
                log.info("hung up room=%s decision=%s", self._room, self.decision)
            except Exception:
                log.exception("delete_room failed room=%s", self._room)


def opening_line(scenario: Optional[str]) -> str:
    """Fixed spoken opening: no LLM round trip, always discloses it is an AI. Scenario is spoken as given."""
    line = "Hi, I'm Nessiessential's AI assistant."
    if scenario:
        line += " " + scenario.strip()
    return line


def parse_metadata(raw: Optional[str]):
    """Dispatch metadata binds an outbound call to its saved recommendation."""
    try:
        data = json.loads(raw) if raw else {}
    except (ValueError, TypeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    try:
        call_id = str(UUID(data.get("call_id"))) if isinstance(data.get("call_id"), str) else None
    except ValueError:
        call_id = None
    return CallContext(
        profile=get_profile(data.get('profile')).name,
        scenario=data['scenario'] if isinstance(data.get('scenario'), str) else '',
        user_id=data['user_id'] if isinstance(data.get('user_id'), str) and data['user_id'].strip() else None,
        identity_verified=data.get('identity_verified') is True,
        call_id=call_id,
        phone_number=data['phone_number'] if isinstance(data.get('phone_number'), str) else None,
    )


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


def resolve_llm_credentials() -> tuple[str, str]:
    """Return (base_url, api_key). NVIDIA_API_KEY is only ever sent to the official NVIDIA host."""
    base_url = os.getenv("NEMOTRON_BASE_URL") or DEFAULT_BASE_URL
    parsed = urlparse(base_url)
    host = (parsed.hostname or "").lower()
    if host == NVIDIA_HOST and parsed.scheme == "https":
        return base_url, os.getenv("NEMOTRON_API_KEY") or os.environ["NVIDIA_API_KEY"]
    if parsed.scheme != "https" and host not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("NEMOTRON_BASE_URL must use https unless it points at localhost")
    key = os.getenv("NEMOTRON_API_KEY")
    if not key:
        raise ValueError("NEMOTRON_API_KEY is required when NEMOTRON_BASE_URL is not the official NVIDIA host")
    return base_url, key


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: agents.JobContext) -> None:
    llm_base_url, llm_api_key = resolve_llm_credentials()
    session = AgentSession(
        stt=nvidia.STT(language_code="en-US"),
        llm=openai.LLM(
            model=os.getenv("NEMOTRON_MODEL") or DEFAULT_MODEL,
            base_url=llm_base_url,
            temperature=0.3,  # steadier tool calls than the model's default of 1.0
            # Thinking off: first token ~0.3s instead of 4-6s after a tool result, and no empty replies.
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            api_key=llm_api_key,
        ),
        tts=nvidia.TTS(voice="Magpie-Multilingual.EN-US.Leo", language_code="en-US"),
        turn_detection="stt",
        session_close_transcript_timeout=0.1,  # default 2.0 s delayed hang-up after goodbye
    )
    attach_call_logging(session, ctx.room.name)
    call_ctx = parse_metadata(ctx.job.metadata)
    if not call_ctx.user_id and os.getenv('INBOUND_CALL_PROFILE') == 'onboarding':
        call_ctx = CallContext(profile='onboarding', scenario='New user onboarding.')
    profile = get_profile(call_ctx.profile)
    scenario, call_id = call_ctx.scenario, call_ctx.call_id
    agent = NessiAgent(scenario, ctx.room.name, profile=profile, ctx=call_ctx)
    if call_id:
        ctx.add_shutdown_callback(agent.close_call_context)
    await session.start(room=ctx.room, agent=agent)
    try:
        participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=70)
    except asyncio.TimeoutError:
        log.warning("no participant joined room=%s", ctx.room.name)
        await ctx.delete_room()
        return
    if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
        # Outbound: the SIP participant joins while the phone still rings. Speak only once it is answered.
        if not await wait_until_answered(ctx.room, participant):
            log.warning("call not answered within timeout room=%s", ctx.room.name)
            await ctx.delete_room()
            return
    agent._answered = True
    asyncio.create_task(enforce_max_duration(ctx, profile.max_seconds))
    if profile.name == 'onboarding' and not call_ctx.user_id:
        if not await agent.bind_inbound_onboarding(participant):
            session.say("We can't process that right now. Any other questions?")
            return
    if call_id and profile.name == "phone_details":
        session.say(opening_line(scenario))
    elif profile.opening:
        await session.generate_reply(instructions=profile.opening)


if __name__ == "__main__":
    agents.cli.run_app(server)
