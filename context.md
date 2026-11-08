Exact data sources and sandbox usage; movement simulation is confirmed, other simulation is not authorized.

# HackUTD 2026 — Living Project Context

Status: clarification closed at the user’s request. Implementation has started: the optimizer is built on branch `arjun` (see section 15). Provider feasibility and most research gates remain unverified.

Status: the user authorized deals implementation on November 7, 2026. The deals API, worker, TigerData schema/roles and Expo screens are now implemented and tested locally. Live acceptance remains incomplete; see the latest implementation update in section 17 and [validation evidence](services/deals/docs/deals-validation.md). Earlier preparation-only statements below are historical. No commits or pushes are authorized.

This file is the cumulative specification for the project. User-confirmed requirements, proposed approaches, unresolved questions, and verified research must remain distinguishable. No implementation choice becomes a confirmed requirement merely because it appears here.

## 1. Working agreement

- Keep all project work inside `projects/hackutd-2026`.
- Do not commit or push anything yet.
- Clarify the project before implementing it.
- The later instruction “You’ve asked enough questions. You can finalize the spec” supersedes the original literal STOP condition. Ask no further clarification questions; implementation remains a later phase.
- Record every new answer or update in this file before asking the next clarification question. Preserve meaningful history and superseded decisions.
- Build a comprehensive context file that describes exactly what the project should be.
- Required provider documentation links will be supplied by the user. Use those resources for documentation and guidance when received.
- Research requests below are requirements for future specification work, not completed research or verified vendor capabilities.

## 2. Product vision

A mobile personal-finance application that recommends financially optimal purchasing choices based on nearby opportunities, available deals and rewards, the user's preferences and priorities, and their current and forecast financial circumstances.

The system should help users save money and maximize eligible deals, cashback, and reward points without ignoring upcoming obligations. Recommendations should be timely: when a user is near a relevant location, is expected to visit one soon, or could choose a better alternative within their constraints.

The principal outputs are push notifications and optional agent phone calls explaining how the user should spend money given their financial situation. The exact scope of in-app screens is unresolved.

## 3. Platform and development constraints

- Mobile app built with React Native.
- Expo Go is the current testing target.
- A Mac and Xcode are available.
- The team does not have the paid $99 Apple developer membership described in the initial brief.
- Expo compilation is a possibility raised by the user, not a verified distribution plan.
- Validate feasibility of background location, notifications, phone integration, and distribution against the chosen testing environment before making implementation commitments.
- Target operating systems, physical devices, release plans, deadline, and team capacity remain unresolved.

## 4. Required providers

| Area                          | User requirement | Verification still needed                                                          |
| ----------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| Database                      | TigerData        | Exact product, plan, extensions, hosting, security and operational capabilities    |
| Agentic workflows             | Nemotron         | Exact models, hosting, APIs, available credits, capabilities and constraints       |
| Texts, calls and email access | Photon           | Exact service, documentation, supported channels, account access and consent model |
| Financial data                | Nessie API       | Exact endpoints, data fidelity, sandbox versus real accounts and update behavior   |

The initial spoken brief used “Nimotron,” “NEMOtron,” “Neurotron,” and “Nemotron.” This document provisionally uses **Nemotron** for the intended provider; exact identity must be confirmed from the supplied link. No separate Neurotron product is assumed.

## 5. Inputs to financial recommendations

The user described five key inputs, with some overlap in the spoken enumeration. Preserve all of the following until their grouping is clarified:

1. Available deals, discounts, cashback offers and reward opportunities, including whether redemption is feasible.
2. Financial constraints: balances, budget, expected income, bills and upcoming obligations.
3. User priorities and financial goals.
4. User preferences and restrictions.
5. Geographic context: choices within the user's GPS bubble.

Current and forecast financial position must both matter. A recommendation that looks affordable from the present balance alone may be inappropriate once upcoming commitments are included.

### 5.1 Financial and social context

- Nessie supplies financial information, including transaction details when available.
- Relevant transaction attributes include merchant/place, location and time.
- Text conversations may contain commitments to other people that imply upcoming expenses.
- Context should include expected money receipts, income and bills.
- The app should infer relevant future obligations from conversational context rather than considering only posted transactions.
- Automatically incorporate text-derived obligations when sufficient detail supports accurate estimation. Otherwise request clarification through a push notification and let the user enter or confirm details in the app. Source mapping, horizon and reconciliation use the design defaults and verification gates below.

### 5.2 Geographic context

- Consider the user's GPS bubble when finding feasible alternatives.
- Trigger recommendations near locations with relevant deals.
- Proactively anticipate visits based on routine and spending patterns.
- Consider an alternative location if it is financially better under the user's constraints.
- Bubble size, travel modes, travel cost, detour tolerance, location sampling and background behavior remain unresolved.

## 6. Deal acquisition

### 6.1 Store promotional emails

- Use a burner email address to receive merchant offers.
- Sign that address up for deal notifications from stores the user frequents.
- The proposed signup workflow uses automation and Nemotron where needed.
- Photon retrieves promotional email information.
- Extract and store deals in TigerData for recommendation use.
- Resolve address ownership, per-user versus shared inboxes, merchant discovery, signup consent, verification steps, automation limits, unsubscribe behavior, ingestion frequency, expiration and deduplication.

### 6.1.1 Automatic rewards enrollment and inactivity lifecycle

- Automatically initiate rewards registration for merchants found in the user's transaction history, including purchases made before the user joined the app.
- After onboarding, a newly encountered merchant in transaction data should trigger its rewards signup process. Enrollment is ongoing, not limited to an onboarding batch.
- If the user does not return to an enrolled merchant for one year, unsubscribe or delete as appropriate to avoid retaining stale data. The user delegates selection of the appropriate cleanup method to the design process.
- Exact cleanup semantics remain open: unsubscribing from promotions, deleting an external loyalty account, deleting local enrollment records and removing stale offers are distinct operations. The answer does not yet choose among them.
- Define what counts as a return (transaction or other evidence), how the year is measured for historical purchases, and whether a later return restarts enrollment.
- Decide how to handle existing memberships, merchants without programs, identity requirements, verification challenges and repeated enrollment attempts.
- The user's wording confirms automatic rewards signup, but whether each signup means loyalty membership, promotional subscription, or both remains unresolved. Specific demo merchants are not yet selected.

### 6.2 Capital One offers

- Aggregate Capital One cashback offers, shopping deals and other relevant offers.
- The initial proposal includes web scraping and database storage.
- Acquisition must be free and must not require an exclusive Capital One partnership or other expenses.
- Research which offer sources are accessible, their access rules, account dependencies and redemption requirements.
- Do not assume a visible offer is redeemable by every user, or that all Capital One offer products share eligibility rules.
- Full aggregation feasibility and an acceptable fallback remain unresolved.

### 6.3 Offer normalization requirements to resolve

Determine the fields necessary to compare real purchase outcomes: merchant and branch, eligible products, prices, discount terms, cashback timing, reward valuation, exclusions, minimum spend, expiration, required payment method, account eligibility, activation and stacking rules. These are design questions, not a finalized schema.

## 7. Optimization engine

### 7.1 Confirmed principles

- Use a deterministic algorithm for logic that can be performed accurately by an algorithm.
- Do not outsource such calculations or decisions to an LLM unnecessarily.
- Use Nemotron for complex interpretation or decisions where agentic reasoning is justified.
- Rigorously research the relevant state of the art before selecting or developing the optimization approach.
- Weigh and substantiate the boundary between deterministic logic and Nemotron.
- Evaluate best price, cashback, reward opportunities, financial feasibility, preferences and geographic feasibility together.

### 7.2 Strict budgets and suitable alternatives

- Budgets are hard limits, not soft preferences. Do not recommend a purchase that violates the applicable budget.
- Before recommending skipping an unaffordable purchase, make an effort to find a cheaper alternative within budget.
- Validate that alternatives actually satisfy what the user is looking for. Avoid false positives: a lower price alone does not make an alternative suitable.
- If no suitable, affordable alternative exists, recommend skipping the purchase.
- This does not establish how users explicitly change their budgets; budget editing remains separate from silently overriding an active limit.
- Exact purchase-intent evidence, suitability criteria, verification methods and behavior under insufficient information remain to be specified. The user requires strong validation; an implementation must not claim certainty unsupported by available data.

### 7.3 Decisions still required

- What a “choice” represents: merchant, basket, product, payment method, purchase timing, or a combination.
- The objective function and priority order among cash savings, rewards, liquidity, preferences and travel effort.
- Hard constraints versus soft preferences for inputs other than budgets, which are confirmed hard limits.
- Forecast uncertainty, reserves, risk tolerance and handling missing data.
- Comparison baseline, explanation requirements and minimum benefit before interruption.
- How eligibility, conflicting offers and delayed cashback affect comparisons.
- Performance targets and evaluation datasets.

## 8. Nemotron responsibilities and agent harness

### 8.1 User-requested capabilities

- Maintain the user's memory, routine, preferences, financial goals and financial forecast.
- Interpret stated financial goals and constraints when they are not already explicit.
- Help determine constraints implied by financial data only where deterministic logic is insufficient.
- Interpret messages for upcoming obligations and relevant context.
- Infer routines from transactions, including where the user spends and when.
- Support merchant deal signup automation as appropriate.
- Update memory from conversations with the user during agent calls.

### 8.2 Harness design mandate

Design a harness that integrates Nemotron effectively across acquisition, interpretation, memory maintenance, routine modeling and recommendation delivery. The exact architecture has not been chosen.

Research and specify tool boundaries, structured outputs, validation, allowed actions, state transitions, scheduling, retries, provenance, confidence, conflict resolution, observability and evaluation. Determine which responsibilities belong to deterministic services versus the model. These are pending design work, not approved implementation choices.

### 8.3 Memory and routine modeling

- Store routines in an appropriate, efficient representation.
- Model typical purchasing and spending patterns, frequent merchants and likely visit times.
- Establish the initial routine from historical transactions during onboarding. Continue updating the routine and other user information from the user's actions after onboarding.
- Allow spoken updates to preferences, budgeting and broadly relevant user memory.
- Clarify the limits of “almost anything”: supported memory types, confirmation for consequential changes, retention, correction, deletion and overrides.
- Distinguish explicit user statements from inferred facts and uncertain predictions in the eventual design.

## 9. User interactions and recommendation delivery

### 9.1 Push notifications

- Deliver contextual recommendations to the phone.
- Support triggers from GPS proximity and anticipated visits.
- Explain the most suitable financial choice given deals and the user's circumstances.
- On the first contextually appropriate proximity encounter with a place, always serve a push notification. Proximity alone is insufficient: first verify that the opportunity makes sense given the user's routine and situation.
- User example: passing a coffee shop at 7:30 during a known commute to work is not an appropriate time to send that notification. Do not turn this example into a blanket prohibition on all morning coffee offers; the relevant constraint is contextual suitability.
- Include an option to select “never notify again for this place.” Treat this as an explicit place-level notification preference; exact place versus chain scope remains unresolved.
- If the user opens the notification, or later transaction history shows a purchase at that place, continue serving relevant notifications for it.
- Continued notification eligibility does not yet specify delivery frequency. Cooldowns and whether engagement expires remain unresolved.
- A verified purchase occurring after a place was muted may re-enable its notifications. An older purchase imported later does not count as a post-mute purchase. See section 14 for the ignored-notification default.
- Quiet hours, sensitive lock-screen content and the technical presentation of notification actions remain unresolved.

### 9.2 Optional agent calls

- Users can enable or disable calls.
- If the user answers, the agent explains the recommended financial choice.
- The user can discuss the recommendation and change memory, preferences or budget through the call.
- Clarify call transport, initiation rules, voice provider capabilities, interruptions, transcripts, recording, costs and failure handling.

### 9.3 In-app experience

User onboarding must be demonstrated and is conversational: Nemotron conducts the LLM conversation, and Photon facilitates the actual phone call.

The conversation gathers information that cannot be inferred reliably from data, particularly the user's budgeting intentions and financial goals. Historical transaction data supplies the initial routine. After onboarding, user actions update the routine and other information over time.

Exact questions, required answers, call initiation, account linking order, permission screens and recovery from interrupted calls remain unresolved. The initial requirement that recommendation calls are optional does not yet specify whether onboarding has a non-call alternative.

Offer browsing, recommendation explanations and memory review are also unresolved product decisions.

## 10. Privacy and security

The app handles sensitive financial information, location, messages, email, inferred routines and potentially voice interactions. The user requests rigorous investigation of the most secure practical solution.

No architecture can be asserted to be universally “the absolute most secure” without a threat model and operating constraints. The specification must define those constraints and justify its security choices with evidence.

Pending design topics include data minimization, consent, account isolation, authentication, authorization, encryption, key and secret management, provider access, retention and deletion, audit trails, backups, abuse prevention, prompt-injection defenses for external content, and protection of logs and notification content.

Whether hackathon testing uses synthetic data, real personal data, or a mixture must be explicitly established.

## 11. Research backlog

At specification finalization, research had not yet been performed. Subsequent deals research is recorded in section 16 and its linked plan; other research remains pending. Documented capabilities do not establish working account access or tested integrations.

1. Required provider identities, documentation, free tiers, credentials and integration capabilities.
2. Expo Go feasibility for the intended demo and background behavior.
3. State-of-the-art constrained, location-aware financial recommendation and offer optimization approaches.
4. Forecasting obligations and cash flow with uncertain conversational signals.
5. Evidence-backed division of deterministic calculation and Nemotron reasoning.
6. Agent harness architecture, memory design, routine modeling and evaluation.
7. Free, permitted, technically feasible Capital One offer acquisition and eligibility verification.
8. Merchant signup automation and promotional email normalization.
9. Threat model and justified security architecture for the actual project scope.

## 12. Demo scope and acceptance criteria

### 12.1 Confirmed demo modes

1. **Recorded demo with live movement:** an actual user moves between locations, and the app receives their real, live GPS data. Record this experience to demonstrate location-aware behavior.
2. **Stationary demo with simulated movement:** presenters cannot physically move around. Provide a way to drag the simulated user position to different locations and demonstrate the location-driven features.

Only the user's movement/location input is simulated in the stationary demo. The user explicitly distinguished simulating movement from simulating the underlying data. This is not permission to fabricate deals, financial inputs, messages, calls or recommendation results. Exact data provenance and provider sandbox usage still need clarification.

The location-control interface and where it runs (phone or separate presenter interface) are not yet decided.

### 12.2 Required feature demonstrations

- GPS location-based features, including the optimization algorithm; explain how the algorithm works during the demo.
- Calls through Photon.
- Financial forecasting using Photon to read **texts**. The user explicitly corrected “emails” to “texts” for this demonstration.
- User onboarding and its flow.
- Photon-enabled registration for different merchant rewards outside Capital One offers.

The correction about texts applies to the forecast demonstration; it does not remove promotional email ingestion as a deal source from the broader product vision.

The registration demonstration extends beyond simply displaying existing offers: show the process of signing up for non–Capital One rewards. Whether this means loyalty membership, promotional subscriptions, or both remains to be clarified.

### 12.3 Remaining scope decisions

The long-term vision and required demonstrations are documented above. The exact narrative, complete MVP boundary and implementation schedule remain unresolved.

Need to establish:

- Primary user and first compelling use case.
- Hackathon deadline and available development time.
- End-to-end demo flow and judging criteria.
- Must-have versus stretch features.
- Spending limits beyond the stated free Capital One acquisition constraint.
- Supported device and platform.
- Quantitative and qualitative success criteria.

## 13. Clarification log

### Update 001 — Initial vision, November 7, 2026

Captured the user's product vision, mandatory providers, React Native/Expo Go testing setup, two deal sources, financial forecasting from obligations, GPS and routine-based recommendations, deterministic-first optimization policy, Nemotron harness and memory requirements, optional phone calls, notifications and security expectations.

No implementation, commits or pushes authorized. Provider documentation links are pending.

### Round 1 — Pending questions

1. What exact end-to-end story should the hackathon demo show? Describe a user, their intended purchase, an upcoming obligation, and the recommendation the app should deliver.
2. When is the submission/demo deadline, and which features are essential for that demo versus acceptable as later work or simulations?
3. Provide the intended TigerData, Nemotron, Photon and Nessie documentation links when available, and identify which accounts or API access the team already has.

Answers: demo modes and required features answered in Update 002. Specific purchase narrative, deadline, provider links and account access remain pending.

### Update 002 — Demo modes and required features, November 7, 2026

The user specified two demos: a recorded demonstration with a person moving and real live GPS, and a stationary demonstration where the user's location can be dragged to simulate movement. They explicitly require simulating movement rather than the underlying data.

Required demonstrations: location-aware optimization with an explanation of the algorithm, Photon calls, financial forecasting from Photon reading texts (explicitly corrected from emails), onboarding, and Photon-enabled registration for non–Capital One rewards.

### Round 2 — Answered with remaining details open

1. During onboarding, what should users explicitly provide, and what should the system infer? In particular: financial goals/budget, merchant and food preferences, usual locations, and access to financial accounts and texts.
2. For non–Capital One rewards, should registration create actual store loyalty accounts, subscribe the burner email to promotional offers, or both? Which merchants should the demo cover?

Answers: captured in Update 003. Specific merchant selection and the precise distinction between loyalty membership and promotional subscription remain open.

### Update 003 — Conversational onboarding and rewards lifecycle, November 7, 2026

The user specified onboarding by actual phone call facilitated by Photon, with Nemotron conducting the conversation. Extract budgeting and personal financial goals that cannot be inferred from data. Infer the initial routine from historical transactions; subsequently update routines and other information based on user actions.

Automatically initiate rewards registration for merchants in historical transactions, including transactions predating app use, and for new merchants encountered in subsequent transactions. After one year without returning to a merchant, unsubscribe or delete as appropriate to avoid stale data. Exact cleanup behavior is delegated for design, with its scope still to be established.

### Round 3 — Answered with remaining details open

1. What should trigger a recommendation: proximity alone, a predicted routine visit, explicit purchase intent, or a combination? How should the app determine what the user is shopping for before comparing alternatives?
2. When the financial forecast indicates an upcoming shortfall, should the app recommend skipping or postponing a purchase, or only find the cheapest eligible alternative? Should stated budgets be hard limits or allow user overrides?

Answers: captured in Update 004. Purchase-intent validation details and notification lifecycle edge cases remain open.

### Update 004 — Notification relevance and hard budget limits, November 7, 2026

The first proximity encounter that is verified as contextually appropriate should always produce a push notification. A known commute past a coffee shop at 7:30 is an example of an inappropriate interruption. Notifications must offer “never notify again for this place.” Opening a notification or a subsequent transaction at the place supports continued notifications.

Budgets are strict limits. Seek a cheaper alternative before recommending skipping. Validate that alternatives genuinely match the user's intended purchase and avoid false positives. If no suitable alternative fits the budget, recommend skipping.

### Round 4 — Answered; clarification closed

1. If a user ignores the first notification and never purchases there, should the app stop notifying for that place, or try again later? Should “never notify again” stay in force even if a later purchase occurs?
2. How should an upcoming expense inferred from texts enter the forecast: automatically when sufficiently clear, or only after user confirmation? For vague messages without an amount or date, should the agent ask, estimate, or leave them out until clarified?

Answers: captured in Update 005. No further questions are pending for the user.

### Update 005 — Final decisions and close of clarification

A new transaction after the user selected “never notify again” may reactivate notifications for that place. Automatically update the forecast from texts when enough detail supports accurate estimation. If clarification is necessary, send a push notification and allow input or confirmation in the app.

The user requested finalization with accurately scoped checkboxes and explicitly ended questioning. This supersedes the original literal STOP instruction. No implementation, commits or pushes are authorized.

## 14. Consolidated design and implementation defaults

### Authority and readiness

Sections 1–13 preserve user requirements and discovery history. This section supplies explicit design defaults for previously unresolved details; they are not additional claims attributed to the user. The separate [spec-checklist.md](spec-checklist.md) is the authoritative delivery checklist. Earlier unanswered questions are historical, not requests to continue interviewing.

This is a finalized product specification and delivery plan, not proof that the required providers support every feature. Official provider links, credentials, Photon identity/capabilities, Expo deployment feasibility and algorithm/security research remain unverified. Complete the corresponding gates before dependent implementation. Do not silently replace required integrations or claim universally optimal security, state-of-the-art performance or comprehensive offer coverage.

### Architecture and responsibility boundaries

Default architecture: React Native client, authenticated server-side application layer, TigerData persistence and asynchronous jobs. Keep provider secrets and agent tool execution on the server. Select exact runtime, queue, hosting and database features after capability verification.

Pipeline: provider event → authenticated ingestion → deduplication and normalization → agent interpretation where needed → validated facts/memory → deterministic forecast → candidate retrieval → hard filtering → ranking → relevance/notification policy → push or opted-in call.

Deterministic services own monetary arithmetic, budget windows, deduplication, forecast projection, geographic filtering, offer eligibility, expiration, stacking, ranking, notification state, scheduling and authorization. Nemotron interprets conversations, goals, ambiguous routines, unstructured obligations and offer terms; it proposes structured memory changes and explains validated results. Validators enforce schemas, evidence, ownership and constraints before persisting any proposed change. Third-party text is data, never authority to invoke tools.

Compute merchant/time frequencies deterministically. Use Nemotron only when interpreting those patterns benefits from context. Research must substantiate this division before locking the implementation.

### Recommendation and forecast semantics

A candidate is an intended purchase at a merchant/location with supported price information, eligible offers and payment conditions. Alternatives must match the actual need, restrictions and feasible travel. Missing critical suitability evidence means unverified; low price alone is insufficient.

Filter against hard budgets and forecast liquidity before ranking. Proposed baseline ranking: lowest verified effective cost, then preference fit, then travel effort. Research must compare suitable approaches before selecting the final objective. Immediate payable cost must fit available funds; delayed cashback cannot fund today's purchase. Do not invent cash values for points; show unvalued points separately.

If the intended purchase is unaffordable, seek verified suitable cheaper alternatives before recommending skipping. When data is incomplete, explain that no affordable alternative was verified rather than asserting universal absence.

Use integer minor-unit money with currency. Each budget has scope, period, timezone, amount and version. Ask for missing periods during onboarding rather than assuming daily or monthly. Explicit user edits create a new budget version; recommendations cannot override an active limit.

Default forecast horizon: configurable 30 days, shown in the app. Store obligations with evidence, amount/date bounds, status and source reference. Use supported conservative bounds for uncertain amounts. Automatically include sufficiently evidenced obligations; otherwise create a pending clarification and push deep link to an editor. Pending uncertainty must not be treated as zero-cost proof of affordability. User input triggers recomputation. Reconcile expected obligations with posted transactions to prevent double counting.

### Notification lifecycle

Default place scope is a verified merchant branch; chain-wide preferences are separate. Ambiguous transaction-to-place matches cannot reactivate the wrong branch.

| State/event                                              | Required behavior                                           |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| First verified appropriate proximity encounter           | Deliver first notification, subject to global permission    |
| Known inappropriate context, such as the commute example | Suppress; first eligible opportunity remains available      |
| First notification ignored                               | Default: no repeat until opening or a subsequent purchase   |
| Notification opened                                      | Eligible for future contextually relevant notifications     |
| Never notify again selected                              | Mute place and record event timestamp                       |
| Verified purchase occurred after mute                    | Re-enable eligibility; retry only in an appropriate context |
| Old transaction imported after mute                      | Remain muted                                                |
| Global notifications disabled                            | Suppress regardless of place eligibility                    |

Default repeat cooldown: one recommendation per place per 24 hours, configurable. GPS jitter within a visit must not create duplicate encounters. Explain alongside the requested “never notify again” control that a later purchase can reactivate suggestions. Reactivation never overrides global settings. Separate provider delivery, opening, mute and purchase events.

### Onboarding, calls and app screens

Default flow: introduction/consent → connect financial and messaging sources → import history → user starts Photon call → Nemotron gathers goals, budgets and non-inferable preferences → review/correct extracted settings → activate recommendations. Resume interrupted sessions without losing verified facts.

Recommendation calls are off until enabled; starting the onboarding call is separate consent. During calls, allow typed updates to budgets, preferences, goals, routines and obligations. Read back consequential financial changes and capture confirmation. Bind calls to authenticated users; speech alone cannot authorize another user's data access.

Required screens: onboarding and connection status; home/forecast and pending clarifications; recommendation detail; clarification editor; budgets/preferences/memory review; enrollment status; notification/call/privacy settings; restricted demo map.

### Rewards and inactivity defaults

Use a per-user promotional identity where supported. Historical and new merchants trigger an idempotent user/program enrollment process. Support the merchant's actual rewards enrollment and promotional subscriptions as applicable; record which succeeded. Existing memberships, unsupported programs and verification challenges are explicit states. Do not bypass CAPTCHA or fabricate identity data.

Default enrollment states: discovered, queued, in progress, needs user input, enrolled, unsupported, retryable failure, inactive, unsubscribe pending, unsubscribed.

Measure one calendar year of inactivity from the later of enrollment activation and last verified purchase, in the user's timezone. This gives newly enrolled historical merchants a year. At expiry, unsubscribe promotions, disable ingestion and remove unnecessary stale local offers. Preserve loyalty accounts and earned rewards by default; external account deletion is separate explicit user action. Retain minimal lifecycle metadata to prevent duplicate work. A later purchase restarts the appropriate enrollment/ingestion flow. Verify actual provider unsubscribe support.

### Data contracts

| Entity                     | Minimum fields                                                              |
| -------------------------- | --------------------------------------------------------------------------- |
| User/consent               | Owner ID, timezone, consent timestamps, channel settings                    |
| Connection                 | Owner, provider, secret reference, scopes, sync status                      |
| Transaction                | Provider ID, owner, amount/currency, occurred/posted time, merchant/place   |
| Place                      | Canonical merchant/branch, aliases, coordinates, provenance                 |
| Offer                      | Source, terms, price basis, eligibility, expiry, stacking, freshness        |
| Enrollment                 | Owner/program, state, activation, last purchase, cleanup/retry metadata     |
| Budget/goal                | Owner, scope, amount/currency, period, effective version                    |
| Obligation                 | Owner, evidence, amount/date bounds, status, reconciliation link            |
| Memory/routine             | Typed fact, owner, provenance, confidence, version, validity                |
| Location                   | Owner, coordinates, accuracy, timestamp, live/demo source                   |
| Forecast                   | Owner, horizon, input versions, dated balances/ranges, uncertainty          |
| Recommendation             | Owner, candidate evidence, costs, rejection reasons, input versions, expiry |
| Delivery/clarification/job | Owner, event/provider IDs, state, timestamps, idempotency key, resolution   |

Choose physical schema and indexes after TigerData verification. Minimize raw message/location retention and document justified retention windows.

### Demo and failure behavior

Provide a restricted draggable map marker as the stationary demo default. Live GPS and simulated movement emit the same event contract and use the same downstream pipeline. Label the active source and prevent accidental mixing. Never substitute canned offers, financial inputs, messages, calls or recommendation results. Disclose provider sandbox data accurately.

Outages must expose degraded status rather than fabricated success. Retry side effects idempotently, reconcile uncertain results before repeating actions, and invalidate recommendations when material inputs change or expire.

### Security baseline

Use authenticated ownership checks on every API, job and tool. Keep secrets out of mobile bundles and logs. Verify encryption in transit, database/provider storage protection and key handling. Scope tokens minimally and support revocation. Enforce allowlisted agent tools with typed arguments; external content cannot grant permissions. Redact lock-screen previews and logs. Record minimal audit metadata for sensitive changes. Implement consent withdrawal, retention and deletion with explicit provider limitations. Threat-model and evaluate these controls before describing the system as secure.

## 15. Implementation status

Last updated: 2026-11-08. Owner: Arjun. Branch: `arjun` in this repo, draft pull request #2. This section replaces the earlier `optimizer/STATUS.md`. Ticked boxes in [spec-checklist.md](spec-checklist.md) name the test that is their evidence.

### Working on now

Nothing in progress. The optimizer runs end to end against the team's live Nemotron (see "Live Nemotron results" below). Next steps depend on the open questions at the end of this section.

### Live Nemotron results (2026-11-08)

The live tests ran **on the Brev machine itself**, so no tunnel was needed:
- Machine: `following-copper-silkworm`, NVIDIA L40S 48 GB.
- Model: Tom's vLLM 0.31.0 container `nemotron`, serving `nemotron-bolt` (Nemotron 3.5 Bolt E4B, about 4 billion parameters) at `http://127.0.0.1:8000/v1`, with an 8,192-token limit.
- Checkout: a copy of this branch in `~/hackutd-arjun` on the box.
- Access: over SSH as `shadeform`. Arjun's laptop key (`arjun-hackutd-brev`) was added to `~/.ssh/authorized_keys` on the box. Remove that line to revoke it.

To rerun the live tests, run this on the box:

```bash
cd ~/hackutd-arjun/optimizer
NEMOTRON_BASE_URL=http://127.0.0.1:8000/v1 uv run pytest tests/test_live_nemotron.py -v -s
```

**What passed.** All 3 live tests pass, and two consecutive runs gave the same results:

| Test | What it shows | Time |
| --- | --- | --- |
| `test_live_compile_extracts_quoted_budget` | Bolt reads the profile text into a $60/week lunch budget, a peanut allergy and a commute entry, each with a quote that code checked. | about 11 s |
| `test_live_judge_rejects_cookie_for_lunch` | It rejects a cookie as lunch and accepts a vegetable wrap. The time includes a fresh profile compile. | about 17 s |
| `test_live_pipeline_end_to_end` | Routine to judge to optimizer to explanation. It recommends black bean tacos over the usual burrito bowl, and the explanation's dollar figures match the optimizer's: "Save $3.68 at Taco Shop! Get tacos veg for $8.82, saving $3.68 vs Chipotle's $12.50. You have $60.00 remaining in your budget." | about 16 s |

**What the live runs found and fixed.**
- **Context limit.** The profile compile asked for 10,240 output tokens, more than Bolt's 8,192-token limit, and vLLM rejected it. The client now reads the server's limit and fits every request inside it (`fit_tokens` in `nemotron/client.py`).
- **Thinking off for Bolt.** Thinking (step-by-step reasoning) is now off by default for Bolt. On a 5-item suitability check, run twice each way:
  - thinking on took about 20 s and hedged with "unverified" on a cookie and a latte
  - thinking off took 4.7 s and judged all five items correctly

  The setting `NEMOTRON_THINKING=on|off` overrides this. Bigger models keep thinking on until they are measured.
- **Judge too literal.** It was answering "is this a burrito bowl at Chipotle?" instead of "is this a lunch?". It now receives the kind of purchase, and the usual item only as context.
- **Single amounts.** An expense with one stated amount, such as "Rent $1,200", lost its amount, which made affordability unknown. One stated amount is now used as both the low and the high estimate.

### Done: the recommendation optimizer (`optimizer/`, Python)

- Decision logic is plain code with no model calls:
  - distance and the search-radius filter
  - budgets counted in the user's time zone
  - offer eligibility
  - choice of card and offers by a constraint solver (OR-Tools CP-SAT)
  - ranking
  - the recommend / skip / not-enough-data decision
  - expiry when inputs change
- Nemotron does four jobs, and code checks each reply before it is used:
  - turning the routine and financial-profile files into rules
  - guessing intent when the routine has no match
  - judging whether a cheaper item meets the same need
  - writing the notification text
- Defaults point at the team's model: `nemotron-bolt` at `http://127.0.0.1:8000/v1`. That address answers on the Brev machine itself, or on a laptop through `brev port-forward`.
- 77 offline tests pass. The 3 live-model tests skip unless `NEMOTRON_BASE_URL` is set, and they pass on the Brev machine.

### How optimality is tested

- **Brute-force reference.** `optimizer/tests/oracle.py` is a second implementation of the whole recommendation. It shares no code with the optimizer and tries every card with every subset of offers for every item.
  - On random worlds, the optimizer's full ranked list must equal the reference's exactly.
  - The random worlds include budgets, transactions across the November daylight-saving change, offers with every rule, several cards, judgements, preferences and restrictions.
- **Rule audit.** Every ranked option is re-checked against every hard rule, and every candidate must be either ranked or rejected with a reason.
- **Metamorphic tests.** These change the input in ways whose effect is known in advance:
  - shuffling the input never changes the answer
  - more money never gives a worse answer
  - an extra offer never raises the cost
  - unverified offers change nothing
  - irrelevant items change nothing
  - removing the winner promotes the runner-up
- **Long run.** A run at 3,000 random worlds per test passed every oracle, audit and metamorphic test on 2026-11-08. It took 15 minutes.
- **Coverage guard.** A deterministic test (it draws the same worlds every run) fails if the random worlds stop reaching recommendations, skips, applied and stacked offers, card switches, and every kind of rejection. Without it, the tests above could pass while testing nothing. Before this guard was added, 314 of 400 random worlds stopped at an early refusal.
- **Bug found and fixed.** When instant discounts add up to more than the price, the solver used to forbid the combination instead of charging $0.

### Not verified yet

- **Small test set.** The live tests use a handful of synthetic items. Bolt's accuracy on real menus and real profile files has not been measured.
- **Speed.** A live recommendation takes about 15 seconds, most of it the profile compile, which is cached between runs in normal use. Per-request latency without the compile has not been measured. The phone agent's budget is about 1.5 s.
- **Structured output.** It is not confirmed whether vLLM enforced the JSON reply format, or whether the client fell back to describing the format in the prompt. Either way, replies are validated.
- **Laptop access.** The `brev port-forward` route from a laptop has not been tested. Brev is not signed in on Arjun's laptop.
- **`optimizer/serve/brev-vllm.sh` is unused.** It was written before the team VM existed, and the team serves the model differently.

### Open questions for the team

- **How the Node backend calls the optimizer.** The backend is Node and the optimizer is Python. One option is a small HTTP endpoint that the backend calls. This is not decided.
- **Line 10 of this file looks stale.** It says "Do not commit or push anything yet", but progress is now pushed to a fork and a draft pull request at Arjun's request. Line 10 has been left unchanged until the team decides.
- **Assumptions the spec does not settle.** These are listed in `optimizer/README.md`:
  - whether a percentage discount applies before or after other discounts
  - what the baseline for "savings" is
  - the default search radius
- **Waiting on the partner's real profile files.** `profile/initial-routine.md` and `profile/financial-profile.md` are placeholders.

## 16. Deals planning and research update — November 7, 2026

The user requested a deals implementation plan covering Photon promotional email and Capital One offers, including scope and research. The plan is [plan/deals.md](services/deals/plan/deals.md); it preserves the checklist as the delivery ledger and distinguishes documented capabilities, proposed design and untested dependencies.

The user supplied [Hackathon Guidelines for Photon 2.0](https://somethingreat.notion.site/Hackathon-Guidelines-for-Photon-2-0-3f8e443f36bb81f9893fed0d08a4c01d), identifying the intended Photon product as Photon 2.0 beta at photon.codes. The guide and linked official beta documentation were read. Domain-based email ingestion and signed webhooks are documented; actual project access, DNS setup, funding and inbound tests remain pending. The guide describes free beta use, while current standard billing documents usage charges; verify the team's event entitlement before enabling usage. Other providers' exact configurations remain unverified.

Capital One Offers and Capital One Shopping must be modeled separately. Research found account-specific eligibility and acquisition restrictions; no permitted free bulk acquisition route was verified. The plan records the source evidence, a gated integration path and an explicitly incomplete unavailable/link-out fallback. This does not cancel the aggregation requirement or authorize fabricated demo offers.

Merchant registration, offer extraction, lifecycle cleanup, ownership isolation and optimizer handoff are included in the deals plan. No application implementation, external registration, provider configuration, commit or push was performed; delivery checkboxes remain unchanged.

### Dependency follow-up — November 7, 2026

The user reports TigerData and Photon are already created and requests using their CLIs. Backend conventions are delegated to the implementation agent. The user authorizes search, scraping or other acquisition work to produce structured Capital One offers; finding that route is implementation work rather than a dependency to hand back to the user. This does not establish account-specific redemption eligibility or guarantee comprehensive accessible coverage.

The user provided a Nessie key (not recorded here) and [Nessie v2 documentation](https://v2.nessieisreal.com/docs#description/nessie-v2.). Its OpenAPI version is 2.1.1 and explicitly describes a mock banking API. A read-only authentication check succeeded but returned no accounts. Dataset creation and the intended demo customer remain unresolved; no mock data was generated during verification.

Tiger CLI can list the READY DEV service `nessessential-db`, but a read-only SQL check failed because the stored database password is missing/invalid. Photon CLI is logged into the stable production backend and lists no projects there; its beta backend is not authenticated. These are access/setup gaps despite the accounts having been created, not reasons to create duplicate resources. Details and recovery steps are in [plan/deals.md, section 10](services/deals/plan/deals.md#10-dependency-update-and-cli-verification--november-7-2026).

Selected backend conventions: Node.js 24+, TypeScript, Fastify, PostgreSQL via `pg`, SQL migrations, and a PostgreSQL-backed jobs/outbox table with an API and worker in one repository. Nemotron access remains outstanding. The user asked whether a Gmail burner can replace a domain: a domain/subdomain with DNS control is required for Photon's documented native email route; Gmail API ingestion is a possible separate integration and has not been selected as a replacement.

### Dependency refinement — November 7, 2026

The user supplied a Photon beta project API key (not recorded in repository files) and offered the Cloudflare-managed domain `getcompfy.com`. Plan to use an unused `deals.getcompfy.com` subdomain for Photon email. The exact DNS records must first be generated through the correct Photon project, then added in Cloudflare; no domain purchase or Gmail account is necessary. The project ID remains missing, and project-scoped API keys cannot perform account-level project discovery under the published API contract.

Nemotron is deferred until unstructured offer interpretation is implemented. Deterministic merchant-template parsing, ingestion, persistence, Capital One normalization and lifecycle work can start without it. The user explicitly permits generating fake Nessie data for testing; an empty tenant is therefore not an implementation blocker. Test records must remain labeled and isolated from external merchant registration. This authorization does not change the requirement to avoid presenting fabricated offers or transactions as real demo data.

A repeated read-only TigerData check against service ID `ylg4ko70w8` still fails SQL password authentication. The service now appears as `nessential-db`. CLI cloud authentication works; it is distinct from the SQL credential. No password reset has been performed, since resetting the master credential changes access for other clients. The exact proposed reset target and alternative local credential repair are documented in plan/deals.md.

### Authorized setup and Brev verification — November 7, 2026

The user subsequently authorized resetting TigerData and requested SSH troubleshooting for `brev shell following-copper-silkworm --org rishi.sandrana-4a543b-ipod`. Tiger CLI successfully generated/saved a replacement master password for service `ylg4ko70w8`; a read-only SQL check then returned `connection_ok = 1`. This resolves the preceding credential blocker. The credential is not recorded in project documents. Existing clients using the old master password must update it; no database data/schema was changed.

Brev reports instance `deokpaysz` healthy and running. Both a non-interactive remote command and the exact interactive shell command succeeded. The remote machine reported NVIDIA L40S with 46068 MiB memory. The original SSH failure could not be reproduced; no instance restart/reset or model deployment was needed or performed. Compute access is verified, but an inference endpoint has not been established.

Photon's project ID is still needed from the existing beta project's Settings. Detailed dashboard and Cloudflare DNS steps are in [plan/deals.md, section 11](services/deals/plan/deals.md#11-setup-results-and-operator-steps--november-7-2026). Exact domain-specific DNS values require first connecting `deals.getcompfy.com` to the correct Photon project. Those DNS changes remain pending. Nemotron and pre-existing Nessie test data are not prerequisites for initial deals implementation.

### Photon project verified and domain setup initiated — November 7, 2026

The user supplied project ID `pho_prj_01m6wh04gseh78gcs73agt2kj6`. Its beta API returned project name `Nessiessential`, and the provided key successfully read platform resources/operations. The agent initiated `deals.getcompfy.com` provisioning with the user's authorization; Photon accepted the request and returned operation `pho_opr_01m6wm910dfvk94fa4jh8gv7b9`. This resolves the project-access dependency. Domain setup is still running and has not yet returned DNS records or proven email reception. The user will apply the generated DNS records in Cloudflare. No Cloudflare change or email send has occurred; recovery details are recorded in [plan/deals.md, section 12](services/deals/plan/deals.md#12-photon-domain-provisioning--november-7-2026).


### Deals readiness audit — November 7, 2026, approximately 10:11 PM CST

The user reports adding the Photon DNS records and requests preparation only, with no implementation. All six records for `deals.getcompfy.com` match the values returned by Photon on public resolver 1.1.1.1 and both Cloudflare authoritative nameservers. No additional Cloudflare edits are indicated. Photon still reports the existing provisioning operation as running; its latest recorded check at 04:12:26 UTC confirms DKIM and identity readiness but still reports DNS and MAIL FROM readiness false. Its per-record status still labels five entries missing despite authoritative/public matches. Verification has progressed; public DNS correctness does not yet prove completed Photon provisioning or real email delivery.

Fresh read-only TigerData checks succeed as `tsdbadmin`, confirm schema-creation privilege and find zero public base tables. Local Node.js is v24.12.0. Photon email-list/count and webhook-destination reads succeed; zero messages/destinations were observed. The selectable preview webhook version is `2026-07-01`, with readable `message.received` schema and reported contracts package `0.30.0`. No receiver, webhook secret, migration or real-message test exists yet.

Photon billing reads return HTTP 403 with the supplied key. The remaining immediate user action is to confirm email entitlement and usable credits/hackathon allowance in the selected project's dashboard (including organization billing if applicable). No new secret or payment change is requested. Provider domain verification is still pending. Capital One acquisition and real merchant flows remain early implementation-owned feasibility gates; no structured Capital One dataset has been verified. Real signup may later need an authorized tester's identity/verification, and private account offers may need an eligible authorized session.

The detailed current readiness matrix and actual DNS records are in [plan/deals.md, section 13](services/deals/plan/deals.md#13-current-readiness-audit--november-7-2026-approximately-1011-pm-cst), superseding earlier setup unknowns. Initial development can start with current access once authorized; a complete email/demo integration cannot yet be claimed. Nemotron and pre-existing Nessie data remain unnecessary for the initial slice. This audit changed documentation only; no implementation, provider mutation, seed, email send, merchant registration, commit or push was performed.

### Session handoff and local credential persistence — November 7, 2026

At the user's request, [plan/deals.md, section 14](services/deals/plan/deals.md#14-new-session-handoff-cli-access-secrets-and-ssh) now records CLI versions/commands, resource IDs, API endpoints, Brev organization/instance/SSH access, known provider caveats and a resume checklist. Supplied Photon and Nessie keys are stored locally in `.env.deals.local` with owner-only permissions (`0600`) and an explicit `.gitignore` exclusion. Secret values are absent from project documentation. TigerData and Brev continue using their existing CLI-managed credential stores; no database password or SSH private key was copied into the repo. These local credentials survive a new session on this workspace but do not accompany a fresh clone. This adds configuration/handoff documentation only; application implementation remains unauthorized, and no commit or push was made.

## 17. Deals implementation update — November 7, 2026

The user's `/goal` instruction authorizes implementing and validating `plan/deals.md`, superseding historical preparation-only restrictions. No commit/push was authorized or performed. Existing unrelated document changes were preserved.

Implemented the Node 24/TypeScript/Fastify deals backend, PostgreSQL jobs/outbox worker, exact validated contracts, short-lived owner/scoped JWTs and tenant RLS; applied `001_deals.sql` to the existing TigerData service and created separate restricted API/worker roles. Generated runtime credentials and the signing key are stored only in ignored `.env.deals.runtime.local` with mode 0600, alongside the separate existing provider secret file. Administrative credentials remain CLI-managed.

Implemented signed Photon email ingress pinned to the official `2026-07-01` email schema; actual delivery-recipient routing; atomic replay/job handling; safe HTML/text extraction; paginated reconciliation with overlap/checkpoints; deterministic offer proposals and optional schema-constrained Nemotron interpretation; review/evidence/revision handling; private candidate eligibility and change events; idempotent verified-purchase discovery; candidate assisted merchant handoffs; inactivity suppression/return, explicit opt-out and consent withdrawal; retention and failed-job recovery. Sandbox observations cannot create external registrations. Unknown conditions remain review/unknown; the optimizer still owns pricing, affordability and geographic suitability.

Added a standalone Expo deals shell with SecureStore session handling, explicit consent, source/enrollment status, merchant verification, offer terms/evidence review, retry/resume/opt-out and local-content deletion controls. This is not the whole finance/mobile product. Actual website signup, OTP/CAPTCHA and external unsubscribe outcomes have not been observed; assisted handoffs are not completed registrations.

Validation: 22 domain and 20 PostgreSQL/API integration scenarios pass, along with backend/mobile typechecking, production build, iOS/Android Hermes exports and dependency audits with zero reported vulnerabilities. Live TigerData probes confirmed verified TLS, scoped reads and denied DDL; no synthetic deals or purchases were retained there. The local API `/health` and `/ready` returned successful readiness. Browser UI access was unavailable; no physical Expo Go acceptance or actual-data demo is claimed.

Photon's existing domain provisioning operation has now **succeeded**, with DKIM/DNS/identity/MAIL FROM all true (provider check `2026-11-08T04:39:01.736Z`, November 7 at 10:39 PM CST). One domain resource and zero messages were observed. Billing remains HTTP 403 with this key; email entitlement/credits still need an operator dashboard confirmation. No email was sent and no real merchant was registered.

Automatic approval review rejected starting the proposed temporary Cloudflare HTTPS tunnel: it would forward the local authenticated API and potentially private email/webhook data through an external service without explicit authorization for that payload/destination. No tunnel was started, no webhook destination was created and no signing secret exists. Do not bypass this rejection. Public webhook testing requires explicit approval; polling is implemented independently but live usage remains gated on confirmed entitlement.

Capital One Offers and Shopping remain separate blocked sources with zero acquired offers and zero acquisition spending. Fresh official terms/access research did not produce a permitted free collection/reuse route or eligible authorized session. REWARD-05 remains unmet; link-outs do not replace aggregation. No Nemotron server was deployed or validated; its proposal adapter is optional until real unstructured samples require it.

The concrete setup/API/retention runbook is [docs/deals-runbook.md](services/deals/docs/deals-runbook.md). [docs/deals-validation.md](services/deals/docs/deals-validation.md) maps every D-01–D-12 step to evidence and remaining gates. These supersede older readiness snapshots; the original required real-data acceptance remains open where documented.

### Live transport and Nemotron continuation — November 7, 2026, approximately 11:15 PM CST

The user explicitly approved the Cloudflare tunnel as long as it costs no money and asked how to confirm email funding. Cloudflare Quick Tunnels are free/accountless; no new Cloudflare API key, paid subscription or domain was needed. The initial approval-review rejection is resolved by this explicit payload/destination authorization. The free tunnel is connected, one Photon `message.received` destination was created at API version `2026-07-01`, and its signing secret/ID/current URL are saved atomically in ignored owner-only runtime configuration. The setup script can update that same destination when a free tunnel hostname changes, preserving its secret and avoiding duplicates. Public health/authentication/tamper/valid-signature checks all pass with synthetic unallocated-recipient requests; this does not claim actual Photon email receipt. Photon still lists zero messages.

Funding is Photon-side, not Cloudflare-side. The user does not yet know the project's allowance. They were directed to Photon Beta → Nessiessential → Billing, checking the project plan, remaining included emails, organization credit and any hackathon allowance. Standard Beta Free has no included emails and lists $0.001 per email; a Free label alone does not verify zero out-of-pocket use. No payment method, plan upgrade, funding assumption or billable email action was taken. The existing key still receives 403 for billing, so operator confirmation remains necessary; no replacement API key is requested just to report that status.

A fresh Brev audit using the installed Brev CLI skill discovered an already-running private model container (`nemotron`, vLLM 0.31.0, alias `nemotron-bolt`, root `nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16`, 8192 context). It was reused without installing/restarting/stopping it or creating instances. A loopback-only SSH forward supplies the backend's configured model URL. This is separate from public webhook exposure and does not expose the model publicly.

Live synthetic tests found and fixed two actual bugs: the model server rejected dynamic evidence-record grammar, and a leading word-boundary prevented standalone dollar-off messages from being classified as offers. The model now selects exact quotes/conditions through a flat schema; deterministic code computes amounts, explicit benefit formulas, dates and unique UTF-16 spans. Substantive unmatched/ambiguous quotes, unsupported currency, truncated/malformed output and unexpected tools fail explicitly. Missing-value markers remain unknown; source date-only expiry is not invented.

All four live-model synthetic cases passed (percent/conditions, receipt rejection, date-only dollar-off and prompt injection), with observed response times 228–3941 ms; `docs/deals-nemotron-evaluation.json` labels them synthetic and not real promotion evidence. Software checks now pass 33 unit/model tests and 20 PostgreSQL/API integration tests. The API and worker are running with the verified private model configuration and signed webhook secret. Real merchant enrollment, actual two-owner email receipt, Capital One acquisition and physical/shared-app acceptance remain open. No real emails, registrations, commits or pushes occurred in this continuation.

### Goal completion audit and blocked handoff

After three consecutive goal turns with the same live-data/entitlement gate, a fresh provider check still returns billing 403 and zero email messages; browser dashboard access is unavailable. The live API/worker, free Cloudflare tunnel and private model endpoint remain healthy. No further independent work can prove the required actual email, merchant enrollment/unsubscribe, eligible Capital One acquisition or physical/shared-app acceptance without operator input or external-state change. The full deals goal is therefore blocked, not complete. The tunnel approval is already resolved; the next needed operator evidence is Photon plan/remaining email allowance/credit, followed by authorized real merchant inputs. Do not repeat broad tests or fabricate live success while waiting.

### Operator email confirmation and diagnosis — November 7, 2026

The user confirms Photon should allow emails and clarifies the intended use: read incoming promotional messages after registering users with merchants. The prior billing 403 was a permission limitation, not proof of a receiving failure. A fresh aggregate database read found zero owners, identities, enrollments, source messages, offers and failed jobs; the local email reader enablement flag was still false. Thus no real enrolled-user mail flow had been initiated. The agent acknowledged that treating billing access as the principal receiving blocker overstated the evidence.

Based on the operator confirmation, enabled `PHOTON_EMAIL_ENTITLEMENT_CONFIRMED=true` in ignored runtime configuration and reloaded the API/worker. Allocated one dedicated pseudonymous operator diagnostic owner/address, explicitly labeled diagnostic in `.local/deals-debug-session.json` (0600); its token is not printed. This does not represent a merchant registration or fabricated deal. Actual Photon inbox reconciliation for this owner succeeded: source status `ready`, no reason/error, zero messages. Domain verification and one signed destination remain healthy. No plan/payment changes, outbound sends, or merchant registrations occurred.

Next diagnostic step is an actual inbound email from the user's own mailbox to the saved diagnostic address, with subject `DEALS-INBOUND-TEST`. After the user reports sending it, inspect Photon receipt, signed delivery/recipient routing, durable message/job storage and classification. Merchant registration remains unfinished: current adapters hand off actual identity/verification steps. The remaining blocker should no longer be described as inability to read Photon's billing endpoint.


### Actual inbound receipt and enrollment continuation — November 7, 2026, latest

This update supersedes earlier zero-message/billing-blocked snapshots. The operator confirmed Photon email availability and sent `DEALS-INBOUND-TEST`. The actual message passed the signed webhook, owner routing, durable storage and worker in 1993 ms; reconciliation reused the same message and extraction job. The job completed once without error. The personal test sender correctly produced no merchant offer. Evidence: [redacted inbound trace](services/deals/docs/deals-inbound-evidence.json). Billing endpoint 403 is a permission limitation, not an email-receiving outage.

Migration `002_enrollment_flow.sql` is applied to TigerData. Explicit owner registration needs no fabricated purchase. Versioned existing-account checks, submitted/uncertain outcome preservation, stale-proof rejection and independent loyalty/marketing confirmation are implemented. Partial confirmation preserves previous verified results. The app exposes promotional-only intent and never equates submitting a form with external success. Validation now passes 33 unit/model tests plus 28 PostgreSQL/API scenarios (61 total), backend/mobile typechecks/builds and both mobile exports.

The user chose Chipotle and Panera, then stated an existing Chipotle membership and no Panera membership. Prepared requests are saved with the stable alias: Chipotle → update existing preferences; Panera → complete signup. No external merchant account/form/confirmation has been completed. Browser access currently reports its host unavailable. Panera requires accurate registration/contact information and SMS OTP; Chipotle specifies an SMS-capable number. The alias is appropriate for promotional mail; required verification and existing account access remain user steps.

Still open within deals: actual merchant signup/preference updates, real promotional messages and evidence review/candidate demonstration, a second real owner alias/plain-text sample, actual unsubscribe/return, observed UI and real-template extraction measurements. Capital One acquisition remains absent with zero offers; source-status/link-out is not aggregation. The separate finance, forecast, location, calls and optimizer implementations are excluded from this request's remaining blockers. The full deals flow is not complete. See [current validation](services/deals/docs/deals-validation.md) and [runbook](services/deals/docs/deals-runbook.md). No commit or push.

## 18. Google identity, Calendar and cross-branch integration plan — November 8, 2026

The user requested planning before implementation: review other branches and existing sign-in UI, add Google OAuth and read-only Calendar-derived expense/income forecasting, identify Nessie customers once during first-use onboarding, and persist the association so repeat authentication does not repeat onboarding. The plan is [plan/google-onboarding-calendar.md](plan/google-onboarding-calendar.md).

Remote references were refreshed and source reviewed across deals, frontend, feat-rs, arjun, main and tom. Proposed integration uses frontend's `app/` UI, deals' Fastify/TigerData backend and UUID ownership, adapted feat-rs finance memory, arjun's deterministic optimizer, and main's calling service. Existing frontend sign-in is a visual placeholder; its Upcoming/Account views use samples. The feat-rs adapter still targets old Nessie endpoints and account-ID ownership. These are integration tasks, not completed functionality.

Proposed design: Google issuer/subject maps to a stable app UUID; saved onboarding state and verified sandbox customer/account IDs live in TigerData; app sessions and encrypted Google offline credentials are separate; read-only calendar consent is optional and revocable; evidence-backed calendar facts reconcile against bills/transactions before deterministic forecasting. Preserve conversational budget/goal onboarding and source uncertainty. Name plus card last four selects a sandbox record and must not be presented as real bank authentication.

Dependencies found: Google OAuth client configuration absent from inspected local env files; Google Console configuration and actual account consent needed if no authorized console session exists. Supported native OAuth testing needs an Expo development build rather than Expo Go. Existing Nessie/TigerData/Photon/Nemotron configuration should be reused. No implementation, migration, merge, commit, push or provider setup was performed; only planning documentation changed.
