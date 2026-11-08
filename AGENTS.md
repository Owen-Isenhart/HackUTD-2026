# AGENTS.md

Guidance for AI coding agents (Codex, Claude Code, others) working in this repository. Read this first, then `context.md` (spec), `spec-checklist.md` (what is done, with evidence) and `Calls.md` (the voice and calling work, in detail). The repository is **public**.

## Rules that always apply

- **Do not commit or push unless the user asks.**
- **Never put secrets or personal data in tracked files**: no API keys, LiveKit secrets, tokens, phone numbers. Real values live only in `services/calls/.env.local` and `app/.env.local` (both git-ignored). Provider resource IDs (trunks, dispatch rule) are not secrets. Several keys were pasted into chat sessions during the hackathon: rotate them afterwards.
- **Do not fabricate demo data or results.** Only user *movement* may be simulated. A dummy or stub must say so (the dummy recommendation service returns `"status": "unavailable"`).
- **Test first.** Write the failing test, watch it fail, then implement. Do not report something as working without running it and reading the output; say what was *not* verified.
- **Do not touch other people's processes or files without saying so.** Other Expo/Node servers on this machine belong to other sessions (ports 8081, 8099, 8123+). Stop only the ones you started, by process ID. Teammates own `app/src/screens/*`, `services/deals/`, `backend/`, `optimizer/`; tell the user before editing them.
- The user is a hackathon team: prefer small, verified steps and plain explanations.

## Repository map

| Path | What it is |
|---|---|
| `app/` | **The real app**: Arjun's Expo SDK 58 / React Native 0.88 TypeScript app (tabs: Deals, Spending, Upcoming, Account). Also has the in-app voice client in `app/src/voice/`. See `app/AGENTS.md` for Expo rules (read the matching Expo docs before touching Expo APIs). |
| `services/calls/` | Python 3.13 (uv): LiveKit voice agent `nessi-agent` + FastAPI (`POST /calls`, `POST /voice/session`). Prompts in `prompts/`. |
| `services/recommend-dummy/` | Dummy recommendation endpoint (FastAPI). Replace with the teammate's real service. |
| `services/deals/`, `backend/`, `scripts/finance-profile.js`, `optimizer/` | Teammates' deals backend, finance backend (Node), Python optimizer. |
| `App.js`, `src/`, `nessie-signin-prototype/` | Older apps not merged into `app/`. |
| `context.md`, `spec-checklist.md`, `Calls.md` | Spec, checklist with evidence, voice/calling context. |

## Voice and calling subsystem (the work of this session)

**Architecture.** Photon (phone line) and LiveKit Cloud (media, agent dispatch) carry the audio. NVIDIA supplies speech-to-text (Parakeet), the LLM (hosted Nemotron `nvidia/nemotron-3.5-lightning-30b-a3b`, thinking turned off) and text-to-speech (Magpie, voice **Mia** US English; override with `TTS_VOICE`). One agent worker serves every profile at once; the profile name arrives in the dispatch metadata.

**Profiles** (`services/calls/src/profiles.py`, prompts in `services/calls/prompts/*.txt`): `app_voice` (in-app push-to-talk, LiveKit only, no phone), `onboarding` and `phone_details` (phone calls). Their prompts and implementation prompts (`prompts/implementation/*.md`) exist; the **app_voice profile is implemented and verified**, the phone profiles' extra tools (Nessie lookup for onboarding, identity gate for phone_details) are **not built**.

**Key files** (`services/calls/src/`): `agent.py` (agent, tools, hang-up, session options), `profiles.py`, `tools/` (registry; `app_voice.py` registers `navigate_app`), `navigation.py` (allowed routes `deals|spending|upcoming|account`, RPC to the app, deterministic "open X" matching), `push_to_talk.py` (RPCs `start_turn`/`end_turn`/`cancel_turn`), `screen_context.py` (page/visible attributes to the model), `voice_routes.py` (`/voice/session` token), `calls_api.py` (adds CORS for Expo web dev origins), `recommend.py` (client for the recommendation endpoint), `livekit_dialer.py`.

**App side** (`app/src/voice/`): `voiceSession.ts` (pure logic, tested), `useVoiceAssistant.ts`, `VoiceProvider.tsx` (state, caption, optional key box), `audioSession.ts` / `audioSession.web.ts` (the web file attaches the assistant's audio; browsers do not play remote LiveKit audio by themselves), `voiceLog.ts` (`[voice]` console logs), `setup*.ts`. Nessie (`app/src/components/WaveTabBar.tsx`) is the control: tap to talk, tap again to send; she pops up while the assistant is connecting/listening/thinking/speaking.

## Run it

```bash
cd services/calls && bash scripts/dev_up.sh     # dummy data service :9000, calls API :8000 (LAN), voice agent
bash scripts/dev_down.sh                         # stop them (kills only calls-service processes)
cd app && CI=1 npx expo start --web --port 19006 # then open http://localhost:19006 (Chrome; mic works on localhost)
```
Logs: `services/calls/logs/{agent,api,dummy,expo-web}.log` (expo-web.log also receives the browser console, including `[voice]` lines). Expo in CI mode does **not** reload: restart it after code changes, and verify the served bundle contains your new strings. If the app says "The assistant did not join", the agent died: `bash scripts/dev_up.sh`.

Needed in `services/calls/.env.local` (names only; see `.env.local.example`): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NVIDIA_API_KEY`, `LIVEKIT_OUTBOUND_TRUNK_ID`, `CALLS_API_KEY`, `DEMO_ALLOWED_NUMBERS`, `RECOMMENDATION_API_URL`, `RECOMMENDATION_API_KEY`, optional `LOG_TRANSCRIPTS=1`, `TTS_VOICE`, `VOICE_ALLOWED_ORIGINS`. In `app/.env.local`: `EXPO_PUBLIC_VOICE_API_URL` (+ optional `EXPO_PUBLIC_VOICE_USER_ID`, and `EXPO_PUBLIC_VOICE_API_KEY` as a demo shortcut; `EXPO_PUBLIC_*` values are built into the served JavaScript).

## Test it

- Server: `cd services/calls && uv run pytest -q`  and `cd services/recommend-dummy && uv run pytest -q` (5).
- App: `cd app && npx tsc --noEmit` (clean) and `node --import ./test/ts-resolve.mjs --test test/*.test.mjs` . Use the glob: `npm test` passes a directory and fails on this Node.
- Root JS tests (`npm test` at the repo root) need `npm install` first (`pg` is missing here); unrelated to the voice work.
- Live, no human needed: `cd services/calls && PYTHONPATH=. uv run python scripts/app_voice_audio_smoke.py "Open the deals page."` synthesizes speech, plays it as the microphone, and expects the app to be asked to navigate (the typed-text `app_voice_smoke.py` bypasses the voice path and is unreliable).
- Browser: Chrome automation or a person: tap Nessie, say "what am I looking at", tap again; watch the `[voice]` console lines.

## Lessons from this session (do not relearn them)

- Typed text sent to the agent does **not** go through `on_user_turn_completed`; only transcribed speech does. Test navigation and hang-up with audio.
- The session token needs `can_update_own_metadata` or the app cannot publish `page`/`visible` attributes.
- Concrete example sentences in a prompt get copied verbatim by the model; use placeholders and keep the guard test.
- A model may say "Opening X." without calling the tool, so clear commands are handled in code. Hang-up is also in code (a model cannot be relied on to call an end tool).
- `re.match` with `$` accepts a trailing newline; use `fullmatch` for ids.
- Windows/Git Bash: apostrophes break heredocs, `node --test <dir>` fails, killing processes by command-line pattern can kill your own shell. Kill by PID.
- Do not claim a server works from an HTTP 200 alone: another program may own the port. Check the body.

## Open items and next steps

1. **Commit the uncommitted work** (below) when the user says so.
2. **Real data for in-app questions.** `respond_to_caller` goes to the dummy, so money questions answer "We can't process that right now." The existing backend `/evaluate` needs a stored `call_id`; in-app questions need their own route (set `RECOMMENDATION_API_URL_APP_VOICE`).
3. **Screen awareness is shallow**: the app sends tab name plus a fixed list of section titles per tab (`SECTIONS` in `voiceSession.ts`). Screens should publish real visible items.
4. **Nessie reacts to state, not sound.** Adding an audio-level pulse is a possible polish.
5. **Native iOS build** is untested: needs a Mac with Xcode and a development build (`npx expo run:ios`); Expo Go cannot run LiveKit; no paid Apple membership for EAS device builds.
6. **Phone profiles**: build the onboarding Nessie lookup and the phone_details identity gate from `prompts/implementation/*.md`; inbound calls and the Photon inbound toggle are unverified; an intermittent first-dial SIP `403` is undiagnosed.
7. Rotate every credential that was pasted into chat.
