# HackUTD 2026 — Specification and Implementation Checklist

Project requirements, decisions and design defaults: [context.md](context.md).

Each unchecked item is future work and may be marked complete only with its stated evidence. Completing documentation does not mean implementing the feature. Discovery tasks gate dependent implementation; do not silently omit difficult requirements.

### Specification

- [x] SPEC-01 — Capture all five user updates, corrections and the original vision in this file.
- [x] SPEC-02 — Close clarification and distinguish requirements, design defaults and unverified feasibility.
- [x] SPEC-03 — Supply an individually checkable implementation backlog without implementing, committing or pushing.

### Provider and research gates

- [ ] DISC-01 — Record official URLs, exact products and versions for all four required providers; include access dates and account availability.
- [ ] DISC-02 — Verify Photon calling, text access and email capabilities independently; document permissions, limits and unsupported paths.
- [ ] DISC-03 — Verify Nessie endpoints and sandbox/real-data status; list available balance, transaction, merchant and location fields.
- [ ] DISC-04 — Verify TigerData deployment, isolation, indexing, geospatial capabilities, encryption and backups; record the selected supported configuration.
- [ ] DISC-05 — Verify Nemotron endpoint/model, tool/structured-output support, hosting and costs; record a usable configuration without secrets.
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
- [ ] ONBOARD-02 — Start an actual Photon onboarding call linked to the authenticated user; expose call failures.
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
- [ ] OPT-02 — Retrieve geographically feasible candidates within a configurable bubble; verify boundary distances and units.
- [ ] OPT-03 — Enforce purchase-intent and suitability constraints; cheaper mismatched alternatives must be rejected.
- [ ] OPT-04 — Compute payable cost, cashback and reward treatment; verify exclusions, minimum spend and stacking restrictions.
- [ ] OPT-05 — Filter by hard budgets and forecast liquidity before ranking; every returned candidate must satisfy active constraints.
- [ ] OPT-06 — Implement the researched ranking method with reproducible ties and retained rejection reasons.
- [ ] OPT-07 — Search suitable affordable alternatives before recommending skipping; communicate incomplete evidence accurately.
- [ ] OPT-08 — Explain costs, eligibility and budget impact; generated wording must match deterministic results.
- [ ] OPT-09 — Invalidate recommendations when material input versions change or expire.

### Notifications and calls

- [ ] NOTIFY-01 — Gate delivery on contextual suitability; demonstrate suppression of the known commute example.
- [ ] NOTIFY-02 — Deliver the first appropriate notification once; GPS jitter must not duplicate it.
- [ ] NOTIFY-03 — Implement opening/ignoring transitions with timestamped evidence and the documented repeat policy.
- [ ] NOTIFY-04 — Add the place mute action and explain purchase-driven reactivation; muting suppresses subsequent encounters.
- [ ] NOTIFY-05 — Reactivate on a verified post-mute purchase; importing older history must not reactivate.
- [ ] NOTIFY-06 — Enforce cooldown and global preferences across delivery/retry paths; reactivation cannot bypass global disablement.
- [ ] CALL-01 — Implement explicit recommendation-call opt-in; disabled users must receive no automated recommendation calls.
- [ ] CALL-02 — Deliver actual Photon calls using validated recommendations; handle unanswered/failed calls with bounded behavior.
- [ ] CALL-03 — Support conversation-driven updates through the validated memory harness during recommendation calls.

### App and security

- [ ] APP-01 — Build home/forecast views showing horizon, uncertainty and pending clarifications.
- [ ] APP-02 — Build recommendation detail with evidence, savings, eligibility, skip rationale and place controls.
- [ ] APP-03 — Build budget/preferences/memory editors with versioned saves and visible confirmation.
- [ ] APP-04 — Build enrollment status and notification/call/privacy settings including connection revocation.
- [ ] SEC-01 — Keep secrets server-side; inspect source, bundles and logs for accidental credential exposure.
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

### Deals workstream software evidence — November 7, 2026

The original project-wide checkboxes above retain their acceptance scope. The narrower implementation checks below record tested deals code without treating unavailable real-provider demonstrations as completed requirements. Full evidence and D-step mapping: [docs/deals-validation.md](docs/deals-validation.md).

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

Latest operator choice: Chipotle already exists; Panera does not. Those decisions are saved in the two prepared enrollment flows. They are not evidence of actual external registration or subscribed marketing. No real merchant confirmation/promotion has arrived yet. The current status supersedes earlier billing/zero-message blockers; see [the validation report](docs/deals-validation.md).
