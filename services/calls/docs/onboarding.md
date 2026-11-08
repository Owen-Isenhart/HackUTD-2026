# Inbound onboarding

The user calls the Photon number. This supersedes the outbound-first implementation brief. The existing authenticated `POST /calls` also supports `profile: "onboarding"`, but is not needed for the inbound demo.

This is sandbox-only identity matching. A name, last four account digits, and caller ID are weak authentication and must not be used for real banking accounts. Nessie is queried read-only by the service. A separately authorized one-time sandbox last-name change made the existing demo identity easier to speak; the service has no Nessie write operation.

## Flow

1. When an app signup exists, the trusted signup backend registers `{user_id, phone_number}` at `POST /internal/onboarding/registrations` with `x-api-key: RECOMMENDATION_API_KEY`. The phone must be the user's registered, consented number; do not expose this internal credential to the app. Registrations expire after 24 hours.
2. The user calls Photon. Its existing inbound SIP route delivers the call to LiveKit. The inbound dispatch selects the onboarding profile and worker.
3. The worker uses the provider's `sip.phoneNumber` attribute to start or resume setup at `POST /internal/onboarding/resolve`, including the LiveKit room as `session_id`. Inbound callers do not need to be in `DEMO_ALLOWED_NUMBERS`; that allowlist applies only to outbound dialing. For a new phone number, the service creates a provisional signup with an opaque ID derived from its phone hash. A missing or hidden number fails closed; no demo-user fallback exists. Caller ID selects or starts the signup, but does not mark identity verified. [LiveKit documents these SIP attributes](https://docs.livekit.io/reference/telephony/sip-participant/).
4. The agent gives a short welcome, asks for first and last name, then last four digits, and immediately checks the details. There is no digit readback or confirmation step. The onboarding profile exposes only `respond_to_caller` and `record_decision`.
5. The lookup uses Nemotron only to extract caller-provided fields into a schema. Code validates length, four digits (including leading zero), and grounding in the original text. Nessie matching is case-insensitive on names and constant-time on the suffix. Sandbox Checking accounts are accepted because this sandbox has no credit card. Ambiguous matches fail with the same generic body as incorrect details.
6. Verification saves a ten-minute session and a user/customer/account link atomically in Tiger. Transaction records stay in Nessie. The live response contains counts, up to two merchants, dates, and spoken forms, computed in memory; those transaction summaries are not persisted in Tiger. Account numbers and caller text are never stored.
7. The decision handler speaks one fixed success or failure message and ends the call. Success mentions financial insights through the app or phone calls; transaction details are not read aloud. Two failed matches end the flow; unavailable responses do not count as mismatches and close with a short try-again-later message. Five attempts per user and per phone per rolling hour are enforced with database locks, across worker restarts. A five-minute call cap also applies while lookups are running.

## Returning callers (already onboarded)

Every inbound call is routed **before** the agent is built. The worker sends the provider's `sip.phoneNumber` and the room name to `POST /internal/voice/route`:

- The number's HMAC hash is in `hackutd_finance.onboarding_phone_link` **and** that user has an `onboarding_user_link` row: `{status: "registered", profile: "phone_details", user_id}`. The worker builds the phone-details agent (`returning=True`) and opens with "Hi, this is the Nessential agent, an AI assistant. Welcome back. To keep your account safe, what's your first and last name?".
- Anything else (new, pending or provisional number): the existing `resolve` result, `{status: "pending", profile: "onboarding", user_id}`, and the onboarding sequence above.
- Hidden number, bad response, service down: a fixed "We can't take your call right now" goodbye and hang-up.

`onboarding_phone_link` (migration `008-voice-phone-link.sql`) is written inside the same transaction as a successful onboarding verification and is never pruned. A number already linked to a different user rolls that verification back. Migration 008 backfills links for verified users whose 24-hour registration still exists.

Returning callers still verify: name plus last four, checked by `POST /api/voice/phone-details` only against **their own** linked Nessie customer and account. Caller ID chooses the sequence, never the identity. Before verification every question returns `identity_required` and nothing is read from Nessie. Two mismatches lock the session and the call ends with an app referral; a returning caller never falls through to onboarding. After verification the endpoint answers balance, spending, recent purchases, budget (from `confirmed_memory`, if the user saved one), upcoming bills and a known-bills forecast. Every amount and date has a `_spoken` twin (`backend/speak.js`), at most three items are returned, and data is read from Nessie per request and never written to Tiger. Deals and recommendations return `not_available` by phone for now.

Outbound: when `VOICE_SESSIONS_URL` is set on the Calls API, `POST /calls` with `profile: "phone_details"` and `identity_verified: true` first calls `POST /internal/voice/sessions`, which pre-verifies the session only if `to_number` is that user's linked phone; otherwise the call goes out unverified.

Inbound room names contain the caller's number, so the agent logs a 10-character hash of the room name instead.

## Configuration and launch

Use an ignored root `.env.onboarding.local`, permission mode 600. Keep all secrets out of tracked files. Required values:

| Variable | Purpose |
|---|---|
| `TIGER_DATA_URL` / optional `TIGER_DATA_PASSWORD` | Existing Tiger PostgreSQL connection; TLS verification is enforced |
| `ONBOARDING_HASH_KEY` | Stable random secret, at least 24 characters, for hashing phone numbers |
| `RECOMMENDATION_API_KEY` | Shared worker/service authentication secret, at least 24 characters |
| `NESSIE_API_BASE_URL`, `NESSIE_API_KEY` | Matching Nessie origin and key; this demo uses `https://api.nessieisreal.com` |
| `NEMOTRON_BASE_URL`, `NEMOTRON_MODEL`, `NEMOTRON_API_KEY` | Parser/voice model; hosted NVIDIA uses the NVIDIA credential here |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NVIDIA_API_KEY` | Media, speech, and voice-model credentials |
| `ONBOARDING_API_URL` | `http://127.0.0.1:8790/api/recommendations/evaluate` on the same host, otherwise HTTPS |
| `VOICE_ROUTE_URL`, `PHONE_DETAILS_API_URL` | Optional; default to `/internal/voice/route` and `/api/voice/phone-details` on the `ONBOARDING_API_URL` host |
| `VOICE_SESSIONS_URL` | Calls API only, optional: `http://127.0.0.1:8790/internal/voice/sessions` to pre-verify outbound phone_details calls |
| `FINANCE_TIME_ZONE` | Lookup service; time zone for "today" and spoken dates (default `America/Chicago`) |
| `INBOUND_CALL_PROFILE` | `onboarding` |
| `LIVEKIT_AGENT_NAME` | Default `nessi-agent`; isolated live onboarding worker uses `nessi-onboarding-agent` |
| `DEMO_ALLOWED_NUMBERS` | Consented outbound dial destinations in E.164; does not restrict inbound onboarding |
| `LOG_TRANSCRIPTS` | Keep `0`; transcript content is opt-in only |

The calls-service Nessie key and the deals v2 key target different sandboxes. In this session, the deals v2 key returned 401; do not mix their origins or assume their customer records are shared.

Apply migrations with `node --env-file=.env.onboarding.local scripts/onboarding.js --migrate`. This follows the repository's migration runner; the onboarding-specific additive migration is `backend/migrations/007-onboarding.sql`.

Start the lookup service from the repository root:

```sh
node --env-file=.env.onboarding.local scripts/onboarding.js
```

Start the voice worker from `services/calls`:

```sh
uv sync --frozen
.venv/bin/python -m dotenv -f ../../.env.onboarding.local run -- .venv/bin/python -m src.agent start
```

Both processes must remain running. Use a process supervisor for deployment. The local processes started during development are not a durable hosted deployment. Bind the HTTP service to loopback or put it behind authenticated HTTPS; do not expose its internal endpoints directly to mobile clients.

For the live demo, the original test phone number is registered as `onboarding-demo-inbound`. The private smoke identity lives in `.local/onboarding-smoke-identity.json` (gitignored), with only name and last four digits. The existing Photon profile routes inbound SIP to LiveKit; the existing LiveKit rule `SDR_fVNkUWNghqQH` dispatches `nessi-onboarding-agent` with onboarding metadata. Other outbound defaults remain `nessi-agent`.

## Contracts and integration boundary

`POST /api/recommendations/evaluate` accepts `{user_id, session_id, phone_number, profile: "onboarding", user_text, scenario?}` with the shared API key. The worker, not the model, supplies user/session/phone bindings. Results are `verified`, `not_found`, or `unavailable`; no response identifies which identity field failed.

Registration and resolve endpoints use the same authentication and generic unavailable failures. They are trusted backend operations. Phone-first callers do not need an app signup before calling. A trusted app signup can register its real user ID before a call; otherwise setup uses a stable provisional phone identity. Attaching a provisional account to a later authenticated app account requires an explicit account-linking flow; this does not establish app authentication.

Tiger stores `onboarding_user_link`, `onboarding_session`, `onboarding_attempt`, and `onboarding_registration` in `hackutd_finance`. Phone numbers are HMAC-hashed in persistence. Expired attempts and sessions are pruned. Nessie remains the source for transaction records; subsequent app data access must select the verified user link. The original brief requested a background import, but the user clarified that transaction data should remain in Nessie. The demo transaction copies and import jobs created during initial verification were deleted. Legacy empty import tables may remain from that first additive migration; current code does not use them.

`phone_details` preserves bound recommendation-call handling. `app_voice` has a silent opening and no phrase/decision hang-up. Its navigation factory honestly reports unavailable until the mobile navigation integration exists.

## Validation

Run the Python suite in `services/calls` with `.venv/bin/pytest -q`, and the backend suite with `npm test`. Database integration coverage uses a disposable PostgreSQL database through `ONBOARDING_TEST_DATABASE_URL`; never point that test variable at the shared demo database. It tests concurrent rate limits, pending-phone resolution, expiry, session rebinding rejection, and persistence of verification identifiers without transaction copies. Human phone-call evidence is recorded separately in `smoke-test.md`.
