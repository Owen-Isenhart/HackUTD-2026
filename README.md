# Hands-Off Banking · Nearby Offers

Tap **Scan for deals** to get a current location fix and list demo cashback offers within 300 meters, nearest first. Distances are straight-line estimates. The prototype uses a small local catalog around Richardson and UT Dallas, and the cashback rates are fictional. The scan runs on the phone and works without the finance backend or a demo token.

## Test on an iPhone from Windows

Use Node.js 24 and Expo Go for SDK 58. Sign in to the same free Expo account in Expo Go and the Windows CLI.

```powershell
npm.cmd ci
npx.cmd expo whoami
npm.cmd run start:phone
```

If the CLI is signed out, run `npx.cmd expo login`. If the Windows browser launcher crashes, set `$env:BROWSER = 'none'`, run `npx.cmd expo login --browser`, and paste the fresh link into your PC browser while the CLI waits.

Keep PowerShell running and scan the new terminal QR code with the iPhone Camera. If Metro was open during the dependency update, stop it with **Ctrl+C** and restart with `npm.cmd run start:phone -- --clear`.

1. Tap **Scan for deals** and grant **While Using the App**. The app shows the reported accuracy and any catalog matches. Live results are available near the UT Dallas Student Union or the Chipotle at 283 W Campbell Rd in Richardson. [UT Dallas dining](https://union.utdallas.edu/facilities/dining/) · [Chipotle location](https://locations.chipotle.com/tx/richardson/283-w-campbell-rd)
2. Open **Demo tools** and tap **Try demo location** from anywhere. It should show Chipotle about **180 m** away and **$0.75** in example cashback on a **$15** purchase at **5%**.
3. With **Demo tools** open, tap **Send test notification** on an offer and allow notifications. A local iPhone notification is scheduled for two seconds later. You can stay in the app to see the banner or go to the Home Screen after scheduling. [Expo notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/)
4. With **Demo tools** open, tap **Play demo call** on an offer to hear it and see the transcript. Turn off Silent Mode for audio. [Expo Speech](https://docs.expo.dev/versions/v58.0.0/sdk/speech/)

## Remote alerts and calls

The demo uses local notification delivery and on-device speech. Remote push for a standalone iOS app requires a signed build, APNs credentials, and a backend that sends notifications. Detecting new locations while the app is closed requires background location permission and a development build. [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) · [Expo background location](https://docs.expo.dev/versions/v58.0.0/sdk/location/#background-location-methods)

A real inbound call to the user's iPhone can be placed by a backend through a Photon voice number with a SIP-connected provider such as ElevenLabs or Retell. `npm.cmd run photon:send -- 1` remains a separate iMessage smoke test using the settings in `.env.example`. [Photon voice and messaging](https://photon.codes/blog/introducing-photon-2.0)

The optional iBeacon prototype is in `modules/merchant-beacons`, `src/useBeaconRanging.js`, and `firmware/MerchantBeacon` for later testing.

## Nessie finance profile and Nemotron routines

Set `NESSIE_API_KEY` and `NESSIE_ACCOUNT_ID` in the ignored `.env`. The sandbox account seeded for this demo is `73b254c5-3402-4f86-a2f4-1991db6e5b9a`. In a separate local Ubuntu WSL terminal, open the SSH forward with a signed-in Brev CLI. Keep it running while you use the finance backend. [NVIDIA Brev port forwarding](https://docs.nvidia.com/brev/cli/connectivity#brev-port-forward)

```bash
~/.local/bin/brev port-forward following-copper-silkworm --port 8000:8000
```

From PowerShell in this repo, check that the server lists `nemotron-bolt`, then generate a profile.

```powershell
curl.exe -fsS http://127.0.0.1:8000/v1/models
npm.cmd run finance:profile
```

If the backend runs on the VM, it can reach vLLM at `http://127.0.0.1:8000/v1` directly. Override `NEMOTRON_BASE_URL` or `NEMOTRON_MODEL` if your endpoint or served name differs. The CLI reports `routineInsight.status` as `interpreted`, `unavailable`, or `no_routine`. If the model is unavailable, the profile still shows the observed Nessie routines. [vLLM structured outputs](https://docs.vllm.ai/en/v0.31.0/features/structured_outputs/)

The profile reports the balance Nessie returns and totals unique posted purchases in cents. The week starts on Monday, and dates use `FINANCE_TIME_ZONE` (default `America/Chicago`). A routine groups purchases at the same Nessie merchant by weekday and time of day in the last 90 days. It takes two distinct dates to qualify. Patterns with two or three days are tentative, and date-only purchases support weekday patterns. The model gets up to eight aggregate patterns with temporary indices and returns a highlight with a reason from a fixed list. Account IDs, merchant names, purchase records, and balances stay out of the routine prompt.

Each profile refresh reads Nessie and recalculates the observed routines. Authenticated `GET /api/v1/finance/transactions` lists normalized purchases. `GET /api/v1/finance/forecast?days=30` accepts 1–90 calendar days starting today and projects the posted cash balance after documented Nessie bills and Photon obligations. Exact, mutually unique payee, amount, and date matches reconcile duplicate obligations and posted payments. Estimated payroll and discretionary spending are reported separately. Nessie loans without a confirmed due date and failed bill or loan feeds make forecast headroom unavailable. [Nessie OpenAPI spec](https://nessieisreal.com/nessie-openapi-spec.yaml)

### Configure Tiger Data memory

Set the server-side `TIGER_DATA_URL` in the backend's ignored `.env`. Use a full PostgreSQL connection string, or add `TIGER_DATA_PASSWORD` if the URL omits it. Run `npm.cmd run finance:migrate` on Windows or `npm run finance:migrate` on Linux before starting the API. The migration uses the `hackutd_finance` schema and can be run again safely. The connection verifies the PostgreSQL server certificate. [Tiger Data connection guide](https://www.tigerdata.com/docs/integrate/find-connection-details)

The API saves the latest profile and derived routines under the server-configured Nessie account. Confirmed budgets and goals are stored separately so a refresh cannot overwrite them. The finance profile includes `memoryStorage` and `memoryVersion`. In a development setup without `TIGER_DATA_URL`, the API holds the latest profile for the running server session. If a Nessie refresh fails with Tiger Data enabled, the API displays the last saved profile and pauses new alerts until a refresh succeeds.

The authenticated `PUT /api/finance-memory` endpoint accepts an explicit confirmation, the current `memoryVersion` as `version`, a `budget` with `period` (`week` or `month`) and `limitCents` (or `null`), and a `goals` array. The optional `reserveCents` sets the cash reserve or clears it with `null`. Omitting it preserves the stored reserve. A stale version returns HTTP 409. Read the values back from `GET /api/v1/finance/memory`. The shared demo token authorizes the one sandbox account.

### Show the profile in Expo Go

1. Set a random `FINANCE_DEMO_TOKEN` of at least 24 characters in `.env`. Run `npm.cmd run finance:serve` on the backend machine. The server binds to loopback port `8787` by default.
2. Point an HTTPS reverse proxy or HTTPS development tunnel at `http://127.0.0.1:8787`. Set `EXPO_PUBLIC_FINANCE_API_URL` to that HTTPS origin and restart Expo. The Expo Metro tunnel serves the app bundle separately.
3. Open **Demo tools**, then enter the token under **Sandbox finance profile** and tap **Refresh finance profile**. The token grants access to the one configured sandbox account for this demo.

### Test history-based routine alerts

1. After loading the seeded finance profile, tap **Simulate Friday Chipotle visit** under **Routine alerts**. Allow notifications. The simulated location and time use the same matching code as live GPS. With the seeded Nessie history, the app shows four observed Friday midday visits and **$0.70 in demo cashback** on the typical **$14** purchase. Look for the local banner.
2. For live GPS, tap **Start live routine alerts**, grant **While Using the App**, and keep Expo Go in the foreground. When the phone finds a possible match, it sends the fix and its accuracy to the authenticated finance API for eligibility checking. The API discards the fix after processing. An offer qualifies when a recent fix puts you within 300 m including its reported accuracy, and the exact merchant branch matches a weekday and time of day observed on at least two dates. The profile must be refreshed after 30 minutes.
3. Repeated GPS fixes at the same branch can schedule one live alert per app session. Tap **Stop routine alerts** to remove the location subscription. The simulated visit is explicitly labeled and can be run again.

The API uses the demo cashback catalog. It checks the full payable amount against the last reported Nessie cash balance, the lowest 30-day balance after known commitments and the user's cash reserve, and any confirmed budget. Payroll and spending estimates are excluded from this eligibility check. The API then ranks offers for the intended branch by effective cost. The cashback rates are fictional, and substitute merchants require separate evidence of purchase intent. Nemotron receives aggregate timing and cost facts and chooses which fact to emphasize. The API renders the explanation from validated amounts. GPS, raw transactions, account IDs, and user goals stay out of the model prompt. Background location and server-delivered push require separate native setup. [Expo background location](https://docs.expo.dev/versions/v58.0.0/sdk/location/#background-location-methods) · [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)

### Test a Photon recommendation call

Configure the finance and Calls processes as described in the [backend runbook](docs/backend-runbook.md). With Tiger Data migrated and an allowlisted, consenting demo recipient configured, use **Simulate Friday Chipotle visit** and tap **Call the opted-in demo phone** before the recommendation expires. Simulation requires `CALL_ALLOW_DEMO_LOCATION=1` on the finance backend.

The backend binds the call to a saved recommendation and sends the exact caller transcript to `POST /api/recommendations/evaluate`. Brev Nemotron interprets the request. Code applies the price limit and reranks the eligible nearby choices. A new scan leaves the active call's context intact. Material finance changes and call expiry invalidate it. Results use the demo catalog and label its estimated cashback.

For automatic delivery, opt in to calls or iMessage under **Routine alerts** and start live checks. A Personal Team build also exposes **Enable alerts while locked**, which requests Always location access and registers nearby geofences. Expo Go exercises foreground delivery. [Native setup and smoke tests](docs/backend-runbook.md)

### Read money plans from texts with Photon

Nessie reads texts that reach the shared Photon Beta project (`Nessiessential`) and looks for plans and debts that will cost the user money, such as "Dinner at Pappas Friday? $40 each" followed by "I'm in". These plans are reserved in the finance profile and in recommendations. Photon sees only texts sent to or through the project's line: the user texts or forwards to the Nessie number, or adds it to a group chat with friends. It cannot read the phone's other conversations.

Set these server-side values in `.env`. Ask the project owner for `PHOTON_PROJECT_ID` and `PHOTON_API_KEY`, and keep them out of Expo `EXPO_PUBLIC_` variables.

- `PHOTON_TEXT_OWNER_HANDLES`: the consenting user's own phone numbers, comma-separated. Friends' texts are read only in conversations that also include this user.
- `PHOTON_TEXT_PLATFORMS`: `sms` by default. Add `imessage` if the project has an iMessage line.
- `PHOTON_TEXT_RESOURCE_ID`: the SMS/voice line, `pho_res_01m6wh7e9zeh7v79r9h2a8fdda`. Texts received by another resource are ignored.
- `PHOTON_TEXT_POLL_SECONDS`: how often `finance:serve` pulls new texts (default 60, `0` turns polling off).

Run `npm.cmd run finance:migrate` once to add the text tables, then `npm.cmd run texts:sync` for a one-time pull and interpretation. The terminal shows counts and amounts only. `finance:serve` does the same in the background. It reads `GET /v1/projects/{projectId}/messages?platform=sms&direction=received`, follows every `nextPageToken`, and overlaps windows by a day because listings are eventually consistent. It never creates resources or changes the shared email webhook destination.

**How a text becomes a plan**

1. Deduplication: one stored row and one interpretation job per Photon message ID, whether it arrives by webhook, by sync, or both. Friends' phone numbers are not stored. Message bodies are deleted after 7 days.
2. Prefilter: only texts with a money or plan word (`$`, `split`, `venmo`, `dinner`, `tickets`…) reach Nemotron, plus the user's short replies to such texts.
3. Nemotron reads the target text with up to five earlier texts from the same conversation, shown as `user` or `friend`, and returns a fixed JSON schema. The prompt treats texts as untrusted data. The model has no tools.
4. Deterministic checks: the amount must appear in the texts. The date must match an explicit word such as "Friday", "tomorrow", "11/20" or "Nov 20". An even split needs a head count written in the texts. The evidence quote must be found in the texts. Anything that fails is dropped rather than guessed.
5. A plan is **included** automatically when its amount, date and the user's own participation are verified with high confidence. Otherwise it is a **pending clarification** listing what is missing. Later texts in the same conversation update the same plan. "Cancelled" removes it unless the user had confirmed it, in which case it asks again. Money owed **to** the user is shown but never counted as available.

**Effect on the profile and recommendations**

`GET /api/finance-profile` now includes `socialObligations`: plans due in the next 30 days, pending clarifications, and the committed and reserved amounts. Recommendations subtract included plans and pending plans with a known amount from the balance, and plans due in the current budget week or month from the remaining budget. A pending plan with no verified amount blocks affordability claims until it is clarified. The new reasons are `reserved_for_plans`, `budget_reserved_for_plans` and `clarification_required`. The explanation says how much is set aside for plans from texts.

**API (demo token)**

- `GET /api/text-obligations`: plans plus ingestion status, including failed jobs.
- `POST /api/texts/sync`: pull and interpret now.
- `PUT /api/text-obligations/{id}`: `{ "confirmed": true, "version": n, "action": "confirm", "amountCents": 4000, "dueDate": "2026-11-13" }` or `{ "confirmed": true, "version": n, "action": "dismiss" }`. A stale version returns 409. A user's edit is never overwritten by a later inference.

In Expo Go, the finance profile shows **Plans from your texts** with **Confirm plan**, **Not my plan** and **Check texts now**.

**Optional webhook**: `POST /webhooks/photon/texts` verifies Standard Webhooks signatures over the raw body with `PHOTON_TEXT_WEBHOOK_SECRET`, checks the project, and ignores non-text events. It needs its own destination. Do not repoint or resubscribe the shared email destination; coordinate with the deals owner first. Polling works without a webhook.

**Not yet verified live**: SMS delivery to the line, the exact `source` value of SMS events, and Nemotron's accuracy on real texts. Check SMS cost and entitlement before sending texts to the line.

### Bills and plans from Gmail and Google Calendar via Photon

Photon has no Gmail or Google Calendar connector. It receives email on the verified domain `deals.getcompfy.com`, so the user's Gmail forwards financial mail to a finance alias there. Nessie reads that mail with read-only Photon API calls and handles it like the texts above. Bills, payment requests, reservations, tickets and Calendar event notifications become plans in the profile, forecast and recommendations. Receipts for money already charged are not forecast again, because Nessie already shows the transaction. If an email describes the same plan as a text (same amount and date), it updates that plan instead of adding another.

1. **Get a finance alias.** Allocate it through the existing owner/consent flow on the `deals` branch. Aliases are not assigned automatically, and unallocated addresses must not be used. Keep it separate from the deals alias so promotional extraction and bill tracking don't mix. Put it in `PHOTON_FINANCE_EMAIL_ADDRESSES`. Only mail whose Photon `receivedBy.handle` is that alias is read. Visible To and Cc are ignored.
2. **Add it as a Gmail forwarding address.** Gmail > Settings > Forwarding and POP/IMAP > Add a forwarding address. Gmail sends a confirmation email to the alias. Run `npm.cmd run gmail:code` to print the code from Photon, then enter it in Gmail. The confirmation email is never stored or sent to Nemotron.
3. **Create a Gmail filter that forwards only financial mail.** Leave "Forward it to" unchecked for everything else. For example:
   `subject:(bill OR invoice OR statement OR "payment due" OR "amount due" OR renewal OR reservation OR tickets OR "requested" OR "you owe") OR from:(venmo.com OR calendar-notification@google.com)`
4. **Google Calendar.** In Calendar settings, turn on email notifications for events, or the **Daily agenda** email. Notifications come from `calendar-notification@google.com`, and the filter above forwards them. Events with a written cost are tracked. Events with no cost are ignored, or become a question when they clearly cost money, such as a dinner reservation.
5. Run `npm.cmd run finance:migrate` again (migration `003` allows email), then `npm.cmd run texts:sync`.

Email bodies are deleted after 7 days. HTML is reduced to text, and scripts are dropped. The prompt treats the email as untrusted data, and amounts and dates must appear in the email. An outsider who learns the alias can only make Nessie more cautious: a fake bill reserves money, and a fake refund is never counted as available. Keep the alias private anyway.

## Verification

Run `npm.cmd test` for the demo offers, finance calculations, model contract, routine matching, alert deduplication, call recommendation lookup, and Photon text plans (signatures, deduplication, validation, merging, retries, reservations and the HTTP routes). The lookup test uses a loopback HTTP server. Run `npx.cmd expo export --platform ios` to check the iOS JavaScript bundle. Use the iPhone steps above to verify location permission, the notification banner, and audio.
