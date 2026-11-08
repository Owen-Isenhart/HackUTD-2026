# HackUTD 2026 — Specification and Implementation Checklist

Project requirements, decisions and design defaults: [context.md](context.md).

Calling subsystem (Photon + LiveKit + NVIDIA voice agent): context, decisions and live-call evidence are in [Calls.md](Calls.md); per-test log in `services/calls/docs/smoke-test.md`.

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
- [ ] DISC-05 — Verify Nemotron endpoint/model, tool/structured-output support, hosting and costs; record a usable configuration without secrets. *Partial: hosted NVIDIA Nemotron (tool calling, thinking off) and a Brev vLLM instance with tool calling both verified, configuration in [Calls.md](Calls.md); hosted-API costs not recorded.*
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

- [ ] REWARD-01 — Discover historical/new merchants and initiate one active enrollment per user/program.
- [ ] REWARD-02 — Implement real signup for selected demo merchants; distinguish loyalty enrollment from promotional subscriptions in saved outcomes.
- [ ] REWARD-03 — Handle existing memberships, unsupported programs and verification requirements with actionable app states.
- [ ] REWARD-04 — Extract validated email offer terms with provenance/expiry; incomplete evidence must not become verified savings.
- [ ] REWARD-05 — Implement the verified free Capital One acquisition route and document measured coverage and redemption restrictions.
- [ ] REWARD-06 — Refresh, deduplicate and expire offers; removed/expired offers must not remain eligible.
- [ ] REWARD-07 — Implement one-year inactivity cleanup using the calendar policy; preserve loyalty value while removing stale promotional activity.
- [ ] REWARD-08 — Restart enrollment/ingestion after a later purchase without creating duplicate accounts.

### Location and optimization

- [ ] OPT-01 — Implement live location events with accuracy/source/time; show denied permissions and stale fixes explicitly.
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
- [ ] CALL-02 — Deliver actual Photon calls using validated recommendations; handle unanswered/failed calls with bounded behavior. *Partial: real calls delivered and bounded (5 min cap, failed dials surfaced as 502); recommendations are a dummy and no-answer is not distinguished from failure.*
- [ ] CALL-03 — Support conversation-driven updates through the validated memory harness during recommendation calls. *Partial: only `record_decision` (accept/decline) exists; no memory harness.*

### Calling subsystem (evidence in [Calls.md](Calls.md))

- [x] CALLS-01 — An authenticated `POST /calls` dials an allowlisted, consenting number; unauthorized, non-allowlisted, malformed and own-line numbers are rejected without dialing. Evidence: live calls and `services/calls/tests/test_call_authorization.py`.
- [x] CALLS-02 — On a live outbound call the agent hears (NVIDIA STT), reasons (Nemotron), speaks (NVIDIA Magpie TTS) and runs the `respond_to_caller` tool against the recommendation endpoint with logged timing. Evidence: agent logs summarised in Calls.md.
- [x] CALLS-03 — The call ends deterministically: accept/decline or a short "no / that's all" says goodbye and deletes the room; the room is deleted even if the goodbye fails; 5 minute hard cap. Evidence: last live call (goodbye then hang-up 0.25 s later) and `services/calls/tests/test_agent_tools.py`.
- [ ] CALLS-04 — Inbound call: caller dials the Photon line and converses with `nessi-agent`. Not tested; Photon inbound toggle unconfirmed.
- [ ] CALLS-05 — Track `ringing`/`answered`/`no_answer`/`busy`/`ended` from LiveKit events instead of leaving `dial_requested`/`failed`.
- [ ] CALLS-06 — Connect the real recommendation endpoint (teammate) via `RECOMMENDATION_API_URL`; record its `endpoint_ms` and verify the spoken answer matches the returned JSON.
- [ ] CALLS-07 — Rotate credentials that were pasted into the working session (LiveKit secret, NVIDIA key, Nessie key, Photon SIP password).
- [ ] CALLS-08 — Diagnose the intermittent first-dial `403 permission_denied` from the SIP provider.
- [ ] CALLS-09 — Decide whether the voice LLM moves to the Brev vLLM instance; if so expose it with a key-protected endpoint and re-measure latency and tool-calling reliability.

### App and security

- [ ] APP-01 — Build home/forecast views showing horizon, uncertainty and pending clarifications.
- [ ] APP-02 — Build recommendation detail with evidence, savings, eligibility, skip rationale and place controls.
- [ ] APP-03 — Build budget/preferences/memory editors with versioned saves and visible confirmation.
- [ ] APP-04 — Build enrollment status and notification/call/privacy settings including connection revocation.
- [ ] SEC-01 — Keep secrets server-side; inspect source, bundles and logs for accidental credential exposure. *Partial: calling service keeps secrets in untracked `.env.local`; repo and history scanned for keys, none found; transcripts logged only with `LOG_TRANSCRIPTS=1`. Credentials pasted into the working session still need rotation.*
- [ ] SEC-02 — Test authenticated ownership and expiry across API calls, jobs and deep links.
- [ ] SEC-03 — Verify transport/storage protection and key handling against documented deployment settings.
- [ ] SEC-04 — Test prompt injection from texts/emails/pages; malicious content must not bypass tools or expose private data.
- [ ] SEC-05 — Implement consent withdrawal, retention and deletion; verify cleanup and document provider limitations.
- [ ] SEC-06 — Redact logs and lock-screen previews while preserving minimal sensitive-change audit records.

### Demonstration and acceptance

- [ ] DEMO-01 — Add a restricted draggable-map mode with visible source labels; route simulated movement through the same production recommendation pipeline.
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
