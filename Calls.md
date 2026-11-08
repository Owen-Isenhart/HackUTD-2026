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
- **Inbound calls:** inbound onboarding reached the worker and completed on a real call (see `services/calls/docs/onboarding.md`). Returning callers: numbers linked in Tiger (`onboarding_phone_link`) to an onboarded user now get the phone-details sequence instead of onboarding. Unit-tested only; migration 008 and live calls are still to run (`services/calls/docs/smoke-test.md`). Every call now introduces itself as "the Nessential agent".
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

**Client contract (implemented in `app/src/voice/`, untested on a device)**
1. Fetch `/voice/session`, connect with the LiveKit client, publish the mic track muted.
2. Talk button: on press call RPC `start_turn` on the agent participant (identity starts with `agent-`) and unmute; on release mute and call `end_turn`; on cancel call `cancel_turn`. Payload can be empty; each returns `"ok"` (or `"ignored"` for a stray `end_turn`).
3. Register RPC method `navigate`; payload is `{"route": "<one of deals, spending, upcoming, account (the four tabs of `app/`)>"}`; return `"ok"` or throw.
4. On every screen change set participant attributes `page` (route slug) and `visible` (JSON string array of item labels, at most 8). The agent shows the model `Page: Budgets. Visible: Food, Transport, Fun.`
5. Risk: LiveKit's React Native SDK needs native WebRTC, which Expo Go does not provide, so plan on an Expo development build (checklist DISC-06). Test the agent first with LiveKit's web playground.

**Run and test it (all logs land in `services/calls/logs/`)**
- `bash scripts/dev_up.sh` (from `services/calls`) starts the dummy data service (127.0.0.1:9000), the calls API with `/voice/session` (0.0.0.0:8000, every route except `/health` needs `x-api-key`) and the voice agent; `bash scripts/dev_down.sh` stops them. Tail with `tail -f logs/agent.log logs/api.log logs/dummy.log`. `LOG_TRANSCRIPTS=1` in `.env.local` also logs spoken text and screen context (off by default).
- `PYTHONPATH=. uv run python scripts/app_voice_audio_smoke.py ["phrase"]` joins as the app, synthesizes the phrase with NVIDIA TTS, publishes it as the microphone between `start_turn` and `end_turn`, and waits for the navigate RPC. This is the real voice path. `scripts/app_voice_smoke.py` types text instead; typed text bypasses `on_user_turn_completed`, so it does not test the voice path and it is unreliable (see below).

**Verified live (2026-11-08)**
- Token dispatch, push-to-talk RPCs (identity checked), manual turns, NVIDIA speech-to-text, and navigation by voice: "Open the budgets page." spoken into the mic made the agent ask the app to open `budgets` 0.3 s after the button was released (2 of 2 runs, then again after later changes).
- Screen context by voice: with the page set to Home and items Balance and Forecast, "What am I looking at?" was answered "You're on Home, looking at Balance and Forecast. Which one would you like to open?"

**Bugs found while verifying, now fixed (each with a test)**
1. The session token lacked `can_update_own_metadata`, so the app's `page`/`visible` attributes were silently rejected and the agent never saw the screen. The real app would have hit this too.
2. The prompt contained a concrete example sentence ("You're on Budgets, looking at Food, Transport and Fun."); the model copied it instead of the real screen. The prompt now uses placeholders only and a test forbids concrete samples.
3. For typed text the model sometimes said "Opening Deals." without calling `navigate_app` (2 of 3 runs). Clear requests ("open budgets", "go to my budget", "take me to the forecast", at most one page word, whole sentence) are now handled in code before the model sees them: faster, and it can never claim a page opened when it did not. Fuzzier requests still go to the model's `navigate_app` tool, which can still skip the call; the prompt says never to claim a page opened unless the tool returned ok, but that is not enforced in code.
4. A user id with a trailing newline passed validation (`re.match` with `$`); it now uses `fullmatch`.

**Still not verified:** hearing the agent's voice reply through a real client (the audio smoke test checks transcripts and RPCs, not playback quality), the React Native client, and a real data route for in-app questions. One warning after a client disconnects (`skipping user input, speech scheduling is paused`) looked like teardown noise and was not investigated.

**The client in `app/` (React Native, built 2026-11-08; type-checked and unit-tested, not yet run on a device)**
- `src/voice/voiceSession.ts` (pure, 8 tests in `app/test/voiceSession.test.mjs`), `useVoiceAssistant.ts` (LiveKit room, push-to-talk RPCs, `navigate` handler, screen attributes), `VoiceProvider.tsx` (voice state, status caption, optional key box) wired into Nessie in `components/WaveTabBar.tsx`, `setup.ts` (`registerGlobals`). `App.tsx` mounts the button and gives it the navigation ref; `index.ts` imports the setup first.
- Config: `EXPO_PUBLIC_VOICE_API_URL` (the calls API as the phone sees it) and optional `EXPO_PUBLIC_VOICE_USER_ID` in `app/.env.local`. The service key (`CALLS_API_KEY`) is typed into the app and kept in memory only.
- `app.json` gained `ios.bundleIdentifier` (`com.hackutd2026.nessiessential`), a microphone usage string and the plugins `@livekit/react-native-expo-plugin`, `@config-plugins/react-native-webrtc`, `expo-dev-client`.
- Needs a **development build**; Expo Go cannot run LiveKit. Build on a Mac with Xcode: `cd app && npx expo run:ios` (simulator, or a device with a free Apple ID), then `npx expo start --dev-client`. EAS device builds need a paid Apple membership, which the team does not have.
- Server routes were changed to the app's real tabs (`deals`, `spending`, `upcoming`, `account`); the earlier wish-list screens (home, budgets, forecast, ...) do not exist in the app.

**Test in a browser first (no Mac, no development build).** The same client code runs on web: platform files (`audioSession.web.ts`, `setup.web.ts`) skip the native audio setup. With the services running (`bash scripts/dev_up.sh`), put `EXPO_PUBLIC_VOICE_API_URL=http://127.0.0.1:8000` in `app/.env.local`, run `cd app && npx expo start --web --port 19006`, open `http://localhost:19006` (microphone access needs localhost or https), sign in, tap **Talk**, paste `CALLS_API_KEY`, then hold **Hold to talk**. The calls API allows browser calls only from Expo's dev origins (`http://localhost:8081`, `:19006`, and `127.0.0.1` equivalents) plus anything in `VOICE_ALLOWED_ORIGINS` (comma separated); never a wildcard, and the API key is still required. The web bundle was checked to build and to contain LiveKit's browser client and no native WebRTC module; running it in a browser with a real microphone is the next thing to verify.

**How to talk to the assistant (2026-11-08): tap Nessie.** Tap her in the nav bar: she pops up and the caption says Connecting… then Listening… (red). Tap her again to send what you said; the caption changes to Thinking… and then Speaking…, and she dives when the answer ends. Tapping while she is thinking or speaking interrupts her and starts a new turn. The microphone is only open while she says Listening… and closes by itself after 30 seconds. The decision logic is `nextAction`/`isPopped`/`statusCaption` in `app/src/voice/voiceSession.ts` (tested). Seen working in Chrome against the running services; if the caption error says "The assistant did not join", the voice agent is not running: `bash scripts/dev_up.sh` in `services/calls`.

**Sound and logs in the browser (2026-11-08).** A browser does not play a remote LiveKit voice by itself: `audioSession.web.ts` attaches the assistant's audio track to a hidden `<audio>` element (the phone SDK does this on its own). Verified in Chrome by feeding a spoken sentence into the microphone and measuring the page's audio output while the assistant answered (peak 44 of 128, about 2.4 s above the noise floor). If nobody speaks, the assistant hears an empty turn and stays silent by design. Every step is logged with a `[voice]` prefix: browser console (F12), and the Expo terminal log `services/calls/logs/expo-web.log` (Metro forwards browser console output). The agent's side is `services/calls/logs/agent.log`. A stale Expo server on the same port serves old code and makes new starts fail quietly: stop it by PID, then check the served bundle contains the latest strings.

