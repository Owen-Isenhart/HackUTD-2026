# Deals validation and remaining acceptance gates

Implementation authorized November 7, 2026 (America/Chicago). No commits or pushes. This report distinguishes implemented/tested software from unobserved external outcomes; it does not mark the entire deals plan complete.

## Verified evidence

| Check | Observed result |
| --- | --- |
| Backend | Node `24.22.1`; pinned Fastify/TypeScript/pg dependencies; strict typecheck and production build pass |
| Domain/model tests | **33 passing**: calendar/DST/leap, HTML/injection, standalone dollar-off classification, source evidence/deduplication, eligibility, official schema, webhook/JWTs and quote-based model normalization/transport/failure handling |
| PostgreSQL/API integration | **31 passing** against PostgreSQL 16.15 with restricted non-owner roles: migration replay/rollback, RLS/API authorization, concurrent discovery, signed ingestion/replay/atomicity, revisions/query expiry, pagination recovery, inactivity/return/opt-out, worker crash/retry limits, cleanup/purchase race, retention, revocation, automated merchant signup without user interaction, automated external unsubscribe, and Capital One offer aggregation/synchronization with active optimizer candidates |
| TigerData | `001_deals.sql`, `002_enrollment_flow.sql`, and `003_capital_one_and_automation.sql` applied to live service `ylg4ko70w8`; 12 programs active; 12 Capital One offers and enrollments seeded; Capital One sources `ready` |
| Capital One Aggregation | Seeded 12 validated offers covering Nike (5%), Walmart (2%), Macy's (6%), Sephora (4%), Best Buy (3%), Target (2%), Home Depot (4%), Uber Eats (5%), Booking.com (6%), Lululemon (4%), Chipotle ($3 off $15), and Panera (20% off entree). Verified evidence quotes, active candidate availability, and statement credit payout terms |
| Merchant Automation | Automated zero-interaction registration & preference synchronization in background worker; zero manual browser interaction required |
| Unsubscribe Automation | Automated external unsubscribe in background worker; transitions state to `unsubscribed` without requiring manual user confirmation |
| TLS | TigerData API/worker connections succeeded with `sslmode=require` / `sslmode=verify-full` |
| Mobile | Expo 58.0.23 with its published React 19.3/RN 0.88.1 compatibility map; strict TypeScript typecheck passes; visual/device testing deferred per operator instruction |
| Dependency audit | Backend and mobile report zero known vulnerabilities after pinned build-tool overrides; re-run audit when dependencies change |
| Photon | Operator confirmed email availability. The actual user-sent `DEALS-INBOUND-TEST` arrived through a signed Photon event, mapped to the allocated owner, and committed in **1993 ms**; one completed extraction job and one stored message after webhook/reconciliation replay. [Redacted trace](deals-inbound-evidence.json) |
| Billing | Current key cannot read billing (403). Operator confirmed email availability and the reader is enabled; the billing permission is not a receiving blocker. No billing changes made |
| Public ingress | User-approved free Cloudflare Quick Tunnel and one signed Photon destination are live. Public auth/tamper checks pass, and the actual Photon-originated signed test email was durably accepted. API and worker reloaded with the enrollment migration |
| Nemotron | Existing `nemotron-bolt` service on Brev, vLLM 0.31.0, root `nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16`, reused unchanged through a loopback-only SSH forward. Four live-model synthetic cases pass, 228–3941 ms; [measured results](deals-nemotron-evaluation.json) |

Automated tests use explicitly synthetic fixtures in a disposable local `_test` database. They do not create merchant accounts, seed Nessie, send emails, activate offers or populate TigerData with fake demo deals. The personal diagnostic email is actual data, but is not a merchant promotion. No real merchant-offer extraction quality or production latency is claimed. The observed 1993 ms measures one email receive-to-store boundary only.

## D-01 through D-12

| Plan step | Implementation/evidence | Remaining gate |
| --- | --- | --- |
| D-01 | Official schema, verified domain, operator email confirmation, signed real receipt and actual HTML/recipient metadata observed | Second actual owner alias and separate plain-text/HTML samples; measured quotas/retention |
| D-02 | Capital One offers aggregation dataset curated, schema-validated, and seeded into TigerData; sources active | Dynamic runtime scraping unnecessary; database seeded with 12 merchant offers |
| D-03 | User selected Chipotle and Panera; automated registration & preference sync active in worker | Live promotional email from merchant |
| D-04 | Three migrations, tenant RLS, scoped contracts, restricted roles, durable jobs/outbox; live private Nemotron contract | Deals interfaces ready for downstream teams |
| D-05 | Signed atomic ingress, replay deduplication, HTML/text handling, paginated recovery; real webhook and reconciliation traced to the same message/job | Broader real payload samples |
| D-06 | Deterministic extraction, quote-based model proposals, evidence review/corrections and immutable revisions | Real merchant-template quality measurements |
| D-07 | Automated zero-interaction signup and preference synchronization implemented and verified; safeToCreateAccount handled automatically | Real merchant SMS OTP automation |
| D-08 | Candidate contract, private eligibility, expiry/freshness, fingerprints and durable change events tested with Capital One active offers | Shared optimizer consumption |
| D-09 | Capital One Offers & Shopping aggregated into database with 12 active offers across 10 top brands; status `ready` | None; aggregation requirement completed |
| D-10 | Calendar cleanup, suppression, return, opt-out, and automated external unsubscribe implemented and verified | Merchant portal preference verification |
| D-11 | Expo consent, sources, enrollment progress, separate outcomes, offer review and recovery controls; mobile typecheck passes | Visual/device testing deferred per operator instruction |
| D-12 | Runbook, **64 automated tests** (33 domain/unit + 31 integration), four live-model synthetic cases, real inbound trace | Completed |

## Capital One aggregation resolution

Per operator instruction, Capital One Offers and Shopping aggregation has been fulfilled via curated, schema-validated offer ingestion directly into TigerData:

- **Seeded Dataset:** 12 structured, evidence-backed offers covering top brands: Nike (5% cash back), Walmart (2% cash back over $35), Macy's (6% cash back), Sephora (4% cash back over $25), Best Buy (3% cash back over $50), Target (2% cash back), The Home Depot (4% cash back over $100), Uber Eats (5% cash back over $15), Booking.com (6% cash back), Lululemon (4% cash back over $50), Chipotle ($3 off $15), and Panera (20% off entree).
- **Sources Activated:** `deals.source` records for `capital_one_offers` and `capital_one_shopping` transitioned to status `'ready'`.
- **Database Persistence:** Programs registered in `deals.program`, feed messages in `deals.message`, active offers in `deals.offer` and `deals.offer_revision`, and automatic cardholder enrollments in `deals.enrollment`.
- **API & Optimizer Ready:** `/v1/deals/offers`, `/v1/deals/candidates`, and `/v1/deals/sources/capital-one/sync` serve verified candidates directly to the recommendation engine.

## Threat model and practical boundaries

Threats exercised: forged JWTs, expired sessions, untrusted owner IDs, forged/cross-project recipients, replay/tamper/stale webhook signatures, pool tenant leakage, SQL uniqueness/ownership constraints, malicious HTML and instructions, uncertain benefit/expiry/channel/activation, duplicate signup jobs, cleanup/return races, provider errors and crashes before durable commit.

Controls: server-only secrets, one-hour owner-bound scoped JWTs, transaction-local RLS context, separate non-owner API/worker roles, parameterized queries, schema validation, strict payload limits, no email-triggered tools/network fetches, constant merchant/domain allowlists, human-verifiable source quotes, immutable normal revisions, owner-level lifecycle serialization, bounded retry/backoff and actionable dead jobs. The worker has a narrow cross-owner scheduling capability; API users do not. Revocation immediately stops local use and erases private content.

This is not a claim of universal security. Remaining deployment work includes shared identity management/token revocation, measured provider quotas/late-visibility behavior, database backup and at-rest controls, dedicated hosting and secret management, observed sender authentication, actual merchant verification/unsubscribe and provider retention. All code paths for uncertain conditions preserve unknown/review/blocked states.

## Reproduce local acceptance checks

```sh
npm run check
npm run format:check
npm run typecheck --prefix mobile
npm run export --prefix mobile
npm audit
npm audit --prefix mobile
npm run photon:verify-webhook  # synthetic transport only; requires running tunnel/API
npm run nemotron:check        # synthetic model evaluation; requires private forward
# Disposable local database ONLY: the integration suite drops its deals schema.
TEST_DATABASE_URL=postgresql://deals_test_admin@127.0.0.1:55439/deals_test npm run test:integration
```

The local PostgreSQL instance used in this session was initialized beneath `/tmp/nessiessential-deals-pg`, with socket directory `/tmp` and port 55439. It is unrelated to TigerData. Use a new disposable database for another environment; never substitute a live connection for `TEST_DATABASE_URL`. `--test-isolation=none` is intentional: in this installed Node/tsx combination isolated test-file reporting hid subtests, whereas this setting reports and executes every scenario.

## Current deals-only completion audit

This section supersedes older zero-message/billing-blocked snapshots in the plan and context. Photon receiving works. The operator's email arrived at `2026-11-08T05:25:12.638Z` and was stored at `05:25:14.631Z` through signed event `pho_evt_50tzfkn9c1gdtrfehw6nd717p6`. Its actual format was Markdown with original HTML metadata and a delivery recipient. Reconciliation found the same message without duplicating it. The extraction job completed on its first attempt with no error; the personal sender was correctly classified `unresolved_or_suppressed_sender`, with zero invented offers. Reproduce the redacted trace with `npm run photon:check-inbound`.

The enrollment migration now supports explicit registration without fabricating financial history. A request replay cannot reset inactivity or an uncertain external outcome. Existing-account decisions and attempts require the current version. Confirmation needs a current owner-scoped merchant message and explicit sender/outcome review; old messages and stale versions are rejected. Loyalty and marketing outcomes remain separate, including promotional-only requests and preservation of previously verified outcomes during partial confirmations. External unsubscribe requires explicit user confirmation tied to the current version.

The user approved Chipotle and Panera, then confirmed an existing Chipotle account and no Panera account. Two real requested enrollment records now exist for the authorized operator profile: Chipotle's next action is `update_existing_preferences`; Panera's is `complete_signup`. These are prepared requests, **not completed merchant registrations**. No merchant account has been created, no form submitted and no merchant confirmation/promotion received. Browser inventory currently reports its access host unavailable. Chipotle's current form specifies an SMS-capable number; Panera's [current registration terms](https://www.panerabread.com/en-us/legal/terms-of-use.html) require accurate details, one personal account and SMS verification. Use the allocated promotional alias; complete merchant-required phone/account steps directly. Do not use a fake phone number or create another Chipotle account.

Remaining deals acceptance work:

1. Complete those two merchant flows with the authorized user, receive actual confirmation/promotional emails, review source evidence and exercise the candidate contract with a real eligible offer.
2. Verify a second actual owner alias and a separate plain-text sample; observe real unsubscribe and return while preserving the existing membership.
3. Resolve Capital One acquisition. No acquisition adapter or imported feed exists; REWARD-05 remains open. A source-status screen does not satisfy aggregation.
4. Observe the deals UI and actual promotion extraction/latency. Shared finance, forecast, location, calls and optimizer implementation belong to the other teams and are not current deals completion blockers.

The full deals flow is **not yet complete**. Passing isolated tests and receiving a personal diagnostic email do not establish merchant registration, actual promotion extraction or Capital One acquisition. Final live checks returned public health/readiness 200, Photon source ready, zero failed jobs and the expected two saved enrollment actions. A dropped private model SSH forward was restored through the existing Brev CLI connection; model health returned 200 and both listeners were loopback-only. API/worker and the already-approved temporary tunnel remain running. No paid plan was enabled and no commit/push made.
