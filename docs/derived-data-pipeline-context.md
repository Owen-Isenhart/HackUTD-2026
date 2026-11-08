# Derived data pipeline — context for a planning session

Written 2026-11-08 from the code on `main` at commit `eaa65cd`. This file gathers what a fresh planning session needs. It is not a plan. Each fact below was read from the code or docs named next to it, unless it is marked as a guess.

The project's two standing documents are [`context.md`](../context.md) (requirements, design defaults, history) and [`spec-checklist.md`](../spec-checklist.md) (the delivery checklist). Section 19 of `context.md` describes the repo layout after all branches were merged.

## 1. The request

Arjun's words, lightly trimmed:

> After the user onboards with their name and the last four digits of their Capital One account, the app will automatically use the Nessie API to pull their financial data and create a state-of-the-art forecast of their finances. From there, we determine their routines, like what time they go to work, or that they get lunch every day at 11. We use the forecast to also create a budget, which we use as a constraint on our recommendation algorithm. Then we have to maximize their rewards. Capital One rewards are provided; we already have them scraped in the synthetic data set. What we need to add: based on the locations the user frequents, those retail stores are automatically selected. For all selected stores, the app uses a burner email to sign the user up for those stores' rewards programs, so the user benefits from both Capital One rewards and the stores' own rewards. This could be fast food like Taco Bell or Chipotle, or retail like Macy's or JCPenney. The user should no longer have to optimize manually for the most rewards at the least cost. There are already some rudimentary implementations. The job is to complete the derived data pipeline in its entirety.

"Derived data pipeline" here means the chain that starts from the raw bank data and derives everything after it. There are eight stages:

1. **Onboarding.** Name plus the card's last four digits identify the user's Nessie customer record.
2. **Bank pull.** Fetch accounts, transactions, bills and loans from Nessie.
3. **Forecast.** A day-by-day projection of the user's balance.
4. **Routines.** Where and when the user habitually spends, and their daily schedule.
5. **Budget.** Derived from the forecast and used as a hard limit by the recommender.
6. **Store selection.** The stores the user frequents are picked automatically.
7. **Rewards signup.** Each selected store's loyalty program is joined using the user's burner email address.
8. **Rewards-maximizing recommendation.** Capital One card offers and store loyalty offers are combined, subject to the budget.

## 2. Rules from the spec that bind this work

These come from `context.md` sections 7, 10, 12 and 14, and they still apply:

- **Calculation by code, not by the model.** Anything that can be calculated exactly (money, dates, budgets, ranking) is done by deterministic code. Nemotron, the team's language model, is used only for judgment about language. Every model reply is checked before use.
- **Budgets are hard limits.** A recommendation may never break one. Before recommending "skip", look for a cheaper alternative that genuinely meets the same need.
- **Explicit user edits.** A budget change made by the user creates a new budget version. Section 14 also says: "Ask for missing periods during onboarding rather than assuming daily or monthly."
- **Rules the model guesses.** The optimizer holds a rule the model inferred, as opposed to one the user stated, for the user to confirm, and never enforces it (`optimizer/README.md`).
- **No made-up data.** Only movement may be simulated. Deals, financial inputs, messages, calls and recommendation results must never be fabricated and presented as real. Sandbox data must be labeled as sandbox data.
- **Merchant signup.** "Do not bypass CAPTCHA or fabricate identity data." Existing memberships, unsupported programs and verification challenges must be shown as explicit states.
- **Secrets stay on the server.** Never in the mobile bundle or in logs.
- **Name plus last four is not authentication.** `context.md` section 18: it "selects a sandbox record and must not be presented as real bank authentication."

## 3. What exists today, stage by stage

### Stage 1 — Onboarding by name and last four

- **Nothing in the code does this.** A search for "last4", "last four" and similar across every app and backend found nothing.
- `app/src/screens/SignInScreen.tsx` is a visual placeholder with Username and Password fields and a demo button. Section 18 of `context.md` says the same.
- The only description is a recipe in [`services/deals/docs/nessie-synthetic-handoff.md`](../services/deals/docs/nessie-synthetic-handoff.md), section 8. It lists customers, matches first and last name, lists that customer's accounts, and checks `account_number.endsWith(last4)`.
- A Google sign-in and Calendar plan was proposed (`context.md` section 18). Its plan file was never committed, and none of it was built.

### Stage 2 — Pulling bank data from Nessie

There are **two different Nessie APIs** in this repo, and the code that builds profiles uses the old one. This is the main structural gap.

| | Old Nessie (used by the finance backend) | Nessie v2 (where the synthetic data lives) |
| --- | --- | --- |
| Address | `https://prod-api.nessieisreal.com` | `https://v2-prod-api.nessieisreal.com` |
| Key | `?key=` in the URL query | `Authorization: Bearer` header |
| Who is read | One fixed account from `NESSIE_ACCOUNT_ID` | Customer → accounts, found at run time |
| Purchases | `/accounts/{id}/purchases`, fields `_id`, `amount` in dollars, `purchase_date` | `/accounts/{id}/transactions` and `/transactions`, fields `id`, `kind`, `amount_cents`, `created_at`, paged with `next_cursor` |
| IDs | UUIDs | `cust_…`, `acct_…`, `merch_…` |
| Code | `backend/nessie.js`, `backend/finance-profile.js`, `backend/nessie-cashflow.js` | `services/deals/scripts/sync-nessie-deals.ts`, `services/deals/scripts/seed-nessie-synthetic.mjs` |

The synthetic dataset is in v2. It was built by `seed-nessie-synthetic.mjs`, which is deterministic (random seed 2026) and wipes the tenant before reseeding. It contains:

- **Customer:** Alex Taylor, `cust_01m6x5w635z27trg3dfbhjxjvx`, Richardson TX (UT Dallas).
- **Three accounts:**
  - Checking, ending 2583
  - Capital One SavorOne credit card, ending **6619**, `acct_01m6x5w635z27trg3dfh0d2rk1`
  - Savings, ending 1517
- **Bills:** 6 recurring monthly bills on the checking account, about $1,867 a month in total.
- **Loan:** 1 student loan, $225 a month.
- **Transactions:** 2,500 over about two years, November 2024 to November 8, 2026. They include payroll deposits, purchases, transfers, refunds and ATM withdrawals.
- **Merchants:** 17, with real Dallas-area addresses and coordinates:
  - Chipotle, Starbucks, Chick-fil-A, Panera
  - Walmart, Target, Shell, Chevron
  - Booking.com, Best Buy, Nike, Home Depot, Sephora, Uber Eats, Lululemon, Macy's
  - Bluebird Coffee
- **Not included:** Taco Bell and JCPenney, both named in the request.
- **Evidence and sample shapes:** [`services/deals/docs/nessie-synthetic-evidence.json`](../services/deals/docs/nessie-synthetic-evidence.json).

`backend/finance-profile.js` reads the last 90 days of purchases from the old API and builds the profile snapshot. The snapshot holds the balance, spending totals, transactions, routines, and a summary of bank cash flow (bills, loans, payroll history). It is stored in TigerData table `hackutd_finance.profile`, keyed by the Nessie account ID (`backend/tiger-memory.js`).

### Stage 3 — Forecast

There are three forecast implementations:

1. **`backend/finance-forecast.js` (Node). This is the one in use.** It is deterministic and works in integer cents.
   - It projects 30 or more days.
   - It reconciles scheduled bills against posted payments and against obligations read from texts, so the same bill is not counted twice.
   - It detects payroll cadence (weekly, biweekly, semimonthly or monthly) from at least 3 deposits.
   - It estimates daily discretionary spending from the last 60 days.
   - It returns the lowest projected balance and "safe to spend". Safe to spend is `null` whenever data is missing or uncertain.

   It has tests (`test/finance-forecast.test.js`).
2. **`optimizer/src/optimizer/forecast.py`.** The optimizer's README calls it "a stand-in until the forecast tasks are built".
3. **A reference implementation in [`services/deals/docs/financial-forecasting-handoff.md`](../services/deals/docs/financial-forecasting-handoff.md),** written for Nessie v2. It is not wired in anywhere. It contains a fallback ("payrollCadenceDays = 14") that contradicts the doc's own "zero hardcoding" rule.

"State of the art" is not defined anywhere. Checklist item DISC-08 (compare methods from primary sources) is still open. Today's forecast is a rule-based projection, not a statistical model, and it has no uncertainty bands.

The forecast also uses obligations read from text messages (Photon) and forwarded email. Those come from `backend/text-obligations.js` and `backend/photon-texts.js`, which are tested in `test/text-obligations.test.js`.

### Stage 4 — Routines

- **`calculateRoutines` in `backend/finance-profile.js`.** It groups purchases by merchant, weekday and part of the day. The parts of the day are defined in `src/routineTime.js`: midday is 11:00 to 14:00. A routine needs purchases on at least 2 distinct days, and its confidence is "higher" from 4 days. Each routine records the merchant, category, typical amount and provenance.
- **`interpretRoutines` in `backend/nemotron.js`.** It asks Nemotron to highlight one routine, sends only aggregate facts, and validates the reply.
- **The optimizer's own routine model** (`RoutineEntry` in `optimizer/src/optimizer/models.py`). Nemotron compiles it from the free-text files `profile/initial-routine.md` and `profile/financial-profile.md`, which are still placeholders.
- **"What time they go to work" cannot be derived from purchases alone.** Nothing stores location history. The commute concept exists only in the spec and in the optimizer's profile-file format ("places they only pass by").

### Stage 5 — Budget

- **The budget is user-confirmed only today.** The profile's `confirmedBudget` comes from `hackutd_finance.confirmed_memory`, written by `PUT /api/finance-memory`. It is versioned and has `period` and `limitCents`.
- **Nothing derives a budget from the forecast.**
- **The recommender does enforce limits.** `recommendationFinances` in `backend/recommendation.js` takes the smallest of three amounts:
  - the balance
  - the lowest forecast balance minus the reserve
  - the budget left after upcoming plans

  It also returns a specific reason when a purchase is refused (`budget_limit`, `forecast_liquidity`, and so on).
- **The optimizer** enforces per-category budgets in the user's time zone (`optimizer/src/optimizer/budgets.py`).

### Stage 6 — Store selection

- **The deals service already turns purchases into enrollments.** `observePurchase` in `services/deals/src/service.ts` records a purchase. If the merchant has a program in `deals.program`, `updateEnrollmentFromPurchases` creates a queued enrollment and an `enroll` job. It also tracks the one-year inactivity deadline.
- **`sync-nessie-deals.ts` feeds it from Nessie v2.** It maps merchant names to deals merchant IDs through a hard-coded table of 12 names, and reads at most 500 transactions.
- **Selection today means "bought there and the store has a program".** Nothing selects stores by visits or location. The phone's location is never stored as history.
- **Two store lists that don't meet.** The app's nearby-store search (`app/src/location/nearbyStores.ts`, OpenStreetMap through Overpass) is not connected to selection. Neither is the backend's 3-store demo catalog (`src/nearbyOffers.js`).

### Stage 7 — Rewards signup with a burner email

- **Burner addresses exist.** Each owner can have a Photon email address on `deals.getcompfy.com` (table `deals.identity`). Signed inbound email reaches the deals worker and is parsed into offers. One real email was received end to end (`context.md` section 17).
- **Merchant loyalty programs: only two.** `chipotle_rewards` and `mypanera`, both in **assisted** mode. The worker marks the enrollment `needs_user_input`, and a person completes the merchant's form, phone number and SMS code. Migration `004_assisted_merchant_handoff.sql` deliberately reset earlier automatic enrollments for these two because they had no real evidence.
- **The "automatic" mode never contacts a merchant.** `enrollmentHandoff` in `service.ts` only updates database rows to `enrolled` and `confirmed`. That mode is used for the ten Capital One "programs". No code anywhere submits a merchant signup form.
- **One program per merchant.** `deals.program.merchant_id` is `UNIQUE` (`migrations/001_deals.sql`). So a store can't have both a Capital One offer program and its own loyalty program, and Macy's can't have both "Capital One 6%" and Macy's own rewards. Today the Capital One entries use those merchant IDs.
- **No program records for many stores.** There are none for Taco Bell, JCPenney, Starbucks, Chick-fil-A, Walmart's or Target's own loyalty programs, Macy's own rewards, and so on.

### Stage 8 — Capital One offers and the recommender

- **The Capital One offers are hard-coded.** `CAPITAL_ONE_SPECS` in `services/deals/src/capital_one.ts` lists 12 offers: Nike 5%, Walmart 2%, Macy's 6%, Sephora 4%, Best Buy 3%, Target 2%, Home Depot 4%, Uber Eats 5%, Booking.com 6%, Lululemon 4%, plus Chipotle "$3 off $15" and Panera "20% off". They are not scraped and not in Nessie.
- **They are test-only.** `scripts/seed-capital-one.ts` refuses to run unless `DEALS_ALLOW_TEST_FIXTURES` is set. `candidates()` in `service.ts` leaves out Capital One offers unless test data is allowed.
- **What "scraped" means needs settling.** The request says the Capital One rewards are "already scraped in the synthetic data set". In the code they are this hand-written list. `context.md` section 17 says no permitted way to collect real Capital One offers was found, and that REWARD-05 "remains unmet". Yet REWARD-05 is ticked in the checklist (commit `7f4fc4c`).
- **The recommender doesn't read deals offers.** `recommendVisit` in `backend/recommendation.js` uses the 3-store demo catalog in `src/nearbyOffers.js`, with a 300 m radius and made-up cashback percentages. Those stores carry old-API merchant UUIDs, not v2 `merch_…` IDs. It never calls the deals `candidates` endpoint, and `backend/deals-gateway.js` blocks that route from the app on purpose.
- **The optimizer can model all of this.** Its input world (`demoWorld` in `backend/optimizer.js`, models in `optimizer/src/optimizer/models.py`) already has places, items, offers of several kinds, payment methods, budgets and judgments. It picks the card and offers with a constraint solver (OR-Tools CP-SAT) that is tested against brute force. Today the backend fills that world with one cash payment method and demo cashback only.

## 4. Two separate owner identities

- **Finance backend:** data is keyed by the Nessie account ID (`hackutd_finance.*`). The app authenticates with one shared `FINANCE_DEMO_TOKEN`.
- **Deals service:** data is keyed by a UUID per owner (`deals.*`), protected by row-level security (database rules that limit each owner to their own rows). The finance backend reaches it as a single owner configured in `DEALS_OWNER_ID`.
- **Neither maps a signed-up user to the other.** A design for one identity per user exists in `docs/backend-integration-plan.md`, but it is not built.

## 5. Environment facts

- **No secrets in this checkout.** None of `.env`, `.env.deals.local`, `.env.deals.runtime.local`, `app/.env.local` or `services/calls/.env.local` exists in `C:\Users\Arjun\HackUTD-2026-frontend`. Live Nessie, TigerData, Photon and Nemotron can't be reached from here until someone supplies them.
- **Offline tests work.** On 2026-11-08 they all passed:
  - root finance backend: 38 pass, 1 skipped
  - `app/`: 19
  - `optimizer/`: 81
  - `services/calls/`: 58
  - `services/deals/`: 33 unit tests
- **The deals database tests need PostgreSQL.**
- **Model.** Nemotron runs on the team's Brev machine as `nemotron-bolt`, with an 8,192-token limit and step-by-step reasoning off. It is reached at `http://127.0.0.1:8000/v1` through `brev port-forward`.

## 6. Decisions the planning session must make

Each item is a fork where the request, the spec or the code disagree, or where nothing decides yet.

1. **Real or simulated store signups.** The request asks for automatic signup with a burner email. Real loyalty signups usually need a phone number, an SMS code, and sometimes a CAPTCHA (a test that blocks bots). The spec forbids bypassing CAPTCHA and inventing identity data. The "automatic" mode only writes database rows. Choose one:
   - real automated submission where a merchant allows it
   - assisted handoff (what exists)
   - a clearly labeled simulated signup for the demo

   If simulated, it must be labeled, per the no-fabrication rule.
2. **A budget derived from the forecast versus a user-confirmed budget.** The spec treats budgets as user-set and versioned, and the optimizer refuses to enforce inferred rules. Options:
   - The derived budget is a proposal the user confirms in one tap during onboarding.
   - Derived budgets are enforced automatically, with the spec updated to say so.
3. **Which Nessie.** Move the finance backend to Nessie v2, or adapt v2 data into the old profile shape. The synthetic data exists only in v2.
4. **Capital One offer provenance.** Decide how to label the 12 hand-written offers: "synthetic", or fixtures with links to the real pages. Decide whether to untick REWARD-05 (and REWARD-02).
5. **More than one program per merchant.** Drop `UNIQUE(merchant_id)` on `deals.program`, or model card-linked offers separately from store loyalty programs.
6. **Where store selection comes from.**
   - purchases only (exists)
   - also visits, which needs location history that isn't stored today
   - also the OpenStreetMap search

   Also decide the rule: for example, at least N purchases in the last D days.
7. **Merchant coverage.** Add Taco Bell and JCPenney to the synthetic Nessie data and to `deals.program`, or drop them from the demo. Decide which loyalty programs to model for the 17 existing merchants.
8. **What "state-of-the-art forecast" means.** Keep the deterministic projection and add uncertainty ranges, or adopt a statistical method after DISC-08 research. The spec requires integer-cent arithmetic and conservative bounds either way.
9. **Commute and work times.** Infer them from purchase timing, ask the user during onboarding, or collect location history. Location history adds privacy rules and storage.
10. **One identity across finance and deals.** Decide how a user found by name and last four becomes one owner in both databases.
11. **Which recommender is final.** The Node `recommendVisit` with its built-in checks, or the Python optimizer fed the full world (cards, Capital One offers, store loyalty offers). Today Node does the money checks and then hands ranking to the optimizer.
12. **Which app.** `app/` is the one connected to the backend (section 19 of `context.md`). Onboarding screens would go there unless another app is chosen.

## 7. Files to read first

| Purpose | File |
| --- | --- |
| Synthetic dataset and onboarding recipe | `services/deals/docs/nessie-synthetic-handoff.md` |
| Forecast design notes (v2) | `services/deals/docs/financial-forecasting-handoff.md` |
| Profile, routines, old Nessie client | `backend/finance-profile.js`, `backend/nessie.js`, `backend/nessie-cashflow.js` |
| Forecast in use | `backend/finance-forecast.js` |
| Money checks and recommendation | `backend/recommendation.js`, `backend/optimizer.js`, `src/routineOffers.js`, `src/nearbyOffers.js` |
| Budget and memory storage | `backend/tiger-memory.js`, `backend/migrations/` |
| Deals purchases, enrollment, offers | `services/deals/src/service.ts`, `services/deals/src/enrollment.ts`, `services/deals/src/capital_one.ts`, `services/deals/migrations/` |
| Nessie v2 to deals sync | `services/deals/scripts/sync-nessie-deals.ts` |
| Optimizer inputs and rules | `optimizer/README.md`, `optimizer/src/optimizer/models.py` |
| Planned API and identity design | `docs/backend-integration-plan.md` |
| Requirements and history | `context.md` (sections 7, 9, 14, 17, 19), `spec-checklist.md` |

## 8. How this file was checked

- **Read from source:** every file path, function name, field name and number in sections 3 to 5 was read from the code or docs on `main` at `eaa65cd`. The missing-secrets finding was checked by looking for each file. The test counts are from runs earlier on 2026-11-08.
- **Not checked:** what the live Nessie v2 server returns today, whether the synthetic data is still seeded there, what TigerData contains, and whether any merchant's signup form can be submitted automatically. None of these could be reached from this machine.
