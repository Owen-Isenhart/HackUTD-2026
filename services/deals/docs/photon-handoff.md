# Photon handoff — give this file to your agent

You are joining the HackUTD Nessiessential project. Reuse the existing Photon **Beta** project. Email receiving is implemented; use the current API contract when adding texts or calls. Coordinate changes with the deals agent because this is a shared project.

## Connection and credentials

- API: `https://api.photon.codes`
- Dashboard: `https://app.beta.photon.codes`
- Project: `Nessiessential` / `nessiessential`
- Project ID: `pho_prj_01m6wh04gseh78gcs73agt2kj6`
- Authentication: `Authorization: Bearer <PHOTON_API_KEY>`
- Current official API contract: <https://api.photon.codes/openapi.json>

On the original machine, `PHOTON_API_KEY` and `PHOTON_PROJECT_ID` are in ignored `.env.deals.local`. If working elsewhere, obtain those two values privately from the project owner and put them in server-side environment variables or an ignored local env file. They are not included in Git. You do not need the TigerData administrator password just to use Photon.

`src/config.ts` loads `.env.deals.runtime.local`, then `.env.deals.local`; values already supplied by the process take precedence. The runtime file also contains database credentials and signing secrets: share only the specific credentials your work needs. Keep Photon credentials out of Expo/mobile bundles and logs.

The installed Photon CLI previously targeted the stable backend and showed no projects. Use the Beta HTTP API; an empty CLI project list does not mean this project is missing.

## Existing resources — checked November 8, 2026

| Resource | Identifier / status |
| --- | --- |
| Email domain | `deals.getcompfy.com`, verified and receiving |
| Email resource | `pho_res_01m6wq7re9ecxsn46chw9y52eb` |
| SMS/voice line | `pho_res_01m6wh7e9zeh7v79r9h2a8fdda`, reports active; abilities `sms`, `pstn_voice` |
| Default voice profile | `pho_vpf_01m6wh9wjafvk94ang2a51egy6` |
| Email webhook | One existing destination, event `message.received`, API version `2026-07-01` |

Do not recreate the domain, replace DNS, provision another number, rotate credentials, or overwrite the existing webhook to get started. Read the existing resources/profile first. The line/profile's existence is not proof that SMS or calls have passed an end-to-end test. Read the line's phone number and activation state through its resource response when needed; they are not reproduced here.

Email availability was confirmed by the owner. A real user-sent email passed signed delivery, storage and processing in 1993 ms. The key can read messages/resources/profiles and manage the existing email destination. Billing reads return 403; this is a billing permission limitation, not an email outage. Call/SMS entitlement and cost still need checking before sending; email availability does not establish those allowances. Do not add paid resources or change plans.

## Start here

Requires Node `>=24.12.0` and this repository:

```sh
npm ci
npm run provider:check
```

The check is read-only and prints redacted readiness information. To make an authenticated read without printing credentials or private messages:

```sh
node --import tsx --input-type=module <<'JS'
import { config } from './src/config.ts';
import { PhotonClient } from './src/photon.ts';
const photon = new PhotonClient(config);
const page = await photon.listMessages({
  platform: 'email', direction: 'received', pageSize: '10',
});
console.log({ count: page.items.length, hasNextPage: !!page.nextPageToken });
JS
```

Useful paths, relative to the API base:

| Purpose | Request |
| --- | --- |
| Resources and phone number | `GET /v1/projects/{projectId}/platforms/resources` |
| Read messages | `GET /v1/projects/{projectId}/messages?platform=email&direction=received` |
| Send supported text/email messages | `POST /v1/projects/{projectId}/messages` — use the current `SendMessageRequest` schema |
| Voice profiles | `GET /v1/projects/{projectId}/platforms/voice/profiles` |
| Existing voice configuration | `GET /v1/projects/{projectId}/platforms/voice/profiles/{profileId}` |
| Line/profile assignment | `GET /v1/projects/{projectId}/platforms/voice/lines/{resourceId}/profile` |
| Webhook destinations | `GET /v1/projects/{projectId}/webhooks/destinations` |
| Event catalog/schema | `GET /v1/projects/{projectId}/webhooks/event-types?apiVersion=2026-07-01`; append `/message.received/schema` before the query for that event's schema |

Follow every `nextPageToken`; message lists are eventually consistent. The existing client retries no requests automatically and reports status codes through `ProviderError`. The deals worker provides bounded retries and durable reconciliation.

For **calls**, inspect the official voice profile/SIP contract. Do not invent a `/calls` endpoint or assume `POST /messages` initiates a phone call. Existing outbound SIP passwords cannot be recovered from the profile API; coordinate with whoever configured the profile before changing credentials. Re-read profile versions before any version-checked update.

## Reuse the email implementation

- `src/photon.ts`: authenticated client, signature/schema checks, email parsing, ingestion and paginated reconciliation.
- `src/app.ts`: `POST /webhooks/photon` and authenticated deals routes.
- `src/contracts/photon-email-2026-07-01.json`: pinned **email-only** event schema.
- `src/worker.ts`: durable background processing.
- `scripts/photon-destination.ts`: reconcile the existing email destination.
- `docs/deals-runbook.md`: full setup and recovery instructions.

The receiver verifies Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`) against the **original body**, checks the project, and maps ownership using `receivedBy.handle`. Visible To/Cc fields are not delivery evidence. Aliases must be allocated through the existing owner/consent flow before use; arbitrary addresses are not automatically assigned to users.

The current email receiver intentionally rejects other channel schemas. For texts/call events, fetch the appropriate current schema and add a separate handler/destination, or coordinate shared dispatch; do not weaken the email validator or replace its subscriptions. The webhook signing secret is different from the API key.

The email destination URL, ID and signing secret are in `.env.deals.runtime.local`. Its free Cloudflare Quick Tunnel URL is temporary. Reuse the running destination; if the owning agent restarts the tunnel, update the existing destination with `PHOTON_WEBHOOK_URL=https://NEW-HOST/webhooks/photon npm run photon:destination`. That command changes the shared destination, so coordinate it rather than pointing it at two developers' machines in turn.

Validation commands: `npm run photon:verify-webhook` tests signed transport with synthetic data; `npm run photon:check-inbound` traces the known actual diagnostic email and requires the original machine's private `.local/deals-debug-session.json`. `scripts/rehearse-deal-flow.ts` is a separate evolving rehearsal script, not the Photon setup command or proof of real provider delivery.
