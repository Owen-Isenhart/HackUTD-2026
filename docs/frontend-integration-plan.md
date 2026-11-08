# Frontend integration plan — connecting `app/` to every backend feature

Written 2026-11-08. It is based on two things:

- branch `docs/derived-data-pipeline-plan` at commit `420b748`;
- the uncommitted work of the session building [derived-data-pipeline-plan.md](derived-data-pipeline-plan.md), as it stood at about 06:30 CST.

That uncommitted work is still changing. So this plan stays at the level of screens, data sources, rules and order of work. Exact field names get confirmed in phase 0 (section 8), once that work is committed.

Nothing in this plan has been built. Section 13 says what was read and what was run while writing it.

## Contents

1. Words used in this plan
2. The goal, and what "done" means
3. What the app shows today
4. What the backend offers the app
5. Problems in the code that this plan works around
6. Rules every screen follows
7. The app's data layer
8. Order of work
9. Screen by screen
10. Features that need extra native modules or a custom build
11. Testing
12. Small backend changes this plan asks for
13. How this plan was made
14. Decisions for Arjun

---

## 1. Words used in this plan

- **The app** is `app/`, the Expo app the team is standardizing on. The other three Expo apps (root `App.js`, `nessie-signin-prototype/`, `services/deals/mobile/`) are called "the old apps".
- **Owner session** is the sign-in token the backend gives after the name-plus-last-four lookup (`POST /api/v1/onboarding/identify`). The app keeps it in the phone's encrypted storage (SecureStore).
- **Operator** is the single team account the backend is configured for, named by the setting `FINANCE_OPERATOR_OWNER_ID`. Some older routes (texts, alerts, calls) work only for this account. The shared `FINANCE_DEMO_TOKEN` also signs in as the operator.
- **Pipeline routes** are the new routes in `backend/pipeline-http.js` (onboarding, budgets, stores, routines, the new forecast and ledger). **Older routes** are the ones still in `scripts/finance-profile.js`.
- **Deals routes** are the deals service's `/v1/deals/*` routes. The phone reaches them through the finance backend, which forwards each request with a short-lived token for the signed-in owner (`backend/deals-gateway.js`).
- **Sample, synthetic, simulated**: the labels the spec requires for anything not real. Section 6 lists the exact words.

---

## 2. The goal, and what "done" means

The goal is that every backend feature a phone can use is reachable from the app, with real data or a plain statement of why it is unavailable.

The plan is done when all of these hold:

- **No made-up numbers.** `app/src/mock/sample.ts` is deleted, and nothing imports it. Today four screens still draw from it.
- **Every feature has a screen.** Every route in section 4 marked "for the app" is used by at least one screen, or is listed in section 14 as deliberately left out.
- **Every non-real input is labeled** with the words in section 6.
- **One sign-in, one API client, one look.** The plain placeholder screens (built on `PipelineControls.tsx`) use the same components and theme as the designed screens.
- **Checks pass.** `npx tsc --noEmit` and `npm test` pass in `app/`. Device checks are listed separately for a person to run (section 11.4).

---

## 3. What the app shows today

"Real" means the data comes from the backend. "Mock" means it comes from `mock/sample.ts`. Rows marked *uncommitted* are the pipeline session's work.

| Place | Today | Data |
| --- | --- | --- |
| Sign-in | First name, last name, last four digits *(uncommitted)* | Real |
| Onboarding progress and questions | Pipeline stages, work hours, regular stops, store-email consent *(uncommitted)* | Real |
| Deals tab: map, GPS, demo position | Live GPS or draggable demo marker | Real (phone) |
| Deals tab: nearby stores | OpenStreetMap search | Real (OpenStreetMap) |
| Deals tab: "Best choice here" card | Recommendation for this place | Real |
| Deals tab: map pins, "Featured Perks", search box, category chips, "Effortless Local Cashback" note | Four invented merchants and claims | Mock |
| Spending tab | Ledger list in plain styling (`FinanceHistoryScreen`) *(uncommitted)* | Real |
| Upcoming tab | Forecast range and routines in plain styling (`FinanceForecastScreen`) *(uncommitted)* | Real |
| Designed `SpendingScreen` and `UpcomingScreen` | No longer opened by any tab | Mock |
| Account tab | "Elena Rostova", "Stillwater" card, Face ID, travel mode, concierge, statements | Mock |
| Account tab: links to Budgets and Stores | *(uncommitted)* | Real |
| Budgets and Stores screens | Plain styling *(uncommitted)* | Real |
| Header on every tab | "Stillwater Bank"; the bell does nothing | Mock |

---

## 4. What the backend offers the app

### 4.1 Routes for any signed-in owner

| Feature | Route | Used by the app now |
| --- | --- | --- |
| Find sandbox account and get a session | `POST /api/v1/onboarding/identify` | Yes |
| Sign out | `DELETE /api/v1/session` | Yes |
| Onboarding state, answers, stops check, finish | `GET`/`PUT /api/v1/onboarding`, `GET`/`PUT /api/v1/onboarding/answers`, `POST /api/v1/onboarding/stops/check`, `POST /api/v1/onboarding/complete` | Yes |
| Pipeline progress | `GET /api/v1/pipeline/runs/{runId}` | Yes |
| Refresh everything | `POST /api/v1/finance/sync` (returns a `runId`) | Yes |
| Profile | `GET /api/finance-profile` | Yes (Deals tab) |
| Transaction ledger, paged | `GET /api/finance-transactions?limit=&cursor=` | Yes (plain screen) |
| Forecast with low/middle/high range | `GET /api/v1/finance/forecast` | Yes (plain screen) |
| Routines with their source | `GET /api/v1/routines` | Yes (plain screen) |
| Budgets: list, edit, undo an edit | `GET /api/v1/budgets`, `PUT /api/v1/budgets/{category}`, `DELETE /api/v1/budgets/{category}/user` | Yes (plain screen) |
| Stores: list, select or drop | `GET /api/v1/stores`, `PUT /api/v1/stores/{brand}` | Yes (plain screen) |
| Recommendation for a position | `POST /api/finance-recommendation` | Yes |

### 4.2 Deals routes (any signed-in owner, through the finance backend)

| Feature | Route | Used by the app now |
| --- | --- | --- |
| Inbox and source status, failed jobs | `GET /v1/deals/status` | Onboarding only |
| Turn the store-email address on or off | `POST` and `DELETE /v1/deals/consent` | Turn on only |
| Program catalog | `GET /v1/deals/programs` | No |
| Enrollments and the next signup step | `GET /v1/deals/enrollments`, `GET /v1/deals/enrollments/{id}/flow` | Yes |
| Signup steps | `POST /v1/deals/enrollments`, and `…/{id}/existing-membership`, `/attempt`, `/confirm`, `/retry`, `/opt-out`, `/resume`, `/confirm-unsubscribe` | Partly (Stores screen) |
| Received offers, offer detail, correcting terms | `GET /v1/deals/offers`, `GET /v1/deals/offers/{id}`, `POST /v1/deals/offers/{id}/review` | No |
| The email an offer came from | `GET /v1/deals/messages`, `GET /v1/deals/messages/{id}` | No |
| Retry a source or a failed job | `POST /v1/deals/sources/{product}/retry`, `POST /v1/deals/jobs/{id}/retry` | No |

The deals service also has `/v1/deals/purchases`, `/candidates` and `/events`. Both the gateway and the pipeline router block them from the phone on purpose, because they are for server-to-server use.

### 4.3 Older routes that only the operator can use

| Feature | Route | Used by the app now |
| --- | --- | --- |
| Plans read from texts and forwarded email | `GET /api/text-obligations`, `POST /api/texts/sync` | No |
| Confirm or dismiss one plan | `PUT /api/text-obligations/{id}` | No |
| Goals and cash reserve (write) | `PUT /api/finance-memory` | No |
| Alert channel: off, call, or iMessage | `GET`/`PUT /api/v1/settings` | No |
| Register or remove this phone for background alerts | `POST /api/v1/devices`, `DELETE /api/v1/devices/{id}` | No |
| Places to watch in the background | `GET /api/v1/location/regions` | No |
| Background location report (device token) | `POST /api/v1/location/events` | No |
| Ask for a phone call about a recommendation, and its status | `POST`/`GET /api/v1/calls/{callId}` (the recommendation carries `callId`) | No |
| Backend health | `GET /health`, `GET /ready` (no sign-in) | No |

Each of these exists only when its own settings are present on the server. Otherwise the route answers 404 or 503.

- **Texts** need the Photon settings.
- **Alerts and devices** need the database. Any channel other than "off" also needs `ALERT_ALLOW_DEMO_CATALOG=1`, plus the call or iMessage settings.
- **Calls** need the call settings.

### 4.4 Not for the app

The phone must never call these:

- the calls service (`POST /calls`);
- the optimizer (`/internal/v1/optimizer/evaluate`);
- the voice-agent routes (`/api/recommendations/evaluate`, `/internal/v1/calls/{id}/actions`);
- the Photon webhooks.

The backend calls them.

---

## 5. Problems in the code that this plan works around

1. **A 401 from an operator-only route signs the user out.** The app's client (`call()` in `financeApi.ts`) deletes the session on any 401. Every route in 4.3 except the health checks answers 401 to any owner who is not the operator. Calling one of them would sign a normal user out. The app must know which features this owner may use before calling them. Section 7.3 covers this, and section 12 proposes a small backend fix.
2. **Two old read routes now answer 404.** When the database is configured, the pipeline router claims every `/api/v1/finance/*` path. So the old `GET /api/v1/finance/transactions` and `GET /api/v1/finance/memory` return 404. The app must use `/api/finance-transactions`. Goals and cash reserve can still be saved through `PUT /api/finance-memory`, but no route reads them back, except possibly as a profile field. Phase 0 checks that.
3. **The app cannot call the backend from a web browser.** The backend sends no cross-origin headers (CORS), the permission a server gives web pages from other addresses. Expo's web preview runs on a different address, so its requests fail. Only a phone or simulator works, unless the small backend change in section 12 is made.
4. **Two styles of screen.** The new real-data screens use plain placeholder components (`Page`, `Box`, `Action` in `PipelineControls.tsx`). The designed screens use `components/ui.tsx` and `theme.ts`.
5. **Capital One sample offers look like real ones in the offers list.** The 12 hand-written offers in `services/deals/src/capital_one.ts` are stored with a message whose classification is `capital_one_feed`. That message's trust field even says `verified: true`. The app can label them using only the classification, with no backend change (section 6).
6. **Background alerts need native modules the app lacks.** The old root app uses `expo-task-manager`, `expo-notifications` and `expo-crypto`; `app/package.json` has none of them. Alerts while the phone is locked also need a custom build, not Expo Go (section 10).

---

## 6. Rules every screen follows

**Money.** Amounts stay in whole cents until display. One shared formatter turns cents into dollars, and turns `null` into "Unavailable". Never zero.

**Labels for anything not real.** One small tag component maps the backend's source values to fixed words:

| Backend value | Words on screen |
| --- | --- |
| `nessie_sandbox` | Sandbox bank data |
| `synthetic_persona`, `synthetic_test` | Synthetic demo history |
| `user_stated`, `user` | Stated by you |
| offer from a `capital_one_feed` message, or label `sample_offer` | Sample offer, written by the team, not from Capital One |
| label `simulated_signup`, or `simulatedMembership: true` | Simulated signup (demo) |
| location source `demo` | Demo position (only your position is simulated) |
| `openstreetmap` | Store data © OpenStreetMap contributors |

A recommendation's `labels` list becomes one line under the card, for example "Includes a sample offer and a simulated membership."

**Five states for every piece of data.** Each list or card handles these, and never shows a blank or invented fallback:

- loading;
- empty, with what will fill it;
- unavailable, when the feature is not set up on this server (404 or 503 with a known code);
- error, with "Try again";
- out of date, when the data is cached or the forecast says `stale`.

**Edits carry the version they were read at.** Every save sends the `version` it was based on. On a 409 (someone or something changed it first), the app reloads, shows the new values, and says "This changed. Here is the latest." It never retries silently.

**Consequential changes need an explicit tap.** This covers budgets, alert and call consent, turning the store-email address on or off, and confirming a plan. The backend already requires `confirmed: true` for most of them. The app shows what will change before sending.

**No secrets in the app bundle.** The only build-time setting is `EXPO_PUBLIC_FINANCE_API_URL`. Tokens come from sign-in and live in SecureStore.

**No controls without a backend.** Remove these:

- Face ID
- travel mode
- concierge
- statements and tax reports
- "Link External"
- card lock and limits
- Auto-Pay
- "Pay Now" and "Schedule New Payment"
- the statement download
- the "19 consecutive days" streak
- "Rewards land … within 24 hours"

Section 14 asks whether to remove them or grey them out.

---

## 7. The app's data layer

### 7.1 One API client

- Move `call()` from `financeApi.ts` into `app/src/api/client.ts`. It keeps the current behavior: base address from `EXPO_PUBLIC_FINANCE_API_URL`, and the session token from `session.ts`.
- It returns one error type with a kind, so screens never inspect status codes:
  - **`signed-out`**: 401 on a route every owner may use. Clears the session.
  - **`not-allowed`**: 401 or 403 on an operator-only route. Does not clear the session.
  - **`unavailable`**: 404 or 503 meaning "not set up here", such as `deals_not_configured` or `pipeline_not_ready`.
  - **`conflict`**: 409.
  - **`invalid`**: 400.
  - **`network`** and **`timeout`**.
- Time limits are 10 seconds by default. `POST /api/v1/finance/sync` and the first profile load get 45 seconds, the same as the old root app.
- Typed modules sit on top, one per area:
  - `api/session.ts` (identify, sign out)
  - `api/onboarding.ts`
  - `api/finance.ts` (profile, ledger, forecast, routines, budgets, stores, recommendation, sync, runs)
  - `api/plans.ts` (text plans)
  - `api/alerts.ts` (settings, devices, regions, location events)
  - `api/calls.ts`
  - `api/deals.ts`
- The deals types and helpers can be lifted from `services/deals/mobile/api.ts`. That includes the link check that only opens known merchant sites.

### 7.2 Caching and refreshing

The recommendation is TanStack Query, a JavaScript library that fetches, caches and refetches data. It needs no native code, so it works in Expo Go.

The reasons:

- About 20 reads are shared across tabs.
- Many saves must refresh other reads.
- Data should reload when the app returns to the foreground.

Writing this by hand is possible (the alternative in section 14), but it means rebuilding caching, deduplication and refetching.

**What each change must refresh:**

| After this | Reload these |
| --- | --- |
| A pipeline run finishes (after sync, an onboarding answer, a budget edit or a store change) | Profile, ledger, forecast, routines, budgets, stores, the current recommendation |
| Confirming or dismissing a text plan | Text plans, forecast, the current recommendation |
| Any enrollment step | Enrollments, that enrollment's flow, stores |
| Reviewing an offer | Offers, that offer |
| Turning the store-email address on or off | Deals status, enrollments, offers |
| Changing the alert channel | Alert settings, regions |

**A single "run watcher".** Several edits return a `runId` because they start a pipeline run. One shared watcher polls `GET /api/v1/pipeline/runs/{runId}` every 2 seconds until every stage is `completed`, `skipped` or `dead`. Then it reloads the finance data above.

Today two places poll on their own: the onboarding screen, and `refreshProfile` in `useFinanceRecommendation.ts`. Both move onto the watcher.

**The recommendation keeps its own timing**, as it does now: on movement, after a set time, or when the nearby stores change. Only the newest request counts. A recommendation is hidden once its `expiresAt` passes.

### 7.3 Knowing which features this owner can use

One hook, `useCapabilities()`, answers these questions:

- signed in?
- operator?
- texts set up?
- which alert channels exist?
- are calls on?
- is deals set up?

**Preferred source:** a small new route, `GET /api/v1/me` (section 12). The integration plan in [backend-integration-plan.md](backend-integration-plan.md) already lists it.

**Fallback until it exists:** the app learns from answers it already gets.

- A `deals_not_configured` 503 turns deals off.
- A `not-allowed` on `GET /api/v1/settings` marks the owner as not the operator. The client must already treat that 401 as `not-allowed` (7.1), so this probe is safe.

Screens hide what is not available. Settings show a short note saying why.

### 7.4 One set of response types

- One `app/src/api/types.ts` holds the shapes of every response the app reads.
- The pipeline responses (forecast `bands`, budgets `spentCents`, stores `selections`, recommendation `payWith`/`applied`/`loyalty`/`budgetAfter`/`labels`) are copied from the committed backend in phase 0.
- The contract tests in section 11 keep these types matched to the backend.

---

## 8. Order of work

Sizes are rough, for one person: small is up to 3 hours, medium 3 to 8, large over 8.

| Phase | What | Needs first | Size |
| --- | --- | --- | --- |
| 0 | Settle the starting point | The pipeline session has committed its work | Small |
| 1 | Data layer and shared components | Phase 0 | Medium |
| 2 | Restyle the pipeline screens; replace the mock Account and header | Phase 1 | Large |
| 3 | Deals tab: richer "Best choice" card, real offers and pins | Phase 1 | Medium |
| 4 | Store rewards: signup steps, offer review, inbox status | Phase 1 | Large |
| 5 | Operator features: text plans, alerts, calls, goals and reserve | Phase 1 | Medium |
| 6 | Notifications and background alerts | Phase 5 | Medium, plus a custom build |
| 7 | Cleanup and final checks | Phases 2 to 6 | Small |

**Phase 0 in detail:**

- Wait for the pipeline session to commit.
- Read its final route shapes and fill in `types.ts`.
- Check whether the profile includes goals and the cash reserve (problem 5.2).
- Check whether the new forecast lists named upcoming bills, or only daily totals.
- Decide the items in section 14.
- Work in a separate git worktree, a second folder with its own branch, so this work and the pipeline session never write to the same folder.

**What can run in parallel after phase 1.** These touch different files:

- phases 3 and 4;
- phase 5;
- the Spending and Upcoming parts of phase 2.

**Phase 7 in detail:**

- Delete `mock/sample.ts`.
- Delete the placeholder components in `PipelineControls.tsx` once nothing uses them.
- Delete whichever of `SpendingScreen.tsx` / `FinanceHistoryScreen.tsx` and `UpcomingScreen.tsx` / `FinanceForecastScreen.tsx` was merged into the other.
- Run all checks.

The old apps stay until Arjun decides (section 14).

---

## 9. Screen by screen

### 9.1 Shell (phase 2)

- **Header brand.** It reads "Nessential", the same as the sign-in screen, instead of "Stillwater Bank".
- **The bell opens a "Needs you" list.** It contains:
  - text plans waiting for an amount or date (operator only);
  - enrollments in `needs_user_input`;
  - failed deals jobs;
  - data that is out of date.

  The bell shows a count when the list is not empty.
- **The avatar opens Account.**
- **A thin banner under the header** shows when the backend is unreachable (from `GET /health`) or when data is cached.

### 9.2 Sign-in and onboarding (owned by the pipeline session)

This plan does not rebuild these screens. It only moves them onto the shared client and components in phase 2.

It adds one thing: before sign-in, a line saying whether the backend address answers (`GET /health`). "Can't find the account" and "can't reach the server" then look different.

### 9.3 Deals tab (phase 3)

**Kept:** the map, live GPS, demo marker, accuracy ring, status line, radius chips and nearby-store list.

**"Best choice here" card:**

- Shows the pipeline fields when present:
  - what to pay with (`payWith`);
  - each applied offer (`applied`), with its sample tag where labeled;
  - the loyalty line (`loyalty`), for example "+140 Chipotle points, not counted as cash";
  - the budget left after the purchase (`budgetAfter`);
  - the one-line `labels` summary.
- Shows the routine it matched, and whether Nemotron or the fixed template wrote the explanation.
- Counts down to `expiresAt`, then replaces itself with "Check this place again".
- **Operator only:** when the recommendation has a `callId`, shows "Call me about this". It asks for consent first, sends `POST /api/v1/calls/{callId}` with `confirmed: true`, then polls `GET /api/v1/calls/{callId}`. Each call state is shown in words, using the wording from the old root `App.js`.

**Replacing the mock pins and the "Featured Perks" row:**

- **"Your offers".** A horizontal row of current deals offers from `GET /v1/deals/offers`: status `active`, not expired, and not past `stale_at`. Each carries its sample tag where it applies. Tapping one opens the offer detail (9.7).
- **Map pins.** Nearby OpenStreetMap stores whose brand matches a selected store (`GET /api/v1/stores`) or an offer's merchant. A pin shows the offer's headline or "Selected store". Stores with neither stay plain dots, as now.
- **The search box** filters the offers row and the store list by name.
- **The category chips** use the store categories already in the ledger and OpenStreetMap data, or are removed.
- **"Effortless Local Cashback"** is removed. Nothing backs that claim.

### 9.4 Spending tab (phase 2)

This merges the real `FinanceHistoryScreen` into the designed `SpendingScreen` layout.

- **Month total and daily average.** From ledger rows with `direction` `outflow`, in the owner's time zone. A month picker covers only months the ledger contains.
- **Category ring and bars.** From the ledger's `category` field (dining, coffee, groceries, fuel, retail, travel, electronics, other).
- **Budget progress.** Each budget from `GET /api/v1/budgets` shows spent against limit (`spentCents` / `limitCents`). This replaces the "On Target" pill and the "8.4% less" comparison, which have no source. A month-over-month comparison appears only when both months are fully inside the ledger.
- **Recent transactions.** The ledger, paged 100 at a time, loading more as the list scrolls. Each row carries its source tag. Rows with `screen_flags` say they are left out of baselines.
- **"View and edit budgets"** goes to the Budgets screen.

### 9.5 Upcoming tab (phase 2, plus phase 5 for text plans)

This merges `FinanceForecastScreen` into the designed `UpcomingScreen` layout.

- **Headline.** "Safe to spend" (`safeToSpendCents`), or "Needs a check" when it is `null`, with the reasons the forecast gives (missing sources, plans without amounts). Next to it: the forecast method and how recent it is.
- **Range chart.** A 30-day low/middle/high band from `bands.daily`, with the existing "experimental range" wording until the backtest result is accepted.
- **Day strip.** The next 14 days. A day gets a red dot when money goes out and a green dot when pay is expected.
- **Bills and plans.** The forecast's scheduled outflows: by name if phase 0 finds names, otherwise as daily totals. For the operator, also the text plans (`upcoming`), each with its quote and source ("from a friend", "from your email", "from you").
- **Needs a check (operator only).** Each pending plan, with the confirm and dismiss editor ported from `PlanRow` in the old root `App.js`. Its notes are kept: "Needs amount, date", and "not counted until it arrives" for money owed to you. Includes a "Check texts and email now" button (`POST /api/texts/sync`).
- **Expected pay.** Payroll estimates with cadence, plus money owed from text plans, all marked "not counted until it arrives".
- **Removed:** Auto-Pay, Pay Now, Schedule Payment.
- **Routines move to Account** (9.6). They describe habits, not cash flow.

### 9.6 Account tab (phases 2 and 5)

**Identity card.**
- First name, if the backend provides it.
- The matched account's last four digits (for Alex Taylor, "Sandbox account ending 6619"), if the backend returns them. Phase 0 checks this.
- The balance.
- A "Sandbox data" tag.

The invented card art, cardholder name, routing number and "PRO" badge go.

**Your money:**
- **Budgets →** (9.8).
- **Goals and cash reserve** (operator only, if phase 0 finds a way to read them; section 14).

**What we learned:**
- **Routines.** Each with its source tag ("Stated by you", "Sandbox bank data", "Synthetic demo history") and its evidence sentence.
- **Stores and signups →** (9.9).

**Connections.** One row per source, each with its state and a retry where one exists:
- Sandbox bank: last refresh time, and "Refresh now", which starts a run and shows its progress.
- Store email address: the address, a copy button, and source states from `GET /v1/deals/status`. Failed jobs get "Retry" (`POST /v1/deals/jobs/{id}/retry`).
- Texts and email plans (operator only): ingestion state from `GET /api/text-obligations`.

**Alerts and calls (operator only, phase 5):**
- **Channel.** Off, call or iMessage, from `GET`/`PUT /api/v1/settings`, with explicit consent and the version. Turning a channel on registers this phone (`POST /api/v1/devices`) and keeps its token in SecureStore. Turning it off removes the phone (`DELETE /api/v1/devices/{id}`). The logic is ported from `src/locationDelivery.js`.
- **"Alerts while locked".** Phase 6, custom build only. In Expo Go it says so instead of failing.

**Privacy:**
- **Turn off the store email address.** `DELETE /v1/deals/consent`, after a dialog saying what stops and what is kept. The dialog wording is in `services/deals/mobile/DealsScreen.tsx`.
- **Remove this phone from alerts.**
- **Sign out.** `DELETE /api/v1/session`, then clear SecureStore.

The invented items listed in section 6 are removed.

### 9.7 Offer detail (phase 4, new)

Ported from `services/deals/mobile/OfferReview.tsx` and the offer panel in `services/deals/mobile/DealsScreen.tsx`.

- **The terms:** what it applies to, where, minimum spend, membership and activation needs, stacking rule, payout timing and expiry. Each unknown value is shown as "Unknown", never guessed.
- **"Show the source"** opens the email the offer came from (`GET /v1/deals/messages/{id}`), with its quote.
- **"Correct these terms"** sends `POST /v1/deals/offers/{id}/review` with the revision, `senderVerified`, `evidenceConfirmed` and a note.
- **Sample offers** show the sample tag at the top, and cannot be marked reviewed.

### 9.8 Budgets (phase 2, built by the pipeline session)

Restyled with the shared components. Behavior stays:

- one row per category, showing limit, spent, and whether it was set automatically or by you;
- tapping a row shows the evidence in words;
- an edit sends `PUT /api/v1/budgets/{category}` with the version;
- "Use the automatic budget again" sends `DELETE /api/v1/budgets/{category}/user`.

A banner says budgets are enforced from the start and can be changed at any time.

### 9.9 Stores and signups (phases 2 and 4, built by the pipeline session)

Restyled. It gains the full signup flow from `services/deals/mobile/EnrollmentFlow.tsx` and the rewards tab of `services/deals/mobile/DealsScreen.tsx`.

**Stores:**
- Selected, seen-once and eligible stores, each with its reasons in words.
- A select or drop switch, sending `PUT /api/v1/stores/{brand}` with the version.

**Each enrollment's state in words:**
- "Simulated signup (demo)"
- "Needs you: open the signup page"
- "Waiting for the welcome email"
- "Enrolled (confirmed by email from …)"
- "No supported signup path"
- "Promotions stopped"

**Signup steps (assisted, for a real person):**
1. "Are you already a member?" (`/existing-membership`).
2. "Copy email".
3. "Open signup page", only for allowed merchant sites.
4. "I've submitted" (`/attempt`).
5. "Confirm with the welcome email" (`/confirm`).

**After signup:**
- "Stop promotions" (`/opt-out`), with the dialog explaining a later purchase does not override it.
- "Resume" (`/resume`).
- "I unsubscribed at the store" (`/confirm-unsubscribe`).

---

## 10. Features that need extra native modules or a custom build

Native modules are Expo packages with phone-side code. Expo Go, the ready-made test app, includes only a fixed set of them. A custom build (a development build) is the team's own compiled app, made with `npx expo run:ios` or EAS.

`app/AGENTS.md` says to check the Expo SDK 58 documentation before using any Expo API. Every row below needs that check before building.

| Feature | Module | In `app/` now | Works in Expo Go |
| --- | --- | --- | --- |
| Session storage | `expo-secure-store` | Yes *(uncommitted)* | Yes |
| Copy the store email address | `expo-clipboard` | Yes *(uncommitted)* | Yes |
| Local notification when a new recommendation appears with the app open | `expo-notifications` | No | To verify on SDK 58 |
| Random IDs for location reports | `expo-crypto` | No | To verify |
| Alerts while the phone is locked (geofencing: the phone wakes the app on entering a watched area) | `expo-location` + `expo-task-manager` | Location only | No; the old root app says so too |

Install modules with `npx expo install`, never `npm install`, so the versions match SDK 58.

---

## 11. Testing

### 11.1 Logic tests

Everything that turns backend data into what a screen shows goes in plain TypeScript modules with no React. For example:

- source value to label words;
- forecast to day strip;
- ledger to category totals;
- call state to words;
- enrollment state to words;
- "is this offer current?".

These are tested with the existing setup: `node --test` in `app/test/`, with `ts-resolve.mjs`.

### 11.2 Contract tests against the real server

The backend's own tests already start the real finance server on a free port with in-memory stand-ins (`serveProfile` with `FINANCE_PORT: '0'` in `test/deals-gateway.test.js` and `test/finance-call.test.js`).

The app's API modules get the same kind of test. They run against that real server and check request shapes, answers and error kinds, including:

- a 401 on an operator-only route does not clear the session;
- a 401 on an owner route does clear it;
- a 409 on a budget edit becomes `conflict`.

The pipeline routes need PostgreSQL. Phase 0 decides whether to use the pipeline session's test helpers (`test/helpers/`) or test those modules with recorded answers.

### 11.3 Type and lint checks

`npx tsc --noEmit` and `npx expo lint` in `app/`, at the end of every phase.

### 11.4 Checks only a person with a phone can run

1. Sign in with name and last four; onboarding finishes.
2. The Spending and Upcoming numbers match the backend's answers.
3. The "Best choice" card with live GPS and with the demo marker (INTEG-04).
4. A text plan confirmed on the phone changes the forecast.
5. One assisted signup step opens the right merchant page.
6. Turning the alert channel on registers the phone.
7. A call request reaches the opted-in phone.
8. In a custom build, entering a watched area while locked produces an alert.

The web preview cannot replace these until the cross-origin change in section 12 exists.

---

## 12. Small backend changes this plan asks for

Each one is Arjun's call. The app works without them, with the limits stated.

1. **`GET /api/v1/me`.** Returns the owner ID, first name, whether this owner is the operator, and which features are set up. Without it, the app finds out by probing (7.3).
2. **Operator-only routes answer 403, not 401, to a valid non-operator session.** Then even a mistaken call cannot look like an expired sign-in.
3. **Cross-origin headers in development only**, behind a setting such as `FINANCE_DEV_CORS_ORIGIN`. This lets the app run in a desktop browser for quick checks.
4. **Named upcoming bills in the forecast**, if phase 0 finds only daily totals.
5. **A read for goals and cash reserve under the pipeline**, if phase 0 finds none. The alternative is dropping that editor.

---

## 13. How this plan was made

**Read:**
- every file in `app/src/` and `app/test/`;
- `scripts/finance-profile.js` and the backend modules behind each route;
- `backend/pipeline-http.js` and the diffs to `scripts/finance-profile.js` and `backend/deals-gateway.js`;
- `services/deals/src/app.ts`, `contracts.ts` and the parts of `capital_one.ts` that store sample offers;
- the deals mobile app (`api.ts`, `App.tsx`, the loading and actions in `DealsScreen.tsx`);
- the old root `App.js` and `src/locationDelivery.js`;
- `context.md`, `spec-checklist.md`, `derived-data-pipeline-plan.md` and `backend-integration-plan.md`.

**Run:** only commands that read files, and git commands. Nothing was built, started or tested. Every statement above about how a route behaves comes from reading code, not from calling it.

**Moving parts:** the pipeline session's files were still changing while this was written. `pipeline-http.js` was reformatted between two reads. Phase 0 exists for that reason.

---

## 14. Decisions for Arjun

| # | Question | Default in this plan |
| --- | --- | --- |
| 1 | Use TanStack Query, or keep hand-written loading hooks? | TanStack Query (7.2) |
| 2 | Remove the controls that have no backend, or keep them greyed out with "Not connected"? | Remove (section 6) |
| 3 | Show operator-only features (text plans, alerts, calls, goals) to the operator in the app, or leave them out of `app/`? | Show to the operator only |
| 4 | Which of the five backend changes in section 12 to make | 1, 2 and 3 |
| 5 | Routines on Account or on Upcoming? | Account |
| 6 | After porting, what happens to the old apps (root `App.js`, `nessie-signin-prototype/`, `services/deals/mobile/`)? Checklist item INTEG-07. | Leave them; record that `app/` replaces them; deleting is your call |
| 7 | Keep the category chips on the Deals tab, using real store categories, or remove them? | Keep, with real categories |
