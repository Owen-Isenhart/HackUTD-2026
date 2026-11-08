# Calls: voice calling subsystem (context and evidence)

The integration checkout adds a call-bound recommendation API and direct transcript handling. Use the [current backend runbook](docs/backend-runbook.md) to test the integrated stack. The observations below describe the original voice-only smoke tests.

Context file for the phone-calling work. It summarises the build session, what was decided, what was verified on real calls, and what is still open. The checklist ([spec-checklist.md](spec-checklist.md)) points here for evidence. Code lives in `services/calls/` and `services/recommend-dummy/`; plan in `docs/superpowers/plans/2026-11-07-calling-subsystem.md`; per-test log in `services/calls/docs/smoke-test.md`.

**Status (2026-11-08):** outbound phone calls work end to end on live calls. An authenticated `POST /calls` dials a consenting test number, the agent greets, listens, calls a recommendation endpoint, speaks the answer, and hangs up. The recommendation endpoint is a **dummy**; the real one is a teammate's job. Inbound calls are **not yet tested**.

## What it does

```
POST /calls (x-api-key)  ->  LiveKit: dispatch nessi-agent to a fresh room, then SIP participant via Photon trunk
phone <-> Photon SIP <-> LiveKit room <-> nessi-agent (Python, LiveKit Agents)
   caller audio -> NVIDIA Parakeet STT -> Nemotron LLM (tools) -> NVIDIA Magpie TTS -> caller
   tool respond_to_caller(raw caller words) -> POST /api/recommendations/evaluate -> JSON -> Nemotron speaks it
```

- The recommendation endpoint receives the caller's **raw words** and returns **JSON only**; the agent's Nemotron turns that JSON into speech. The endpoint (teammate) runs its own Nemotron/logic. Contract in `services/recommend-dummy/app.py`: body `{user_id, scenario, user_text}`, any non-empty JSON object back, optional `x-api-key`.
- `user_id` is set by the backend at dial time and travels in dispatch metadata. The LLM never supplies it.
- `POST /calls` body: `to_number`, optional `scenario` (spoken to the caller, so write it as a sentence meant to be heard), optional `user_id`, optional `idempotency_key`.
- Safeguards: API key (constant-time compare), E.164 normalisation, allowlist (`DEMO_ALLOWED_NUMBERS`), the Photon line itself refused (would loop into our own inbound route), idempotent retries, 3 calls per number per 10 min (failed dials do not count), 5 minute hard cap per call.
- The dummy endpoint returns `{"status": "unavailable", "message": "We can't process that right now."}`; the agent then says exactly "We can't process that right now. Any other questions?" and never mentions dummy data. Nothing fabricated is presented as a real recommendation.

## Decisions made in the session

- Demo shape: backend dials the judge; agent opens with a scenario ("Chick-fil-A is nearby..."); judge reacts in speech; endpoint returns suggestions; agent speaks them; judge accepts or declines. Money data from Nessie sandbox and preferences from TigerData are future work behind the endpoint.
- Photon is the phone provider, LiveKit the media/agent layer, NVIDIA the STT/LLM/TTS. No ElevenLabs.
- The agent says it is an AI assistant at the start. No audio is recorded. Transcript text is logged **only** when `LOG_TRANSCRIPTS=1` (off by default, personal data).
- Hang-up is done **in code**, not left to the model: `record_decision` says goodbye and ends the call; a whole-utterance "no / no thanks / that's all / that'll be all / nothing else / goodbye / never mind" does the same. Longer replies ("no wait, what about vegan?") never hang up. The goodbye then the room delete always happens, even if the goodbye fails (12 s cap).
- Nemotron "thinking" is turned off for the voice LLM (`chat_template_kwargs.enable_thinking=false`). Measured on the hosted model: first content ~0.3 s instead of 4-6 s after a tool result, and no empty replies (thinking can eat the whole token budget).
- Opening line: the model-written greeting with default interruption settings worked best (first working call). Later "fixed `say()`" and "no interruptions" variants were each reported as sounding odd, so they were reverted. The agent still waits until the SIP call is answered before speaking (outbound SIP participants join the room while the phone rings).

## Resources (identifiers only, no secrets)

- Photon project `Nessiessential` with one SMS+voice line; LiveKit Cloud project `Nessiessential`.
- LiveKit inbound trunk `ST_ZgnGygMAx8Gs`, outbound trunk `ST_QwVKCdLTwF7b`, dispatch rule `SDR_fVNkUWNghqQH` (now restricted to the inbound trunk with agent `nessi-agent` attached; read back from the API).
- Agent name `nessi-agent`. Env contract: `services/calls/.env.local.example`. Real values live only in the untracked `.env.local`.
- Brev instance (1x L40S 48 GB) runs a vLLM container with `NVIDIA-Nemotron-3.5-Bolt-E4B-BF16` served as `nemotron-bolt` on `127.0.0.1:8000`. It was recreated with `--enable-auto-tool-choice --tool-call-parser gemma4`, and a tool-call test then returned a correct `tool_calls` entry in 23 tokens. It is **not used** by the agent yet: it binds localhost only. The agent uses the hosted NVIDIA Nemotron (`nvidia/nemotron-3.5-lightning-30b-a3b`). Speech (Parakeet/Magpie) always needs the hosted NVIDIA key even if the LLM moves to Brev.

## Evidence from live calls (details in `services/calls/docs/smoke-test.md`)

Nine outbound call attempts to one consenting test number during development. What the logs showed on the final successful call: greeting spoken, caller question transcribed, tool `respond_to_caller` ran (`ok=True source=api`, 119 ms against the dummy), canned reply spoken, "No, that'll be all." transcribed, decision recorded as declined, goodbye spoken, room deleted 0.25 s after the goodbye finished.

Latency from the caller finishing a sentence to the agent's first audio: 4.7 s and 2.7 s on the early runs (thinking on), then roughly 1-3 s after thinking was turned off. The dummy endpoint adds 7-141 ms; this says nothing about the real service's latency, which the `endpoint_ms` log field will show once it is connected.

## Problems found and fixed

| Symptom | Cause | Fix |
|---|---|---|
| Call never ended after goodbye | Model chatted instead of calling the end-call tool | Hang-up moved into code (above) |
| 2 s wait after goodbye | LiveKit waits for a final transcript on close (default 2.0 s) | `session_close_transcript_timeout=0.1` |
| Agent went silent but call stayed open | Goodbye path stalled, room never deleted | Room always deleted in `finally`; 5 min cap |
| Slow replies after a tool call | Hosted Nemotron reasoning (4-6 s) | Thinking off |
| Blocking HTTP froze audio | Sync request on the audio loop | `asyncio.to_thread` |
| Rate limit blocked a retry | Failed dials counted | Failed dials excluded |
| First dial after quiet period sometimes `403 permission_denied` | Not diagnosed; an immediate retry succeeded (seen twice) | Open, see below |

## Run it locally

```
# terminal 1: dummy recommendation service
cd services/recommend-dummy && uv run uvicorn app:app --port 9000
# terminal 2: voice agent (registers as nessi-agent with LiveKit)
cd services/calls && uv run python -m src.agent start
# terminal 3: calls API
cd services/calls && uv run uvicorn src.main:app --host 127.0.0.1 --port 8000
# place a call (consenting number must be in DEMO_ALLOWED_NUMBERS)
curl -X POST http://127.0.0.1:8000/calls -H "x-api-key: $CALLS_API_KEY" -H "Content-Type: application/json" \
  -d '{"to_number":"+1XXXXXXXXXX","scenario":"Chick-fil-A is nearby and you have a rewards offer there."}'
```

Set `RECOMMENDATION_API_URL` in `.env.local` (and `RECOMMENDATION_API_KEY` if the service wants one) to point at the real endpoint. Unit tests: `uv run pytest -q` in each service folder (54 and 4 passing).

## Open items

- **Real recommendation endpoint:** not connected. Dummy only.
- **Inbound calls:** not tested. Photon's inbound toggle toward the LiveKit SIP address was never confirmed in the dashboard.
- **Call status:** `POST /calls` returns `dial_requested`. A no-answer or declined call is stored as `failed`, not `no_answer`/`busy`; answered/ended are not tracked from LiveKit events.
- **Intermittent `403 permission_denied`** on a first dial; check Photon call activity.
- **Credentials:** the LiveKit API secret, the NVIDIA key, the Nessie key and the Photon SIP password were all pasted into the working session. Rotate them after the demo. Nothing secret is in the repo (history scanned); provider resource IDs above are identifiers, not credentials. The repo is public.
- **Brev route:** to use the Brev model the agent needs a public, key-protected endpoint (or to run on the box). Untested for live calls.
- **Persistence:** call records and notes are in-memory/SQLite demo state; user memory and budgets belong to the main spec (TigerData, Nessie), not this subsystem.
- Owner-scoped authentication for end users, consent management and retention are not implemented; the allowlist is a demo guard only.

## In-app voice (`app_voice` profile): push-to-talk over LiveKit, no Photon

Implemented from `services/calls/prompts/implementation/app_voice.md`. The prompt is `services/calls/prompts/app_voice.txt`. Profiles (`src/profiles.py`) choose the prompt, tools and behavior per session from the dispatch metadata, so onboarding, phone details and in-app voice run on the same agent worker at the same time.

**Server side**
- `POST /voice/session` (same `x-api-key` as `POST /calls` for now) with `{"user_id": "<id>"}` returns `{url, token, room}`. The token lasts 10 minutes, joins room `app-voice-<id>` as identity `app-<user_id>`, and dispatches `nessi-agent` with profile `app_voice`. Limit: 5 sessions per user per 10 minutes. `user_id` must come from the app's authenticated session on the server, never from the client; today the trusted backend supplies it.
- The agent only listens to that one participant, uses manual turn detection, and keeps the microphone input off between turns.
- Tools: `respond_to_caller` and `navigate_app` only (no `record_decision`, so nothing ends the session). A bare "no" does not hang up. The session ends after 120 s idle or 30 minutes.
- Data questions go to `RECOMMENDATION_API_URL_APP_VOICE` if set, else `RECOMMENDATION_API_URL`. The existing backend `/evaluate` route needs a stored `call_id`, so in-app questions need their own route; until then they get the fixed "We can't process that right now."
- The endpoint payload for unbound sessions also carries `session_id` (the room) and `profile`.

**Client contract (React Native; not built)**
1. Fetch `/voice/session`, connect with the LiveKit client, publish the mic track muted.
2. Talk button: on press call RPC `start_turn` on the agent participant (identity starts with `agent-`) and unmute; on release mute and call `end_turn`; on cancel call `cancel_turn`. Payload can be empty; each returns `"ok"` (or `"ignored"` for a stray `end_turn`).
3. Register RPC method `navigate`; payload is `{"route": "<one of home, forecast, recommendations, clarifications, budgets, preferences, memory, enrollments, notifications, calls, privacy, map>"}`; return `"ok"` or throw.
4. On every screen change set participant attributes `page` (route slug) and `visible` (JSON string array of item labels, at most 8). The agent shows the model `Page: Budgets. Visible: Food, Transport, Fun.`
5. Risk: LiveKit's React Native SDK needs native WebRTC, which Expo Go does not provide, so plan on an Expo development build (checklist DISC-06). Test the agent first with LiveKit's web playground.

**Verified live (2026-11-08, `services/calls/scripts/app_voice_smoke.py`, `PYTHONPATH=. uv run python scripts/app_voice_smoke.py`)**: token-based dispatch joined the agent; `start_turn` and `cancel_turn` returned `ok`; a stray `end_turn` returned `ignored`; a typed "Please open the budgets page." made the model call `navigate_app` and the app received `{"route": "budgets"}`. **Not verified:** spoken audio through push-to-talk, that the model uses the screen context in its answers, the React Native client, and the real data endpoint. One warning appeared after the smoke client disconnected (`skipping user input, speech scheduling is paused`); it looked like teardown noise but was not investigated.

