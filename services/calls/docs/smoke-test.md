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
| T09 | Hangup / no-answer states | PARTIAL | Agent hang-up VERIFIED on live call (goodbye then room deleted 0.25 s later; decision recorded). No-answer shows as `failed` (SIP 408); LiveKit event tracking not implemented |
| T10 | Auth + allowlist rejection | VERIFIED (unit) | tests/test_call_authorization.py |
| T11 | Provider call logs | NOT RUN | |
| T12 | Reproducible setup | NOT RUN | |

Offline unit tests: `uv run pytest -q` -> 44 passed (2026-11-07).

Open items: recommendation API (RECOMMENDATION_API_URL blank, tool returns labeled stub); Nessie profile seeding
and TigerData preference store are interfaces/stand-ins only; Photon docs version used: not yet checked.

Call 3 (live-test-3) timed out with SIP 408 (no pickup); API marks it `failed`, not `no_answer` (status mapping not implemented).

2026-11-08 final: outbound flow works end to end (greeting, question, tool call, canned reply, decline, goodbye, hang-up). Inbound untested. Photon inbound toggle unconfirmed. See ../../Calls.md.

## Onboarding, 2026-11-08

User clarified that onboarding is **inbound**: the user calls Photon. See [onboarding setup](onboarding.md). Existing outbound profile support is retained.

| Check | Status | Evidence |
|---|---|---|
| Profile isolation, metadata defaults, inbound signup binding, hang-up guards | VERIFIED (unit) | 86 Python tests passed |
| Deterministic lookup, schema extraction, generic mismatch, full-number rejection, authenticated HTTP | VERIFIED (unit) | Onboarding endpoint tests with fake Nessie |
| Persistent verification limits | VERIFIED (integration) | Disposable PostgreSQL: concurrent attempts admit exactly five per user/phone; two mismatches stop a session; expiry/rebinding rejected; only verification identifiers persisted |
| Tiger connectivity and additive onboarding schema | VERIFIED | Existing CLI credentials, TLS connection, onboarding tables created; opted-in phone registered as a pending demo signup |
| NVIDIA parsing of live sandbox identity | VERIFIED | Read-only identity use explicitly approved; HTTP 200, validated names/digits; values omitted from logs |
| Live lookup | VERIFIED | Authenticated endpoint returned verified and 30 transactions. The original brief requested an import; after the user clarified retention, the import path was removed and its 30 demo transaction copies plus one import job were deleted from Tiger. Current flow reads transactions from Nessie only. |
| Photon inbound configuration | VERIFIED (configuration) | Existing default voice profile has inbound destination `sips:6c26ulfdp8h.sip.livekit.cloud`; no Photon routing change needed |
| LiveKit inbound dispatch and worker | VERIFIED (configuration) | Existing rule points to `nessi-onboarding-agent`; worker registered in US Central; caller phone is not hidden |
| Correct identity: spoken completion and hang-up | VERIFIED (user report), revised script pending | User confirmed onboarding worked. They reported excess wording and an awkward confirmation/spelling step; the revised flow removes readback/confirmation and uses fixed concise outcomes. |
| Wrong digits twice: one retry and declined exit | NOT RUN (phone) | Failure/retry guards covered offline; still needs spoken end-to-end observation |
| Volunteered full card: fixed interruption | NOT RUN (phone) | Turn guard and endpoint rejection covered offline; still needs spoken end-to-end observation |
| Nessie unavailable: exact fixed fallback | NOT RUN (phone) | Timeout response covered offline; no live production URL was deliberately broken |

Nessie application access remains read-only. At the user's explicit request, a separate one-time API operation changed the existing sandbox customer's last name to an easy-to-speak name, then read it back; it did not create customers or modify accounts/purchases. Private test identity stays in the gitignored local file. No secrets or full account numbers belong in this evidence log.

Final retention clarification: Nessie remains the transaction source. Tiger retains pending registrations, hashed-phone attempt limits, expiring verification sessions, and verified customer/account identifiers only. No transaction records or merchant/date summaries are persisted by the revised onboarding service.

Inbound access clarification: removed the demo phone allowlist from inbound onboarding. Any incoming phone may resolve its pending signup; unknown/hidden phones still fail closed. Outbound dialing continues to require an allowlisted destination.

First inbound validation reached the voice worker and spoke the unavailable fallback before identity collection. Diagnosis found an unregistered calling number and a session validator that rejected LiveKit room names containing plus signs. Fixed the validator and made phone-first calls create a provisional unverified signup automatically. No prior app signup or inbound allowlist is now required.

Latest script revision: short AI-disclosed welcome, first/last name, last four digits, immediate lookup, and one fixed success or failure closing. No confirmation word, digit readback, transaction summary, or follow-up questions after the result. This intentionally supersedes the original prompt’s readback/confirmation and unavailable-follow-up instructions.
