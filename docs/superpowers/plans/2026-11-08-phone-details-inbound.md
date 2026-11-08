# Returning callers: registered phones get the phone-details call, not onboarding — Implementation Plan

> **Status (2026-11-08): implemented on branch `feat/phone-details-returning`** except the items marked NOT RUN in `services/calls/docs/smoke-test.md` (live calls, and the PostgreSQL integration tests, which need `ONBOARDING_TEST_DATABASE_URL`). Spoken brand is "the Nessential agent" / "Nessential" on every call. Implementation notes that differ from the text below: a `returning` flag in `CallContext` marks lookup-service sessions (so plain outbound phone_details calls keep their old behaviour); outbound seeding happens inside `POST /calls` before the phone rings (`VOICE_SESSIONS_URL`); the lookup service's own `account_number` / name check replaces a separate matcher.
>
> Revision 2 (2026-11-08). Built on top of the `onboarding_call` branch (`origin/onboarding_call`, commit `9c19489`, "onboarding call (no check for already onboarded)"). Steps use checkbox (`- [ ]`) syntax. Work test-first. **No git commits or pushes** unless asked; end each task with `git status`.

**Goal.** When someone dials the Photon line (+1 507 616 9071), the inbound worker looks the caller's number up in Tiger. If that number already belongs to a verified, onboarded user, the caller gets the **phone-details** sequence: a welcome back, a quick identity check against *their own* linked Nessie account, then spoken answers about budgets, spending, forecast and deals. Every other number gets the existing **onboarding** sequence, unchanged.

**Inputs.** The pasted `phone_details` prompt and brief, [Calls.md](../../../Calls.md), and the `onboarding_call` branch: [docs/onboarding.md](../../../services/calls/docs/onboarding.md) there, `backend/onboarding*.js`, `scripts/onboarding.js`, migration `007-onboarding.sql`, `services/calls/src/{agent,profiles,recommend}.py`, `src/tools/`.

## What the onboarding branch already gives us

| Piece | On `onboarding_call` | Reuse as-is? |
|---|---|---|
| Profiles foundation (F1–F8): `profiles.py`, `CallContext`, `build_instructions`, tool registry `src/tools/`, profile-aware hang-up, `POST /calls` `profile` + `identity_verified` | Done, 86 Python tests | **Yes.** Phase 1 of revision 1 is no longer needed. |
| Inbound telephony | Photon inbound to LiveKit and rule `SDR_fVNkUWNghqQH` verified (configuration); rule dispatches **`nessi-onboarding-agent`**, a separate worker started with `INBOUND_CALL_PROFILE=onboarding` | Yes. Every inbound call lands in that worker, so **the routing decision happens there**. |
| Onboarding lookup service | `scripts/onboarding.js`, loopback port 8790, `x-api-key: RECOMMENDATION_API_KEY`; routes `/api/recommendations/evaluate`, `/internal/onboarding/registrations`, `/internal/onboarding/resolve` | Yes, and extend it (it already has Tiger + a multi-customer Nessie client). |
| Tiger tables (`hackutd_finance`) | `onboarding_registration (user_id, phone_hash UNIQUE, expires_at = +24 h)`, `onboarding_session (session_id, user_id, phone_hash, expires_at = +10 min, failures, verified, customer_id)`, `onboarding_user_link (user_id, customer_id, account_id, verified_at)`, `onboarding_attempt` | Extend (see the gap below). |
| Identity matching | `extractIdentity` (Nemotron schema extraction) + `validateIdentity` (grounded in the spoken text) + `normalizeLast4` + `unsafeInput`; constant-time last-four compare; ambiguous match fails | **Reuse.** Do not write a second matcher. |
| Spoken helpers | `speakNumber`, `speakDate` (in `onboarding.js`, no money/percent/relative dates) | Move to `backend/speak.js` and extend. |
| `phone_details` profile | Exists; prompt is a 4-line placeholder; tools `respond_to_caller`, `record_decision`, `save_call_note`; keeps the bound recommendation-call (`call_id`) path | Replace the prompt, add the new data path. |

### The gap ("no check for already onboarded")

1. **`resolve` treats every number as new.** It upserts a registration (provisional id `phone-<hash>`) and returns `pending`, so a user who finished onboarding yesterday is onboarded again.
2. **Tiger has no durable phone-to-user link.** The phone hash only lives in `onboarding_registration` (pruned after 24 hours) and in short-lived sessions. `onboarding_user_link` has no phone column, so after a day nothing says "this number belongs to a verified user".
3. **The worker fixes the profile before it knows the caller.** `entrypoint` builds `NessiAgent` with the onboarding profile from `INBOUND_CALL_PROFILE`, then starts the session, and only then resolves the phone number.
4. **No data endpoint for a linked user.** The finance server (8787) serves one `NESSIE_ACCOUNT_ID`; the onboarding service knows each user's `account_id` but only returns verification results.

### Also note

- The branch is based on `595c6c9`; `main` has two later commits. `git merge-tree` reports **no conflicts**. Merge it into a working branch first (Phase 0).
- LiveKit room names for inbound calls contain the caller's number (the smoke log fixed a validator that rejected `+` in room names). Every `room=%s` log line therefore logs the number. Fix in Phase 3.
- The onboarding service uses Nessie origin `https://api.nessieisreal.com`; the finance backend uses `https://prod-api.nessieisreal.com` with a different key. A linked `account_id` is only readable through the onboarding service's origin and key, so **the phone-details data must come from the onboarding service's Nessie client**, not the finance server.
- The onboarding prompt deliberately dropped digit readback and confirmation after user feedback. The pasted phone-details prompt reintroduces readback ("Say 'correct', or tell me the right digits"). Decision below.

## Call sequences

```
Inbound call -> Photon -> LiveKit rule SDR_fVNkUWNghqQH -> worker nessi-onboarding-agent
  worker: wait for SIP participant, read sip.phoneNumber (never spoken, never logged)
  worker -> POST /internal/voice/route {phone_number, session_id}
     Tiger: phone_hash in onboarding_phone_link AND onboarding_user_link has a row for that user?
       yes -> {"status":"registered","user_id":U,"profile":"phone_details"}  + unverified phone_details session
       no  -> existing resolve logic -> {"status":"pending","user_id":P,"profile":"onboarding"}
       error / hidden number -> {"status":"unavailable"} -> fixed fallback, hang up
  worker builds NessiAgent with the returned profile, then starts the session
```

| Step | Onboarding (new number) — unchanged | Phone details (registered number) — new |
|---|---|---|
| Opening | "Hi, I'm the Nessential agent, an AI assistant. Welcome to Nessential onboarding. What's your first and last name?" | "Hi, this is the Nessential agent, an AI assistant. Welcome back. To keep your account safe, what's your first and last name?" |
| Identity | Name + last four, matched against **all** Nessie customers; success creates the user link | Name + last four, matched **only against the linked `customer_id` / `account_id`**; nothing new is linked |
| After success | Fixed success line, call ends | "Thanks, you're verified. What would you like to know about your money?" then Q&A under the speaking rules |
| Two mismatches | App referral, call ends | "I couldn't verify you by phone. You can check everything in the app." `record_decision(false)`, call ends. **Never** falls back to onboarding (that would let a caller re-link someone else's number) |
| Hang-up rules | Fixed outcomes | Bare "no / that's all" ends the call; `record_decision` ends after a recommendation; 10-minute cap |

Caller ID only chooses the sequence. It never verifies anyone.

## Decisions taken (change them here if the team disagrees)

1. **Registered = verified link.** A number counts as registered only when it is linked to a user with an `onboarding_user_link` row (completed onboarding). Pending or provisional signups still get onboarding.
2. **Durable link is written when onboarding succeeds**, inside the existing `verify` transaction, so the two can never disagree. Existing verified users are backfilled from live registrations once (Task 1.1).
3. **One phone, one user.** `phone_hash` is unique in the link table. Re-onboarding a linked number to a different customer is refused (same rule as the existing `User link conflict`).
4. **No digit readback** for returning callers either, matching the onboarding fix; the endpoint check replaces confirmation. The pasted prompt is used with that one paragraph replaced.
5. **Data comes from Nessie on each request** via the onboarding service's client and is never written to Tiger (the retention rule from `onboarding.md`). Small per-session in-memory cache (60 s) to keep follow-up questions fast.
6. **Budgets/goals**: read `hackutd_finance.confirmed_memory` by `owner_id = user_id` if present; otherwise the endpoint omits budget fields and the agent says it does not have them. No invented category budgets.
7. Keep the separate `nessi-onboarding-agent` worker name for inbound and `nessi-agent` for outbound; both run the same code.

---

## Phase 0 — Set up the branch

- [ ] **0.1** `git switch -c feat/phone-details-returning main && git merge --no-ff origin/onboarding_call` (no conflicts expected). Run `uv run --locked pytest -q` in `services/calls` (expect 86 passing) and `npm test` at the root. Record the counts.
- [ ] **0.2** Env. Inbound worker and lookup service read the ignored root `.env.onboarding.local` (see `onboarding.md`). Add `VOICE_ROUTE_URL=http://127.0.0.1:8790/internal/voice/route` and `PHONE_DETAILS_API_URL=http://127.0.0.1:8790/api/voice/phone-details`. The values pasted in chat belong in ignored files only (`services/calls/.env.local`, not `services/calls.env.local`). The LiveKit, NVIDIA, Nessie and calls keys were pasted into chat: rotate them after the demo (CALLS-07).
- [ ] **0.3** Confirm the pending onboarding smoke items still pass on the merged branch with one real inbound call from the registered test phone (expected today: the onboarding sequence, because the check does not exist yet). This is the "before" evidence.

## Phase 1 — Tiger: durable phone link and routing (lookup service, Node)

Files: `backend/migrations/008-voice-phone-link.sql`, `backend/onboarding-store.js`, `scripts/onboarding.js`.

- [ ] **1.1 Migration 008** (additive, safe to re-run):
  ```sql
  CREATE TABLE IF NOT EXISTS hackutd_finance.onboarding_phone_link (
    phone_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES hackutd_finance.onboarding_user_link (user_id) ON DELETE CASCADE,
    linked_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS onboarding_phone_link_user ON hackutd_finance.onboarding_phone_link (user_id);
  ALTER TABLE hackutd_finance.onboarding_session
    ADD COLUMN IF NOT EXISTS profile text NOT NULL DEFAULT 'onboarding' CHECK (profile IN ('onboarding', 'phone_details'));
  -- One-time backfill: verified users whose registration has not been pruned yet.
  INSERT INTO hackutd_finance.onboarding_phone_link (phone_hash, user_id)
    SELECT r.phone_hash, r.user_id FROM hackutd_finance.onboarding_registration r
    JOIN hackutd_finance.onboarding_user_link l USING (user_id)
  ON CONFLICT DO NOTHING;
  ```
  If the test phone's registration was already pruned, re-link it by completing onboarding once more after 1.2 lands.
- [ ] **1.2 Write the link on success.** In `store.verify`, inside the same transaction and after the `onboarding_user_link` upsert: `INSERT INTO onboarding_phone_link (phone_hash, user_id) VALUES ($hash, $user) ON CONFLICT (phone_hash) DO UPDATE SET linked_at = now() WHERE onboarding_phone_link.user_id = EXCLUDED.user_id RETURNING phone_hash`; no row returned -> throw (`Phone link conflict`), which rolls back the verification.
- [ ] **1.3 `store.route({ phone_number, session_id })`.** Validate as `resolve` does. One query: `SELECT l.user_id FROM onboarding_phone_link p JOIN onboarding_user_link l USING (user_id) WHERE p.phone_hash = $1`. Found -> insert the session with `profile='phone_details'` (same rebinding guard as `resolve`) and return `{status:'registered', profile:'phone_details', user_id}`. Not found -> call the existing `resolve` and return `{status:'pending', profile:'onboarding', user_id}`. Errors -> `{status:'unavailable'}`.
- [ ] **1.4 Route** `POST /internal/voice/route` in `createOnboardingServer`, same auth, body limit and generic errors. Keep `/internal/onboarding/resolve` working for older workers.
- [ ] **1.5 Guard onboarding.** In `createOnboarding.evaluate`, reject (`unavailable`) a session whose `profile` is `phone_details`, so a returning caller's session can never run the "link a new customer" path.
- [ ] **1.6 Tests** (`test/onboarding-store.test.js`, disposable DB via `ONBOARDING_TEST_DATABASE_URL`; never the shared Tiger DB): `route returns registered only for a verified link`, `pending signup still routes to onboarding`, `unknown phone routes to onboarding with a provisional id`, `verify writes the phone link atomically`, `phone already linked to another user rolls back verification`, `backfill links only verified users`, `onboarding evaluate refuses phone_details sessions`.

## Phase 2 — Phone-details identity check and data endpoint (lookup service, Node)

Files: `backend/speak.js` (new), `backend/voice-phone-details.js` (new), `backend/onboarding.js` (export the shared helpers), `scripts/onboarding.js`.

- [ ] **2.1 `backend/speak.js`.** Move `speakNumber` and `speakDate` out of `onboarding.js` (re-export there to keep its tests green) and add `speakMoney(minorUnits, currency='USD')` ("two hundred forty dollars and fifty cents", "one dollar", "zero dollars", "minus …", millions), `speakRelativeDate(isoDate, today, timeZone)` ("today", "yesterday", "tomorrow", otherwise "Tuesday, November eleventh") and `speakPercent(value)`.
- [ ] **2.2 Store helpers.** `store.phoneDetailsSession(body)` loads the session, checking `profile='phone_details'`, `user_id`, `phone_hash`, expiry and `failures < 2`; returns `{ verified, user_id, customer_id, account_id }` (join `onboarding_user_link`). `store.verifyReturning(body)` sets `verified=true` (no link changes). Reuse `store.attempt` (five per user and per phone per hour) and `store.fail`.
- [ ] **2.3 Route** `POST /api/voice/phone-details`, body `{session_id, phone_number, user_id, profile:'phone_details', user_text}` — all set by the worker from the route result, never by the model.
  1. Session invalid, expired or locked -> `{status:'unavailable'}`.
  2. Not verified -> treat `user_text` as a verification attempt: `unsafeInput` -> `unavailable`; `extractIdentity` + `validateIdentity`; compare names (case-insensitive) with `nessie.customer(customer_id)` and the last four (constant time) with **that user's** `account_id` only. Match -> `{status:'verified'}`. No match -> `store.fail`, `{status:'not_matched', retries_left: 1|0}`. Missing name or digits -> `{status:'identity_required'}` (does not count as an attempt).
  3. Verified -> classify the question with `requestInsight` (enum: `balance`, `spending`, `recent_purchases`, `budget`, `upcoming_bills`, `forecast`, `deals`, `recommendation`, `unsupported`; transcript passed as untrusted data), regex fallback. Build facts from Nessie (`/accounts/{id}`, `/accounts/{id}/purchases`, `/accounts/{id}/bills`, `/merchants`), `confirmed_memory` for the budget, and the Deals gateway if configured. Never take an id from `user_text`.
- [ ] **2.4 Response shape** (facts, not sentences):
  ```json
  {"status":"ok","topic":"spending",
   "answer":{"label":"spent this month","amount_minor":21000,"amount_spoken":"two hundred ten dollars"},
   "context":{"budget_minor":30000,"budget_spoken":"three hundred dollars","left_minor":9000,"left_spoken":"ninety dollars","days_left_spoken":"twelve days"},
   "items":[{"merchant":"Whole Foods","amount_minor":6000,"amount_spoken":"sixty dollars","date":"2026-11-03","date_spoken":"Tuesday, November third"}],
   "more_available":2}
  ```
  Every amount and date has a `_spoken` twin; at most three `items`, most important first; `more_available` counts the rest; unknown fields omitted; Nessie failure -> `{status:'unavailable'}`.
- [ ] **2.5 Nessie client.** Add `customer(id)` and `account(id)` (object responses) and `bills(account)` to `createNessieLookup`; it currently requires array responses, so add a separate object getter.
- [ ] **2.6 Tests** (`test/voice-phone-details.test.js`, fake Nessie + fake store): `speak money cases (0, 1, 99, 100, 24050, 100000, negative)`, `relative and weekday dates`, `every amount and date has a spoken twin`, `items capped at three with more_available`, `refuses account data before verification`, `matches only the linked customer, not another customer with the same name and digits`, `ignores ids spoken by the caller`, `second mismatch locks the session`, `missing digits is identity_required and does not count`, `nessie failure is unavailable`, `route rejects bad key and oversized body`.

## Phase 3 — Inbound worker: route first, then build the agent (services/calls)

Files: `src/agent.py`, `src/recommend.py`, `src/profiles.py`, `prompts/phone_details.txt`, tests.

- [ ] **3.1 `recommend.route_inbound(route_url, phone_number, session_id) -> dict`** like `resolve_onboarding`; any error -> `{"status":"unavailable"}`.
- [ ] **3.2 Reorder `entrypoint` for inbound.** When the job has no `user_id` and `INBOUND_CALL_PROFILE` is set: wait for the SIP participant **before** building the agent (inbound callers are already in the room); require `sip.ruleID` and a valid `sip.phoneNumber` (existing checks in `bind_inbound_onboarding`); call `route_inbound`; build `CallContext(profile=<returned>, user_id=<returned>, phone_number=phone, scenario=<"New user onboarding." | "Returning registered caller.">)`; then create `NessiAgent` and `session.start`. `unavailable` -> start with the onboarding profile and say the fixed fallback, then hang up (today's behaviour). Validate `profile in ("onboarding", "phone_details")` and the `user_id` pattern on the response. If LiveKit refuses to start the session after the participant join, use `session.update_agent(...)` from a neutral placeholder agent instead; check this first in a dev room.
- [ ] **3.3 Phone-details agent behaviour** (in `NessiAgent`, keyed on `profile.name == "phone_details"` and no `call_id`):
  - `self._api_url = PHONE_DETAILS_API_URL`; every `respond_to_caller` payload carries the worker's `session_id`, `phone_number`, `user_id`, `profile`.
  - Track `self._verified` and `self._failures` from results (`verified`, `not_matched` + `retries_left`), mirroring the onboarding guards. `record_decision(accepted=true)` before verification is refused, as in onboarding.
  - Apply `sensitive_onboarding_input` to this profile too (full card numbers, PIN, CVV are never forwarded).
  - After two mismatches, `record_decision(false)` speaks "I couldn't verify you by phone. You can check everything in the app. Goodbye."
- [ ] **3.4 Opening.** For inbound phone_details say the fixed line from the sequence table with `session.say` (no LLM round trip, like the onboarding opening). Outbound phone_details with `identity_verified` keeps the generated "why we are calling" opening.
- [ ] **3.5 Prompt.** Put the pasted prompt into `prompts/phone_details.txt`, with these edits: the IDENTITY paragraph says no digit readback (send name and digits in one `respond_to_caller` call right away); add "If the result says identity_required, ask only for the missing part"; add "If the result says not_matched, say exactly: I couldn't match those details. What's your first and last name?". Keep the bound-call (`call_id`) behaviour working, since `on_user_turn_completed` handles it before the LLM.
- [ ] **3.6 Privacy in logs.** Replace `room=%s` with `room=%s` of `sha256(room)[:10]` in `agent.py` (helper `room_tag()`), because inbound room names contain the caller's number. Never log `phone_number`.
- [ ] **3.7 Tests** (`tests/test_profiles.py`, `tests/test_agent_tools.py`): `registered_route_builds_phone_details_agent`, `pending_route_builds_onboarding_agent`, `unavailable_route_says_fallback_and_hangs_up`, `route_response_with_unknown_profile_or_bad_user_id_is_unavailable`, `phone_details_payload_carries_worker_bindings_not_model_args`, `phone_details_refuses_accept_before_verified`, `second_mismatch_ends_with_app_referral`, `sensitive_input_never_forwarded_in_phone_details`, `room_name_not_logged_in_clear`, `phone_details_tools_are_respond_record_note_only`. Existing 86 still pass.

## Phase 4 — Outbound pre-verified calls (optional, after inbound works)

- [ ] **4.1** The trusted backend dials a registered user's number with `POST /calls {profile:"phone_details", identity_verified:true, user_id, to_number, scenario}` (already supported on the branch). For the data endpoint to answer, the lookup service needs a pre-verified session: add `POST /internal/voice/sessions {session_id: room_name, user_id, phone_number}` that creates a `phone_details` session with `verified=true` only when the phone is linked to that user. Call it with the `room_name` returned by `POST /calls`.
- [ ] **4.2** Bounded retry for the first-dial SIP `403 permission_denied` in `LiveKitDialer.dial`: one retry after 1 s, that error only (CALLS-08).

## Phase 5 — Live verification

Record each run in `services/calls/docs/smoke-test.md` (date, latency, `endpoint_ms`), marking CONFIGURED vs VERIFIED honestly.

- [ ] (a) **New number** (second consenting phone, never onboarded): onboarding sequence exactly as before.
- [ ] (b) **Same phone again** after (a) succeeded: welcome back, name + last four, verified, "what did I spend this month?" answered with `_spoken` values, either-or follow-up, "that'll be all" hangs up.
- [ ] (c) **Registered phone, wrong digits twice:** one retry, app referral, hang-up; no account fact spoken; the next call from that phone still gets phone details (not onboarding).
- [ ] (d) **Registered phone, data question before verifying** ("what's my balance?"): asked for name and digits; nothing spoken from the account.
- [ ] (e) **Long question** (spending breakdown): at most three items, a recap sentence, an offer for more.
- [ ] (f) **Lookup service stopped:** fixed fallback and a clean hang-up.
- [ ] (g) Logs from all runs contain no phone number, digits or transcript text (with `LOG_TRANSCRIPTS=0`).

## Phase 6 — Docs and checklist

- [ ] Update `services/calls/docs/onboarding.md` (routing step, new table, new routes), [Calls.md](../../../Calls.md) (inbound status, both sequences), [docs/backend-runbook.md](../../backend-runbook.md) (migration 008, new env vars).
- [ ] [spec-checklist.md](../../../spec-checklist.md): CALLS-04 (inbound), CALL-02, SEC-02, SEC-04, SEC-06 (log redaction), INTEG-03. Tick only with live evidence.

## Order and parallel work

Phase 0, then Phase 1 (routing data) and Phase 2.1 (speak helpers) can go in parallel. Phase 2.2–2.6 needs Phase 1. Phase 3 needs the `/internal/voice/route` contract from 1.3 (code against a fake until it lands). Phase 4 is optional. Phase 5 needs everything.

## Pitfalls

- Caller ID can be spoofed: it picks the sequence and the candidate account, nothing more. The name + last-four check against the linked account is the gate, and it lives in the lookup service, not the prompt.
- A failed returning-caller check must never fall through to onboarding; that path links numbers to customers.
- Registrations are pruned after 24 hours; `onboarding_phone_link` is the only durable phone record. Do not prune it.
- Inbound room names contain the phone number: hash them in logs and never echo them to the model.
- Nessie origins and keys differ between the lookup service and the finance server; keep phone-details data on the lookup service's client.
- This is sandbox-grade identity (name, last four, caller ID). Do not reuse it for real accounts.
