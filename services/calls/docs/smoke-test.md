# Smoke test evidence log

Statuses: NOT RUN / CONFIGURED / VERIFIED / BLOCKED. Nothing below is VERIFIED unless evidence is attached.

| ID | Test | Status | Evidence / blocker |
|---|---|---|---|
| T01 | Photon inbound enabled to LiveKit SIP URI (TLS) | PARTIAL | LiveKit API (2026-11-07): creds valid; inbound trunk ST_ZgnGygMAx8Gs and outbound trunk ST_QwVKCdLTwF7b exist. Photon-side inbound toggle still unchecked |
| T02 | Dispatch rule SDR_fVNkUWNghqQH has nessi-agent on ST_ZgnGygMAx8Gs | CONFIGURED | Updated via SDK 2026-11-07; API read-back: agents=['nessi-agent'], trunks=['ST_ZgnGygMAx8Gs'], prefix nessi-. No agent worker running yet, so inbound calls reach an empty room until `dev` runs |
| T03 | Agent starts in Agent Console | NOT RUN | Needs LiveKit + NVIDIA keys in .env.local; `lk` CLI not installed |
| T04 | STT + LLM + TTS audible | VERIFIED (log) | 2026-11-08 call 4 (room nessi-out-8b094f5d3709): user speech transcribed correctly, assistant replies spoken (started/stopped_speaking metrics present). Caller-side audio quality not rated. Old note: Pipeline ran in live call (tool fired from transcribed speech, so STT and LLM worked); TTS audibility needs user confirmation |
| T05 | Tool call verified | VERIFIED (log) | 2026-11-08 live outbound call: agent log `tool respond_to_caller ... ok=True source=api` (dummy endpoint). Caller-side audio not yet confirmed by user |
| T06 | Inbound live call | NOT RUN | |
| T07 | Outbound live call (CLI) | NOT RUN | |
| T08 | Outbound live call (API) | VERIFIED (log) | Call 4: POST /calls -> answered -> 2-turn conversation -> tool called twice (endpoint_ms 66, 7; dummy endpoint). Latency end of speech -> first agent audio: 4.7 s (turn 1), 2.7 s (turn 2). Earlier notes: POST /calls -> 200 dial_requested; LiveKit job received for room nessi-out-555396b4ef5f; phone_user participant linked (call answered); tool ran. Awaiting user report of what was heard (audio quality, latency) |
| T09 | Hangup / no-answer states | NOT RUN | Status updates from LiveKit events not implemented yet |
| T10 | Auth + allowlist rejection | VERIFIED (unit) | tests/test_call_authorization.py |
| T11 | Provider call logs | NOT RUN | |
| T12 | Reproducible setup | NOT RUN | |

Offline unit tests: `uv run pytest -q` -> 44 passed (2026-11-07).

Open items: recommendation API (RECOMMENDATION_API_URL blank, tool returns labeled stub); Nessie profile seeding
and TigerData preference store are interfaces/stand-ins only; Photon docs version used: not yet checked.

Call 3 (live-test-3) timed out with SIP 408 (no pickup); API marks it `failed`, not `no_answer` (status mapping not implemented).
