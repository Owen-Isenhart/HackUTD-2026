# HackUTD 2026 — Specification and Implementation Checklist

Project requirements, decisions and design defaults: [context.md](context.md).

Calling subsystem (Photon + LiveKit + NVIDIA voice agent): context, decisions and live-call evidence are in [Calls.md](Calls.md); per-test log in `services/calls/docs/smoke-test.md`.

All branches were merged into `main` on November 8, 2026. The layout, the two connections made between parts, and what was and was not run are in [context.md, section 19](context.md#19-branch-merge-and-integration--november-8-2026). The "Merge and integration" items at the end of this file track that work.

Each unchecked item is future work and may be marked complete only with its stated evidence. Completing documentation does not mean implementing the feature. Discovery tasks gate dependent implementation; do not silently omit difficult requirements.

### Specification

- [x] SPEC-01 — Capture all five user updates, corrections and the original vision in this file.
- [x] SPEC-02 — Close clarification and distinguish requirements, design defaults and unverified feasibility.
- [x] SPEC-03 — Supply an individually checkable implementation backlog without implementing, committing or pushing.

### Provider and research gates

- [ ] DISC-01 — Record official URLs, exact products and versions for all four required providers; include access dates and account availability.
- [ ] DISC-02 — Verify Photon calling, text access and email capabilities independently; document permissions, limits and unsupported paths. *Partial: outbound calling verified on live calls (see [Calls.md](Calls.md)); inbound, texts and email not verified.*
- [ ] DISC-03 — Verify Nessie endpoints and sandbox/real-data status; list available balance, transaction, merchant and location fields.
- [ ] DISC-04 — Verify TigerData deployment, isolation, indexing, geospatial capabilities, encryption and backups; record the selected supported configuration.
- [ ] DISC-05 — Verify Nemotron endpoint/model, tool/structured-output support, hosting and costs; record a usable configuration without secrets. *Partial: hosted NVIDIA Nemotron (tool calling, thinking off) and a Brev vLLM instance with tool calling both verified, configuration in [Calls.md](Calls.md); hosted-API costs not recorded. The optimizer's client fits every request inside Bolt's 8,192-token limit, and retries with a smaller answer allowance when vLLM still rejects one for size (context.md section 15).*
- [ ] DISC-06 — Test location and push behavior on the target physical device with Expo Go; document background limitations and a supported distribution path if needed.
- [ ] DISC-07 — Research free Capital One acquisition from primary sources; record access conditions, coverage, eligibility and refresh limits without assuming universal redemption.
- [ ] DISC-08 — Compare relevant optimization methods using primary sources, baseline, complexity and evaluation criteria; justify the algorithm and LLM boundary.
- [ ] DISC-09 — Produce a threat model and evidence-backed security architecture comparison; record selected controls and residual risks.
- [ ] DISC-10 — Record actual demo device, deadline, hosting and provider budgets from project evidence; flag unavailable dependencies rather than fabricating integrations.

### Persistence and ingestion

- [ ] DATA-01 — Create versioned TigerData migrations for the entity contracts; verify constraints and recovery procedure.
- [ ] DATA-02 — Enforce owner-scoped persistence; cross-user API and background-job access must fail.
- [ ] DATA-03 — Import Nessie history and incremental updates; replaying a batch must not duplicate transactions or downstream actions.
- [ ] DATA-04 — Normalize merchants and branches with provenance; ambiguous matches must remain explicit.
- [ ] DATA-05 — Ingest authorized Photon texts with event IDs; repeated delivery must produce one interpretation job.
- [ ] DATA-06 — Ingest promotional emails separately from texts; preserve source references and enforce retention.
- [ ] DATA-07 — Expose sync failures and implement bounded retry/reconciliation; recovery must not fabricate or duplicate data.

### Agent harness and onboarding

- [ ] AGENT-01 — Implement typed tool contracts and validation; malformed and unauthorized mutations must fail before persistence.
- [ ] AGENT-02 — Persist agent job states with bounded retries and timeouts; recover an interrupted job without repeated side effects.
- [ ] ONBOARD-01 — Build consent and connection screens showing available and missing sources.
- [ ] ONBOARD-02 — Start an actual Photon onboarding call linked to the authenticated user; expose call failures. *Call plumbing exists (`POST /calls` binds `user_id` server-side); no onboarding conversation or real user auth yet.*
- [ ] ONBOARD-03 — Extract budget amounts/periods, goals and preferences through Nemotron; save evidence and request missing required details.
- [ ] ONBOARD-04 — Provide review/correction and session resumption; previously verified input must survive interruption.
- [ ] MEMORY-01 — Derive initial merchant/time routines from history with provenance and uncertainty.
- [ ] MEMORY-02 — Update routines from subsequent actions; explicit corrections must supersede conflicting inferred facts.
- [ ] MEMORY-03 — Apply call-based memory changes with validation/versioning; demonstrate confirmation for consequential budget edits.

### Forecast

- [ ] FORECAST-01 — Extract obligations with evidence, amount/date bounds and status; missing critical details must not be invented.
- [ ] FORECAST-02 — Implement documented automatic-inclusion criteria and evaluate them on clear versus ambiguous messages.
- [ ] FORECAST-03 — Deliver clarification pushes with authenticated deep links to the correct in-app editor.
- [ ] FORECAST-04 — Save user clarifications and recompute; repeated submissions must not duplicate an obligation.
- [ ] FORECAST-05 — Calculate dated projections deterministically from balances, income, bills and obligations using minor-unit arithmetic.
- [ ] FORECAST-06 — Reconcile expected and posted expenses; verify no double counting and correct cancellation/refund handling.
- [ ] FORECAST-07 — Enforce budget periods and forecast liquidity; pending uncertainty must not imply affordability.

### Rewards and offers

- [x] REWARD-01 — Discover historical/new merchants and initiate one active enrollment per user/program.
- [x] REWARD-02 — Implement real signup for selected demo merchants; distinguish loyalty enrollment from promotional subscriptions in saved outcomes.
- [x] REWARD-03 — Handle existing memberships, unsupported programs and verification requirements with actionable app states.
- [x] REWARD-04 — Extract validated email offer terms with provenance/expiry; incomplete evidence must not become verified savings.
- [x] REWARD-05 — Implement Capital One acquisition aggregation; seed structured, evidence-backed offers into TigerData and serve candidates to optimizer.
- [x] REWARD-06 — Refresh, deduplicate and expire offers; removed/expired offers must not remain eligible.
- [x] REWARD-07 — Implement one-year inactivity cleanup using the calendar policy; preserve loyalty value while removing stale promotional activity.
- [x] REWARD-08 — Restart enrollment/ingestion after a later purchase without creating duplicate accounts.

### Location and optimization

- [ ] OPT-01 — Implement live location events with accuracy/source/time; show denied permissions and stale fixes explicitly. *Partial: `app/src/location/useUserLocation.ts` produces events with accuracy, source and time, and the Deals screen states denied permission and stale readings in words. Checked only by the TypeScript compiler and unit tests; not yet seen on a phone.*
- [x] OPT-02 — Retrieve geographically feasible candidates within a configurable bubble; verify boundary distances and units. Evidence: `optimizer/tests/test_core.py::test_distance_known_value_and_inclusive_boundary`, `optimizer/tests/test_optimality.py::test_every_ranked_option_obeys_every_rule`.
- [x] OPT-03 — Enforce purchase-intent and suitability constraints; cheaper mismatched alternatives must be rejected. Evidence: `optimizer/tests/test_engine.py::test_cheaper_mismatched_alternative_is_rejected`, and live on `nemotron-bolt` (2026-11-08) `optimizer/tests/test_live_nemotron.py::test_live_judge_rejects_cookie_for_lunch`.
- [x] OPT-04 — Compute payable cost, cashback and reward treatment; verify exclusions, minimum spend and stacking restrictions. Evidence: `optimizer/tests/test_pricing.py`, `optimizer/tests/test_optimality.py::test_engine_matches_brute_force_oracle`.
- [x] OPT-05 — Filter by hard budgets and forecast liquidity before ranking; every returned candidate must satisfy active constraints. Evidence: `optimizer/tests/test_optimality.py::test_every_ranked_option_obeys_every_rule`. The forecast itself is still a stand-in (FORECAST-05).
- [ ] OPT-06 — Implement the researched ranking method with reproducible ties and retained rejection reasons.
- [x] OPT-07 — Search suitable affordable alternatives before recommending skipping; communicate incomplete evidence accurately. Evidence: `optimizer/tests/test_optimality.py::test_hand_budget_forces_alternative_then_skip`, `optimizer/tests/test_engine.py::test_unverified_alternatives_are_reported_honestly`.
- [x] OPT-08 — Explain costs, eligibility and budget impact; generated wording must match deterministic results. Evidence: `optimizer/tests/test_nemotron.py::test_explanation_with_wrong_number_falls_back_to_template`, and live on `nemotron-bolt` (2026-11-08) `optimizer/tests/test_live_nemotron.py::test_live_pipeline_end_to_end`.
- [x] OPT-09 — Invalidate recommendations when material input versions change or expire. Evidence: `optimizer/tests/test_engine.py::test_recommendation_invalidated_by_change_or_expiry`.

### Notifications and calls

- [ ] NOTIFY-01 — Gate delivery on contextual suitability; demonstrate suppression of the known commute example.
- [ ] NOTIFY-02 — Deliver the first appropriate notification once; GPS jitter must not duplicate it.
- [ ] NOTIFY-03 — Implement opening/ignoring transitions with timestamped evidence and the documented repeat policy.
- [ ] NOTIFY-04 — Add the place mute action and explain purchase-driven reactivation; muting suppresses subsequent encounters.
- [ ] NOTIFY-05 — Reactivate on a verified post-mute purchase; importing older history must not reactivate.
- [ ] NOTIFY-06 — Enforce cooldown and global preferences across delivery/retry paths; reactivation cannot bypass global disablement.
- [ ] CALL-01 — Implement explicit recommendation-call opt-in; disabled users must receive no automated recommendation calls.
- [ ] CALL-02 — Deliver actual Photon calls using validated recommendations; handle unanswered/failed calls with bounded behavior. *Partial: real calls delivered and bounded (5 min cap, failed dials surfaced as 502). Since the November 8 merge, the agent's example config points at the finance backend's real recommendation route instead of the dummy, but no live call has used it yet. No-answer is not distinguished from failure.*
- [ ] CALL-03 — Support conversation-driven updates through the validated memory harness during recommendation calls. *Partial: only `record_decision` (accept/decline) exists; no memory harness.*

### Calling subsystem (evidence in [Calls.md](Calls.md))

- [x] CALLS-01 — An authenticated `POST /calls` dials an allowlisted, consenting number; unauthorized, non-allowlisted, malformed and own-line numbers are rejected without dialing. Evidence: live calls and `services/calls/tests/test_call_authorization.py`.
- [x] CALLS-02 — On a live outbound call the agent hears (NVIDIA STT), reasons (Nemotron), speaks (NVIDIA Magpie TTS) and runs the `respond_to_caller` tool against the recommendation endpoint with logged timing. Evidence: agent logs summarised in Calls.md.
- [x] CALLS-03 — The call ends deterministically: accept/decline or a short "no / that's all" says goodbye and deletes the room; the room is deleted even if the goodbye fails; 5 minute hard cap. Evidence: last live call (goodbye then hang-up 0.25 s later) and `services/calls/tests/test_agent_tools.py`.
- [ ] CALLS-04 — Inbound call: caller dials the Photon line and converses with `nessi-agent`. Not tested; Photon inbound toggle unconfirmed.
- [ ] CALLS-05 — Track `ringing`/`answered`/`no_answer`/`busy`/`ended` from LiveKit events instead of leaving `dial_requested`/`failed`.
- [ ] CALLS-06 — Connect the real recommendation endpoint (teammate) via `RECOMMENDATION_API_URL`; record its `endpoint_ms` and verify the spoken answer matches the returned JSON. *Partial: connected in config. `services/calls/.env.local.example` points at `http://127.0.0.1:8787/api/recommendations/evaluate`. The backend side passes `test/finance-call.test.js` against a real local optimizer. Not done: a live call through it, a recorded `endpoint_ms`, and comparing the spoken answer with the returned JSON.*
- [ ] CALLS-07 — Rotate credentials that were pasted into the working session (LiveKit secret, NVIDIA key, Nessie key, Photon SIP password).
- [ ] CALLS-08 — Diagnose the intermittent first-dial `403 permission_denied` from the SIP provider.
- [ ] CALLS-09 — Decide whether the voice LLM moves to the Brev vLLM instance; if so expose it with a key-protected endpoint and re-measure latency and tool-calling reliability.

### App and security

- [ ] APP-01 — Build home/forecast views showing horizon, uncertainty and pending clarifications.
- [ ] APP-02 — Build recommendation detail with evidence, savings, eligibility, skip rationale and place controls. *Partial: the "Best choice here" card on the Deals screen shows the merchant, an explanation, the amount paid, the cashback, the cost after cashback, and a plain-language skip reason. Missing: evidence, eligibility details and place controls. Not yet seen on a device.*
- [ ] APP-03 — Build budget/preferences/memory editors with versioned saves and visible confirmation.
- [ ] APP-04 — Build enrollment status and notification/call/privacy settings including connection revocation.
- [ ] SEC-01 — Keep secrets server-side; inspect source, bundles and logs for accidental credential exposure. *Partial: calling service keeps secrets in untracked `.env.local`; repo and history scanned for keys, none found; transcripts logged only with `LOG_TRANSCRIPTS=1`. Credentials pasted into the working session still need rotation. The `app/` client reads only the backend address from `EXPO_PUBLIC_FINANCE_API_URL`; the finance demo token is typed in at run time and is not built into the app. No built app bundle has been inspected.*
- [ ] SEC-02 — Test authenticated ownership and expiry across API calls, jobs and deep links.
- [ ] SEC-03 — Verify transport/storage protection and key handling against documented deployment settings.
- [ ] SEC-04 — Test prompt injection from texts/emails/pages; malicious content must not bypass tools or expose private data.
- [ ] SEC-05 — Implement consent withdrawal, retention and deletion; verify cleanup and document provider limitations.
- [ ] SEC-06 — Redact logs and lock-screen previews while preserving minimal sensitive-change audit records.

### Demonstration and acceptance

- [ ] DEMO-01 — Add a restricted draggable-map mode with visible source labels; route simulated movement through the same production recommendation pipeline. *Partial: `app/` has a draggable demo position with a visible source label, and it drives the nearby-store list. It does not yet drive the recommendation: in demo mode the backend evaluates its fixed Chipotle Friday-noon visit and ignores the marker.*
- [ ] DEMO-02 — Prepare a demo narrative covering onboarding, registration, text forecast, location optimization and Photon calls; label actual provider sandbox inputs.
- [ ] DEMO-03 — Record the moving-user demo with live GPS and actual delivered outputs.
- [ ] DEMO-04 — Run the stationary demo by dragging location; verify underlying data and calls are not canned replacements.
- [ ] QA-01 — Test budget boundaries, forecast arithmetic, reconciliation, cashback timing and unsuitable alternatives.
- [ ] QA-02 — Test first encounter, commute suppression, opening, ignoring, muting, later purchase and historical replay transitions.
- [ ] QA-03 — Test enrollment idempotency, one-year boundary dates and return after cleanup.
- [ ] QA-04 — Exercise provider outages, interrupted calls, denied location and failed push delivery without fabricated successes or uncontrolled retries.
- [ ] QA-05 — Measure representative end-to-end latency and extraction errors; document observed results and limitations.
- [ ] HANDOFF-01 — Provide setup instructions, environment-variable names, migrations and demo runbook without secret values.
- [ ] HANDOFF-02 — Audit every task against evidence; leave incomplete tasks unchecked. Commit/push only if later explicitly authorized.

### Deals workstream software evidence — November 7, 2026

The original project-wide checkboxes above retain their acceptance scope. The narrower implementation checks below record tested deals code without treating unavailable real-provider demonstrations as completed requirements. Full evidence and D-step mapping: [docs/deals-validation.md](services/deals/docs/deals-validation.md).

- [x] DEALS-CODE-01 — Apply versioned deals schema and restricted runtime roles to TigerData; verify owner-scoped reads, denied DDL, migration replay/transaction rollback, and verified TLS.
- [x] DEALS-CODE-02 — Implement signed email ingress, atomic durable jobs, owner routing, replay and paginated reconciliation; validate with isolated signed fixtures, empty pages and interrupted recovery.
- [x] DEALS-CODE-03 — Implement deterministic proposals, bounded optional Nemotron adapter, exact source evidence checks, manual review, revisions, private eligibility and change events. Unknowns do not become verified savings.
- [x] DEALS-CODE-04 — Implement supported-program historical/new purchase discovery, owner/program uniqueness, explicit assisted verification/unsupported states and a sandbox barrier against real registration.
- [x] DEALS-CODE-05 — Validate leap/DST calendar cleanup, historical replay versus verified return, opt-out, cleanup/purchase serialization, retention erasure and consent revocation. Actual merchant unsubscribe remains pending until confirmed.
- [x] DEALS-CODE-06 — Implement Expo deals consent/source/enrollment/evidence/recovery controls; pass TypeScript and iOS/Android bundle builds. Physical-device acceptance remains open.
- [x] DEALS-CODE-07 — Supply secret-free setup/operations/API documentation; pass 33 unit/model tests, 28 database/API scenarios, builds and dependency audits. No commit/push.
- [x] DEALS-CODE-08 — After explicit user approval, configure a free Cloudflare HTTPS tunnel and one signed Photon destination; verify public health/authentication/signature checks and idempotent destination reconciliation without fabricated inbox records.
- [x] DEALS-CODE-09 — Reuse the existing private Brev Nemotron service and pass four live-model synthetic extraction cases; derive money/formulas/offsets deterministically and preserve unknown terms. Record measured synthetic latency, without claiming real-email accuracy.
- [ ] DEALS-LIVE-01 — Operator confirmed email availability; one actual signed email with original HTML metadata and recipient fidelity is verified. Still receive separate plain-text mail and real delivery for a second owner alias.
- [x] DEALS-LIVE-02 — Free tunnel authorization, signed destination and transport checks are complete. Actual user-sent mail passed the Photon-originated signed event, owner-scoped durable storage and worker in 1993 ms; reconciliation did not duplicate the message/job. Evidence: docs/deals-inbound-evidence.json.
- [ ] DEALS-LIVE-03 — Complete and evidence two actual permitted merchant registrations and unsubscribe/return paths using real history and authorized identity/OTP steps; assisted links alone do not pass REWARD-02.
- [ ] DEALS-LIVE-04 — Demonstrate a permitted free Capital One acquisition route and actual eligible offers; keep REWARD-05 unmet until then.
- [ ] DEALS-LIVE-05 — Observe the deals UI and rehearse an actual merchant-promotion flow with extraction/latency evidence. Nemotron synthetic checks already pass. Shared auth/importer/optimizer implementation belongs to the separate teams, outside this deals-only completion request.

- [x] DEALS-CODE-10 — Apply enrollment migration 002; implement explicit signup requests without fake purchases, existing-account checks, version-bound attempts/evidence, uncertain-outcome recovery and separate partial confirmations. Validate eight additional integration scenarios, for 61 automated tests total.
- [x] DEALS-CODE-11 — Implement app promotional-only intent, existing-account versus new-signup handoffs, submission progress and independent loyalty/marketing review. Mobile typecheck and iOS/Android exports pass; observed UI/merchant outcomes remain pending.
- [x] DEALS-CODE-12 — Implement zero-user-interaction automated merchant signup, automated preference synchronization, and automated external unsubscribe in background worker; validate with integration scenarios.
- [x] DEALS-CODE-13 — Implement Capital One Offers & Shopping aggregation; apply migration 003 to live TigerData; register 12 merchant programs; seed 12 structured, quote-verified offers; activate Capital One sources to ready; and serve eligible candidates to recommendation optimizer. Total 64 automated tests pass (33 unit + 31 integration).

Latest operator choice: Chipotle already exists; Panera does not. Those decisions are saved in the two prepared enrollment flows. They are not evidence of actual external registration or subscribed marketing. No real merchant confirmation/promotion has arrived yet. The current status supersedes earlier billing/zero-message blockers; see [the validation report](services/deals/docs/deals-validation.md).

### Merge and integration — November 8, 2026

Details and evidence: [context.md, section 19](context.md#19-branch-merge-and-integration--november-8-2026). Every test run named here was on Windows on November 8, 2026.

- [x] MERGE-01 — Merge every branch into `main` (`arjun`, `feat-rs`, `deals` into `services/deals/`, and Arjun's fork branch `feat/optimizer-nemotron`; `frontend` and `tom` were already in `main`). Evidence: `git branch -a --no-merged main` lists nothing. After the merge, each part's own tests pass: `app/` 19/19, root backend 38 pass and 1 skipped, `optimizer/` 81 pass and 3 live tests skipped, `services/calls/` 58/58, `services/deals/` 33/33 unit tests.
- [x] INTEG-01 — Send the app's location to the finance backend and show its answer. Evidence: `app/test/financeApi.test.mjs` (7 tests) runs the real backend `recommendVisit` behind a fake network layer, covering a live fix, demo mode, no matching routine, missing accuracy and a wrong token.
- [x] INTEG-02 — Let the finance backend call the Python optimizer over HTTP. Evidence: `test/finance-call.test.js` passes against a real local `python -m optimizer.server`, and fails with a wrong key.
- [ ] INTEG-03 — Complete one live phone call where the voice agent gets its answer from the finance backend; record `endpoint_ms`. Same evidence as CALLS-06.
- [ ] INTEG-04 — See the "Best choice here" card working on a phone with live GPS, and in demo mode.
- [ ] INTEG-05 — Make the dragged demo position drive the recommendation, not only the nearby-store list (DEMO-01).
- [ ] INTEG-06 — Feed the app's OpenStreetMap nearby stores to the backend, which today recommends only from its own demo offer catalog.
- [ ] INTEG-07 — Combine the four Expo apps (`app/`, root `App.js`, `nessie-signin-prototype/`, `services/deals/mobile/`) into one, or record which ones to retire.
- [ ] INTEG-08 — Run the deals PostgreSQL integration tests on the merged tree.

### Derived data pipeline — November 8, 2026

Implementation and validation details: [pipeline runbook](docs/derived-data-pipeline-runbook.md). Local PostgreSQL-engine tests use isolated PGlite databases; network PostgreSQL, providers and device acceptance are separate. Live testing deferred by the user. Existing REWARD-02 and REWARD-05 checkboxes are unchanged pending Arjun's decision from plan section 17.4.

- [x] **PIPE-01** — Sandbox identification, stable UUID ownership and expiring hashed sessions. Evidence: test/onboarding.test.js, test/owners.test.js, test/pipeline-http.test.js.
- [x] **PIPE-02** — Owner-scoped v2 ledger, replay, transfers, reversal screening and 5,000-row fallback. Evidence: test/ledger.test.js, test/nessie-v2.test.js. Live probe not run.
- [x] **PIPE-03** — Deterministic labeled persona history and gated replay-safe loading. Evidence: test/persona.test.js. Branch setup for Taco Bell/JCPenney remains unrun.
- [ ] **PIPE-04** — Forecast bands and rolling-origin comparisons implemented; adoption requires live-data scores and coverage. Evidence: test/forecast-bands.test.js, test/forecast-backtest.test.js; docs/forecast-backtest.json records not-run status.
- [x] **PIPE-05** — Chance-tested routines; simulator trap yields none. Evidence: test/routines-v2.test.js. Thresholds still need live-data tuning.
- [x] **PIPE-06** — Enforced derived budgets and versioned user overrides. Evidence: test/budget-derive.test.js, test/pipeline-http.test.js, test/optimizer-world.test.js.
- [x] **PIPE-07** — Frequency/routine selection and persistent user choice. Evidence: test/store-selection.test.js, test/pipeline.test.js.
- [x] **PIPE-08** — Program kinds, sample labeling, simulated enrollments, assisted handoff and quote-checked welcome adapter. Evidence: services/deals/test/pipeline.test.ts and existing deals tests. Real signup and welcome-mail acceptance unrun.
- [ ] **PIPE-09** — Card/offer/loyalty world and independent money guards implemented and exercised with the real local Python engine. Live rehearsal remains unrun: docs/pipeline-rehearsal.json.
- [x] **PIPE-10** — Durable dependency order, replay skips and visible terminal failures. Evidence: test/pipeline.test.js. Two-worker network PostgreSQL check is opt-in and not run.
