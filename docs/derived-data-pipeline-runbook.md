# Derived data pipeline

Implemented on 2026-11-08 in the existing checkout. The user asked to run the plan, then explicitly deferred live-service testing. No live credentials were supplied. Live reports contain not-run status rather than fabricated evidence.

## Run locally when configuration is available

1. Run npm ci in the repository root, services/deals and app. The optimizer uses its existing Python environment.
2. Supply server-only configuration from .env.example. Finance and deals must share the intended PostgreSQL database and DEALS_AUTH_SECRET; use the service's existing database roles. The finance pool requires migrations 001–008.
3. Apply finance migrations with npm run finance:migrate. Apply deals migrations through its existing db:migrate command and ADMIN_DATABASE_URL; new migrations are 005_program_kinds.sql, 006_loyalty_catalog.sql and 007_additional_programs.sql. Existing applied migrations were not edited.
4. Start the existing deals API and worker. Enable DEALS_DEMO_SIMULATED_SIGNUP=1 only for labeled synthetic simulations. DEALS_ALLOW_TEST_FIXTURES=1 is required independently in both finance and deals to count sample offers. Seed sample offers with the existing explicit fixture-seed command if desired. Owner provisioning alone neither creates an email alias nor grants consent.
5. Start the optimizer on its existing private endpoint and set OPTIMIZER_API_URL / OPTIMIZER_API_KEY on finance. Optional Nemotron judgment uses the existing private endpoint configuration.
6. Start finance with npm run finance:serve. With a configured database it serves the new owner/session pipeline. FINANCE_DEMO_TOKEN is optional for session-only use; operator compatibility needs FINANCE_OPERATOR_OWNER_ID and a token of at least 24 characters. Texts, call delivery and background location remain explicitly bound to that operator.
7. Set only EXPO_PUBLIC_FINANCE_API_URL in the app environment and start app/. The Expo Router entry identifies a sandbox customer by name and last four, persists a native session in SecureStore, resumes saved onboarding, shows progress/questions/budgets/stores and exposes the actual ledger and forecast. Web sessions are memory-only.

## Configuration

- NESSIE_V2_API_KEY; optional NESSIE_V2_BASE_URL (default https://v2-prod-api.nessieisreal.com). Old API keys are not silently reused.
- TIGER_DATA_URL and TIGER_DATA_PASSWORD, FINANCE_TIME_ZONE (default America/Chicago).
- DEALS_API_URL and DEALS_AUTH_SECRET, with matching issuer/audience if customized. Each gateway token names the request's owner UUID.
- PERSONA_HISTORY_ENABLED=1 opts the one recorded synthetic customer into the generated persona file. The file has 826 labeled purchases; missing branch IDs remain null and visible until setup.
- Existing Photon entitlement/consent settings govern alias/mail handling; no signup is attempted for a synthetic identity.
- Existing NEMOTRON_BASE_URL / NEMOTRON_MODEL / NEMOTRON_API_KEY and optimizer settings are optional or fail visibly where required.

## Interfaces

Unauthenticated POST /api/v1/onboarding/identify takes firstName, lastName, last4. It normalizes names exactly, applies address/name limits, never persists full account numbers and issues a 30-day opaque session. All subsequent new routes resolve that session to one owner.

Owner routes: GET/PUT /api/v1/onboarding; GET/PUT /api/v1/onboarding/answers; POST /api/v1/onboarding/stops/check; POST /api/v1/onboarding/complete; POST /api/v1/finance/sync; GET /api/v1/pipeline/runs/{runId}; GET /api/v1/finance/forecast; GET /api/v1/routines; GET/PUT/DELETE /api/v1/budgets; GET/PUT /api/v1/stores. Budget and store edits use current versions and return 409 on conflicts. DELETE /api/v1/session revokes the stored token. Existing profile/transaction/recommendation paths now serve the session-backed pipeline when a database is configured. The deals gateway blocks mobile access to purchase/candidate integration routes.

Jobs run bank pull → persona → forecast → routines → budget → selection → enrollment. Claims use PostgreSQL SKIP LOCKED, owner locking and lease-token checks. Retry backoff ends in a visible dead state and marks dependent stages failed. Repeated data does not rewrite ledger rows or budget versions. Enrollment sync sends only changed purchase observations in batches to the existing deals purchase endpoint, preserving sandbox provenance, and replays registration requests safely. Its signup decision hash depends on selection/consent; purchases can still be reconciled when signups are unchanged.

## Product defaults and deliberate details

- Budgets: six complete local calendar months, 20% income savings allowance, scale no lower than 60%, round down to $5, monthly. Explicit user versions survive derivation.
- Store selection: two visits in 180 days or an active purchase routine, ten automatic selections; user choices persist. Paid loyalty programs cannot enroll.
- Demo movement carries the actual marker. The new narrow lunch routine requires a Friday 11:12 demo clock; the plan's old Friday-noon clock would miss the generated 11:00–11:25 Chipotle habit. The response labels demo time. The legacy fixed-noon path remains solely for compatibility tests.
- Current [Capital One Savor public terms](https://www.capitalone.com/credit-cards/savor/) were read on 2026-11-08. The sandbox nickname says SavorOne; the UI accurately says modeled on current public Savor terms. Grocery superstores do not receive the grocery category bonus. Channel-specific bonuses are not guessed. Source data is data/card-terms.json.
- Chipotle, Chick-fil-A and Taco Bell earn rules are points, not cash. Other catalog earn rates stay unknown until evidenced. Fixed conversions require URL, quote and verification date. All price inputs remain estimates from routines/history. Minimum spend, product scope, exclusions, payment and stacking still have to pass eligibility; the illustrative $3-off example is not forced onto an ineligible typical purchase.
- Simulated signups store simulated=true and simulated_demo_signup evidence, never contact a merchant and never claim marketing subscription. Real assisted flows remain needs_user_input. A welcome message requires the right domain, verification time and an exact program/membership quote. It confirms membership only; it cannot prove separate promotional consent. Unknown mail remains available for manual review.
- The old direct deals sync is now a compatibility wrapper that queues the authenticated finance pipeline. It cannot read another customer's tenant-wide transactions. Legacy old-API finance CLI/demo code remains available; the app uses the v2 session path.

## Validation and deferred work

Local Node tests cover sessions, identity, PostgreSQL-engine migration replay, owner isolation, ledger replay and 5,000-row fallback, persona/DST, deterministic bands, backtest leakage, routines/simulator trap, budgets, selection, job retries and HTTP version checks. Deals tests execute all migrations on isolated PostgreSQL-engine databases, simulated/assisted signup constraints, fixture labeling and actual gateway/API contracts. Optimizer world tests invoke the real local Python engine, including a verified cheaper alternative under a binding category budget. App tests cover stored authentication, 401 handling and marker labeling. App TypeScript, lint, deals build and web bundling are checked locally.

PGlite is an embedded PostgreSQL engine, not proof of multi-connection network PostgreSQL behavior or the deployed roles. TEST_TIGER_PIPELINE=1 enables the separate disposable-schema concurrency test against a supplied database. Existing external integration suites remain separate.

The read-only npm run finance:probe and rolling npm run finance:backtest are implemented. Forecast adoption is gated on twelve rolling origins, lower balance and spending pinball loss than both existing and repeat-30 comparisons, and 70–90% coverage. No live scores or state-of-the-art claim exists. Until adoption, recommendations use the existing deterministic forecast.

Live-service validation, forecast scoring on the tenant, model judgments/welcome-mail checks, actual merchant handoff, phone/GPS and real call delivery are deliberately unrun. Branch research hit public Overpass failures before testing was deferred; no addresses or merchant IDs were invented. npm run finance:merchants reads complete OSM addresses and --apply creates only missing merchants; it has not been run against the tenant. npm run finance:rehearse writes redacted stage/result evidence once the services are configured. No live provider writes, commit or push were performed.
