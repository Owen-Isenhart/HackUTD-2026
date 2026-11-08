# Backend and Photon recommendation runbook

This checkout implements the single-owner sandbox path. The Expo app can request a call from a fresh recommendation or opt into automatic call or iMessage delivery. Call follow-ups use Brev Nemotron and the options saved for that call. Prices and rewards in this path come from observed purchase estimates and the labeled demo cashback catalog. The [integration plan](backend-integration-plan.md) also lists the broader product gates.

## Start the stack

1. On the Brev host, confirm `curl -fsS http://127.0.0.1:8000/v1/models` lists `nemotron-bolt`. For local development, use the [Brev SSH-forward handoff](brev-nemotron-handoff.md). Keep the model port private.
2. Install the finance packages with `npm ci`. Set the Nessie sandbox account, Tiger Data connection, and a random `FINANCE_DEMO_TOKEN` in the ignored root `.env`. Run `npm run finance:migrate`, then `npm run finance:serve`. Verify `GET /health` and `GET /ready` on port `8787` before pointing Expo at the HTTPS gateway. Expose only the app API and signed webhooks through HTTPS. Keep `/api/recommendations/evaluate`, `/internal/`, Calls, and the optimizer on a private network or loopback.
3. To use the team optimizer, install its pinned dependencies with `uv sync --locked` in `optimizer`. Set a distinct `OPTIMIZER_API_KEY` in its runtime and the root `.env`, set `OPTIMIZER_API_URL=http://127.0.0.1:8789` on finance, and run `uv run --locked python -m optimizer.server` from the optimizer directory. The typed optimizer validates the candidate world and ranks eligible demo offers. The default prototype works with the local deterministic ranker when the optimizer URL is empty.
4. In `services/calls`, use the team's existing LiveKit and NVIDIA secrets in the ignored `.env.local`. Keep the Photon outbound SIP trunk and include the opted-in recipient in `DEMO_ALLOWED_NUMBERS`. Run `uv run --locked uvicorn src.main:app --host 127.0.0.1 --port 8788` and `uv run --locked python -m src.agent start` in separate supervised processes. The voice worker continues to use NVIDIA's hosted speech services. The recommendation endpoint uses the Brev model.

| Setting | Where to set it |
| --- | --- |
| `CALL_RECOMMENDATION_USER_ID` | Root `.env`. Use a server-side label such as `demo-user`. Finance supplies it to Calls at dispatch. |
| `CALLS_API_URL`, `CALLS_API_KEY` | Root `.env`. Use the private port and a distinct random key of at least 24 characters. Set the same key in `services/calls/.env.local`. |
| `RECOMMENDATION_API_URL`, `RECOMMENDATION_API_KEY` | Calls runtime. Use `http://127.0.0.1:8787/api/recommendations/evaluate` on the same host and a different random key. Set that key on finance too. |
| `CALL_RECOMMENDATION_TO_NUMBER` | Root `.env`. Use the allowlisted consenting recipient's E.164 number. The app cannot provide a number. |
| `CALL_ALLOW_DEMO_LOCATION=1` | Optional. Permits the explicit simulated-visit call button. The automated location endpoint still requires a fresh live fix. |
| `ALERT_ALLOW_DEMO_CATALOG=1` | Optional. Enables automatic delivery of labeled demo offers. The user must still opt into one configured channel. Leave it off until the test recipient and device are ready. |
| `PHOTON_PROJECT_ID`, `PHOTON_API_KEY`, `PHOTON_AGENT_USER_ID`, `PHOTON_RECIPIENT` | Root `.env` for iMessage. Use the project's verified sender and consenting recipient. iMessage acceptance is recorded separately from handset receipt. |
| `DEALS_API_URL`, `DEALS_OWNER_ID`, `DEALS_AUTH_SECRET` | Optional same-origin gateway. Start the Deals API/worker with its separate DB roles and provision the tenant first. Reuse the Deals signing key on finance for scoped, 30-second tokens. The current finance recommender uses demo offers. |

The Deals service lives in `services/deals`. Its [existing runbook](../services/deals/docs/deals-runbook.md) covers migrations, owner provisioning, and the Photon destination. With the gateway configured, `GET /v1/deals/status` and the owner routes are reachable through finance authentication. `POST /webhooks/photon` forwards the original body and signature headers to Deals. Keep `DEALS_ALLOW_TEST_FIXTURES` disabled outside isolated tests. The project's existing Capital One seed is fixture data.

The sandbox account and purchases were reachable. Its bills, loan and deposit routes returned empty results, and the account transfers route returned HTTP 404. The profile reports unavailable source counts as `null`. Forecasting uses the posted cash balance, documented Nessie bill schedules and known Photon outflows. Exact payee, amount and date evidence reconciles mutually unique obligations and posted payments. Loan records without a confirmed date remain unresolved. The trend scenario estimates payroll by matching repeated deposits from the same payroll descriptor and discretionary spending from the last 60 completed days of categorized purchases. The recommendation guard uses known obligations and the saved reserve. Apply migration `006` before starting this version to enable reserve storage.

## Exercise the call

1. From Expo Go, load the sandbox profile and obtain a nearby routine recommendation. With simulation enabled, use the Friday Chipotle test. Tap **Call the opted-in demo phone** while the recommendation is fresh.
2. Answer the call and ask about the offer. Ask for a cheaper option or a price limit. The agent passes the speech transcript and the call ID to finance. It speaks the message returned by the API. The available alternatives depend on the eligible choices at that location. The Chipotle simulation has one nearby fixture offer. A lower cap can produce a no-match response.
3. Leave the call active and scan a different location. The conversation still uses its saved offer. Confirming a changed budget or ending the call makes that context unavailable. Call status is readable by the app at `GET /api/v1/calls/{id}`. A timeout after a dial attempt records `uncertain` and prevents automatic redial.

## Exercise native location

1. Enable automatic demo delivery on the server. In Expo Go, choose **Opt in to Photon calls** or **Opt in to iMessage**, then start live routine alerts. Quiet hours are 10 p.m. to 8 a.m. in the finance timezone. Repeated eligible events are suppressed by the saved event ID and per-place cooldown.
2. On a Mac, install a Personal Team build with `npx expo run:ios --device`, or run the generated Xcode workspace. Use a unique bundle identifier and Developer Mode on the iPhone. Choose **Enable alerts while locked**, allow Always location access, and verify at least one region is registered. Expo Go is used for the foreground test. [Expo SDK 58 Location](https://docs.expo.dev/versions/v58.0.0/sdk/location/) · [Apple Personal Team signing](https://developer.apple.com/help/account/basics/about-your-developer-account)
3. Install a locally signed build with a bundled JS payload for the untethered test. Lock the iPhone, move from outside to inside a known region at the routine time, and confirm the physical delivery and a single durable attempt. Test again after disabling automatic alerts, downgrading location permission, and rebooting. A location-scoped credential remains readable after the first unlock and expires after seven days. Re-enable delivery from the app to register a new credential.

## Test commands

| Command | What it exercises |
| --- | --- |
| `npm test` | Finance, transcript endpoint, eligibility, and Photon message processing with controlled test inputs. |
| `TEST_LIVE_NEMOTRON=1 node --test test/finance-call.test.js` | The transcript and two-price follow-up go through the live loopback Brev endpoint. The handset transport is simulated. |
| `TEST_TIGER_LOCATION=1 node --env-file=.env --test test/tiger-location-delivery.test.js` | Real PostgreSQL migration, scoped device access, durable event replay and simulated iMessage. The test schema rolls back. |
| `uv run --locked pytest -q` | Run from `services/calls` and separately from `optimizer`. |
| `npm run check` | Run from `services/deals` for the typecheck, unit suite and build. Its DB suite requires a separate disposable local PostgreSQL database. |

On PowerShell, set the test flag with `$env:TEST_LIVE_NEMOTRON = '1'` or `$env:TEST_TIGER_LOCATION = '1'` before running Node. For the full local call endpoint test, set `TEST_OPTIMIZER_API_URL` and `TEST_OPTIMIZER_API_KEY` to the running private optimizer too.
Set `TEST_CALLS_PYTHON` to the Calls environment's Python executable to exercise the real voice HTTP client in the same test.
