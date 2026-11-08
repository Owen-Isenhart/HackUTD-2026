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

The profile reports the balance Nessie returns and totals unique posted purchases in cents. The week starts on Monday, and dates use `FINANCE_TIME_ZONE` (default `America/Chicago`). A routine groups purchases at the same Nessie merchant by weekday and time of day in the last 90 days. It takes two distinct dates to qualify. Patterns with two or three days are tentative, and date-only purchases support weekday patterns. The model gets up to eight aggregate patterns with temporary indices and returns a highlight with a reason from a fixed list. Account IDs, merchant names, purchase records, and balances stay out of its prompt.

Each profile refresh reads Nessie and recalculates the observed routines. Bill and deposit counts indicate the coverage of the sandbox. The 30-day forecast and reconciliation flows are still pending.

### Configure Tiger Data memory

Set the server-side `TIGER_DATA_URL` in the backend's ignored `.env`. Use a full PostgreSQL connection string, or add `TIGER_DATA_PASSWORD` if the URL omits it. Run `npm.cmd run finance:migrate` on Windows or `npm run finance:migrate` on Linux before starting the API. The migration uses the `hackutd_finance` schema and can be run again safely. The connection verifies the PostgreSQL server certificate. [Tiger Data connection guide](https://www.tigerdata.com/docs/integrate/find-connection-details)

The API saves the latest profile and derived routines under the server-configured Nessie account. Confirmed budgets and goals are stored separately so a refresh cannot overwrite them. The finance profile includes `memoryStorage` and `memoryVersion`. In a development setup without `TIGER_DATA_URL`, the API holds the latest profile for the running server session. If a Nessie refresh fails with Tiger Data enabled, the API displays the last saved profile and pauses new alerts until a refresh succeeds.

The authenticated `PUT /api/finance-memory` endpoint accepts an explicit confirmation, the current `memoryVersion` as `version`, a `budget` with `period` (`week` or `month`) and `limitCents` (or `null`), and a `goals` array. A stale version returns HTTP 409. The shared demo token authorizes the one sandbox account.

### Show the profile in Expo Go

1. Set a random `FINANCE_DEMO_TOKEN` of at least 24 characters in `.env`. Run `npm.cmd run finance:serve` on the backend machine. The server binds to loopback port `8787` by default.
2. Point an HTTPS reverse proxy or HTTPS development tunnel at `http://127.0.0.1:8787`. Set `EXPO_PUBLIC_FINANCE_API_URL` to that HTTPS origin and restart Expo. The Expo Metro tunnel serves the app bundle separately.
3. Open **Demo tools**, then enter the token under **Sandbox finance profile** and tap **Refresh finance profile**. The token grants access to the one configured sandbox account for this demo.

### Test history-based routine alerts

1. After loading the seeded finance profile, tap **Simulate Friday Chipotle visit** under **Routine alerts**. Allow notifications. The simulated location and time use the same matching code as live GPS. With the seeded Nessie history, the app shows four observed Friday midday visits and **$0.70 in demo cashback** on the typical **$14** purchase. Look for the local banner.
2. For live GPS, tap **Start live routine alerts**, grant **While Using the App**, and keep Expo Go in the foreground. When the phone finds a possible match, it sends the fix and its accuracy to the authenticated finance API for eligibility checking. The API discards the fix after processing. An offer qualifies when a recent fix puts you within 300 m including its reported accuracy, and the exact merchant branch matches a weekday and time of day observed on at least two dates. The profile must be refreshed after 30 minutes.
3. Repeated GPS fixes at the same branch can schedule one live alert per app session. Tap **Stop routine alerts** to remove the location subscription. The simulated visit is explicitly labeled and can be run again.

The API uses the demo cashback catalog. It checks the full payable amount against the last reported Nessie balance and any confirmed budget, then ranks offers for the intended branch by effective cost. The cashback rates are fictional, and substitute merchants require separate evidence of purchase intent. Nemotron receives aggregate timing and cost facts and chooses which fact to emphasize. The API renders the explanation from validated amounts. GPS, raw transactions, account IDs, and user goals stay out of the model prompt. Background location and server-delivered push require separate native setup. [Expo background location](https://docs.expo.dev/versions/v58.0.0/sdk/location/#background-location-methods) · [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)

## Verification

Run `npm.cmd test` for the demo offers, finance calculations, model contract, routine matching, and alert deduplication. Run `npx.cmd expo export --platform ios` to check the iOS JavaScript bundle. Use the iPhone steps above to verify location permission, the notification banner, and audio.
