# Deals setup and operations

This repository now contains the Node 24/TypeScript deals backend, PostgreSQL worker and Expo deals screens. The broader finance, location, notification and call workstreams are still separate. The status and acceptance evidence are in [deals-validation.md](deals-validation.md).

## Run on this workspace

```sh
npm ci
npm run build
npm start
# In a second terminal:
npm run worker
# Compiled production worker after npm run build:
npm run worker:start
# Mobile:
cd mobile
npm ci
npm start
```

The API defaults to `127.0.0.1:3001`. `/health` checks the process; `/ready` checks its database connection. A physical phone needs a reachable HTTPS server address. Local HTTP is accepted by the mobile sign-in screen only in development. This is a standalone deals shell; the main app can embed `mobile/DealsScreen.tsx` with its authenticated session.

On this machine `.env.deals.local` supplies the existing provider credentials. `.env.deals.runtime.local` supplies the generated API/worker database credentials and JWT signing key. Both are ignored and owner-readable only. Environment variables supplied by the deployment take precedence. Do not print either file, place it in mobile code, or send it to a tunnel provider. `.env.example` contains names and placeholders only.

### Session and consent

```sh
npm run owner:create
```

The command creates an empty owner profile and writes its one-hour session token to an ignored `.local/owner-<uuid>.json` file with mode `0600`. Enter that token and the server address in the mobile app; it stores the session using SecureStore, available only while the device is unlocked. Grant deals consent in the app to allocate a stable opaque email alias. Re-running with the same owner UUID issues a fresh token. Tokens are intentionally short-lived; production sign-in/refresh and shared app account provisioning must integrate with the main authentication workstream.

The signing key is server-only. Tokens use HS256 with required UUID subject, issuer, audience, issued-at and expiry. Normal tokens have `deals:user`. Financial ingestion uses a separately issued, owner-bound `deals:purchase` token; user tokens cannot submit verified transaction imports. The trusted importer must authenticate its real source and must never label sandbox transactions `verified_import`.

The candidate query requires an owner-bound `deals:optimizer` service token. Only the trusted optimizer should submit verified membership, activation, payment and customer context; mobile user tokens cannot impersonate that evidence. Integrate the exported server-side token issuer with the shared service identity system; never distribute these integration tokens to the phone.

Consent withdrawal immediately disables routing, cancels pending interpretation/enrollment work, suppresses offers, erases private local message/offer content, and queues merchant unsubscribe handoffs. An explicit new consent does not silently reverse a merchant opt-out; use Resume promotions. Sign-out clears local credentials; it does not replace consent withdrawal or revoke an already-issued server token before expiry.

## Fresh database setup

Use the real CLI-generated URI so TLS connection parameters are preserved. The following captures the administrative secret without printing or placing it in arguments:

```sh
set +x
DEALS_ADMIN_URI="$(tiger db uri ylg4ko70w8 --with-password --version-check=false)"
ADMIN_DATABASE_URL="$DEALS_ADMIN_URI" npm run db:migrate
# Only for a NEW installation, when no runtime roles/secret file exist:
ADMIN_DATABASE_URL="$DEALS_ADMIN_URI" npm run db:provision
unset DEALS_ADMIN_URI
```

On the existing TigerData service these steps have already succeeded. Do not rerun provisioning to recover credentials: it deliberately refuses implicit role/password rotation. Reuse the local runtime file or rotate credentials as an explicit operational action. No administrative URI is saved in that file.

`deals.schema_migration` records SHA-256 checksums. Migrations run transactionally under an advisory lock and reject modification of applied files. Application roles have no schema creation privileges, no access to migration history, no merchant-registry write permission, and no RLS bypass. The worker additionally receives the narrow claim/scheduling functions. `poolFor` enforces `verify-full` for TLS-enabled database URIs. Tenant operations use `SET LOCAL` through `set_config` inside transactions; pooled connections cannot retain the preceding owner's context.

Recovery: take a verified database backup before a future migration, stop the worker, and apply forward migrations. A failed migration rolls back atomically; inspect the migration history before retrying. Do not drop the schema to roll back a live database. No destructive down migration is supplied. The disposable test runner is separately guarded to refuse a non-local database or one whose name does not end in `_test`.

## Photon and public delivery

The existing domain operation succeeded; one email-domain resource is present. Do not recreate the domain or change its working DNS. `npm run provider:check` prints an allowlisted readiness summary and never signed setup URLs, credentials or message bodies.

The operator has confirmed email availability, and `PHOTON_EMAIL_ENTITLEMENT_CONFIRMED=true` is set in the private runtime configuration. The current key cannot read billing (403); that is a billing permission limitation, not a receiving failure. The actual inbound email passed the signed webhook, storage and worker path. For another deployment, leave the flag false until its operator confirms email availability; the worker then reports `email_entitlement_unconfirmed`. Polling uses five-minute scheduling by default, a fixed window with two minutes of lag, a one-day overlap, every returned pagination token (including empty pages), and per-message deduplication. These are conservative local defaults, not a measured Photon quota or consistency guarantee. First sync starts at epoch, not process startup. Inspect provider quotas before raising frequency; long outages or late visibility beyond the overlap need an explicit full reconciliation.

### HTTPS webhook activation (approved and configured)

A local receiver exists at `POST /webhooks/photon`. It validates Standard Webhooks signatures over the original body, timestamp tolerance, header/event ID agreement, the official pinned `2026-07-01` email schema, project and actual delivery recipient. Visible To/Cc fields are never ownership evidence. Unknown aliases receive a generic acknowledgement without retained content. A real payload still needs to demonstrate that Photon supplies `receivedBy`; missing delivery evidence is rejected rather than guessed.

The user explicitly approved forwarding the API and private promotional email/webhook traffic through Cloudflare provided the tunnel is free. The initial automatic rejection is resolved by that authorization. A free, accountless Cloudflare Quick Tunnel is running to `http://127.0.0.1:3001`, and one Photon destination is configured. The official cloudflared release binary was SHA-256 verified. No Cloudflare API key, paid plan or new domain was needed. The current random HTTPS URL and signing secret are stored only in ignored runtime configuration. Quick Tunnels have no uptime guarantee and change hostname when restarted; see [Cloudflare documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

For a future restart, keep the API running, start the free tunnel below, then pass its new exact `/webhooks/photon` URL to the destination reconciler:

```sh
.local/cloudflared tunnel --url http://127.0.0.1:3001 --no-autoupdate --protocol http2
# In another terminal, using the URL emitted by cloudflared:
PHOTON_WEBHOOK_URL=https://YOUR-TUNNEL.trycloudflare.com/webhooks/photon npm run photon:destination
npm run photon:verify-webhook
```

The setup command uses stable idempotency keys, subscribes only to `message.received`, and stores its secret/destination ID atomically in the owner-only runtime file. On hostname changes it resolves and updates the existing destination, preserving the signing secret; an actual reconciliation confirmed one destination with no duplicate. Restart the API only when configuration/secret changes require it. The public verifier passed health 200, unauthorized API 401, tampered body 400 and a valid signed unallocated-alias 204. These are synthetic transport tests, not Photon-originated email receipt; no message/offer data is inserted. A subsequent actual user-sent email also passed signed delivery and reconciliation with one stored message/job; see [the redacted trace](deals-inbound-evidence.json). Reconciliation works without public ingress once email is enabled.

### Confirming no-cost Photon email usage

This is a **Photon** billing check; Cloudflare's DNS/tunnel settings do not reveal Photon credits. In [Photon Beta](https://app.beta.photon.codes), select `Nessiessential` and open its Billing page. Check the project plan and remaining included email allowance; also check organization credit and any hackathon grant. A Free label is insufficient: [standard Beta pricing](https://photon.codes/docs/beta/plans-and-billing) includes no emails on Free and lists $0.001 per sent/received email. The operator has since confirmed email availability; no billing change was necessary for the successful inbound test. Do not upgrade, add a payment method or enable billable use just to pass a test. Report the plan, remaining allowance/credit and email-enabled status; no new API key is necessary for that dashboard confirmation. The existing project key can manage the email integration but cannot read billing (403).

## Merchant enrollment and offer review

The registry has two **candidate assisted adapters**, Chipotle Rewards and MyPanera. These are not claims of completed registrations or verified generic form automation. The websites require real account/phone information and verification; actual permitted automated submission and successful promotion delivery remain unverified. The worker automatically discovers and queues supported programs from verified imports, then exposes the official membership/preference handoff. Unknown merchants have an explicit unsupported discovery status. Existing accounts must be checked first. Sandbox/Nessie test observations are stored with provenance and cannot initiate real external enrollment.

The mobile app separates loyalty and marketing outcomes. A selected merchant confirmation email and the user's explicit sender/outcome verification are required before saving an enrolled outcome; the evidence is labeled user-verified, not API-verified. CAPTCHA, OTP, legal terms and missing identity information remain user steps. A submitted form is not success evidence. Purchase-driven discovery requires real verified history. Explicit owner registration is also supported without inventing a purchase. The operator has selected both programs, identified an existing Chipotle account and no Panera account, and the saved flows reflect those choices. No external merchant form has been submitted.

Message processing stores sanitized text, never executable HTML, attachments or tracking-resource responses. Display-name matches are insufficient; senders must match a registry domain and enrollment. Photon transport authenticity does not establish merchant authenticity, so parser/model proposals remain in review. The mobile evidence form supports reviewing scope, channels, exact expiry and membership/activation/customer conditions using verbatim source quotes. Unsupported formulas, image-only content, ambiguous dates, upper-bound benefits and incomplete conditions stay uncertain. There is no auto-fetch of email links and no agent tool execution from message text.

The existing Brev machine now has a running `nemotron` container, vLLM `0.31.0`, model alias `nemotron-bolt`, root `nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16`, context limit 8192. It was discovered and reused without installing/restarting/stopping that service or changing the GPU allocation. The adapter is validated through a private SSH forward bound to `127.0.0.1`/`::1`, not a public model endpoint. Runtime settings point at `http://127.0.0.1:18000/v1`; no new model API key was required.

```sh
brev port-forward following-copper-silkworm --org rishi.sandrana-4a543b-ipod -p 18000:8000
# Keep the forward running; in another terminal:
npm run nemotron:check
```

The model selects exact source quotes and semantic conditions through a flat schema. Code computes monetary units, explicit source formulas, dates and unique UTF-16 quote locations; model suggestions never become eligibility facts without review. Input over 8000 characters, ambiguous/missing substantive quotes, unsupported currency, malformed/truncated output and unexpected tools are rejected with explicit errors. Missing-value markers leave facts unknown; date-only expiry stays unknown. There are no model tools or link fetches. See [NVIDIA's model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-BF16) and [vLLM structured-output documentation](https://docs.vllm.ai/en/v0.31.0/features/structured_outputs/).

Four live-model **synthetic** cases passed: percentage/conditions, receipt rejection, date-only dollar-off, and prompt-injection data. Observed responses took 228–3941 ms. [Evaluation JSON](deals-nemotron-evaluation.json) is explicitly not real promotion evidence. Actual merchant-email extraction quality remains unmeasured. Deterministic parsing and human review still work without a model; the parser does not calculate purchase savings.

Expiry is exclusive at the stored instant. Date-only or missing expiry does not become a fabricated timestamp. Query-time checks reject expired/stale/not-yet-valid offers even before maintenance. Benefits use integer minor units/basis points. Unknown stacking cannot be combined. Account, channel, product, branch, payment, activation and minimum-spend conditions are checked before eligibility; the optimizer must still validate price, budget, cash flow, suitability and geographic feasibility.

Inactivity is one calendar year after the later of activation or last posted verified purchase, in the user's timezone. February 29 clamps to February 28; local wall time survives DST. Cleanup and purchases lock the owner before enrollment. Local suppression is immediate, loyalty status is preserved, and external unsubscribe remains pending until the merchant outcome is confirmed. A post-cleanup purchase reuses the enrollment; an old imported purchase does not restore it. Explicit opt-out/revoked consent cannot be overridden by a purchase. Refund/cancellation corrections recompute the last valid purchase with monotonically increasing source versions.

## API handoff

All `/v1/deals/*` routes require an owner-bound token. Bodies reject extra fields, including forged owner IDs. Reads are private/no-store.

| Purpose | Route |
| --- | --- |
| Status, alias, failures | `GET /v1/deals/status` |
| Consent / withdrawal | `POST` / `DELETE /v1/deals/consent` |
| Program registry, discoveries | `GET /v1/deals/programs`, `/discoveries` |
| Verified importer | `POST /v1/deals/purchases` with `{purchases:[...]}` and `deals:purchase` scope |
| Enrollment state | `GET /v1/deals/enrollments`, `/enrollments/:id/flow` |
| Explicit registration | `POST /v1/deals/enrollments` with `{programId,existingMembership:"unknown"|"yes"|"no",intent:"loyalty_and_promotions"|"promotions_only"}` |
| Existing-account check | `POST /v1/deals/enrollments/:id/existing-membership` with `{expectedVersion,existingMembership:"yes"|"no"}` |
| Resumable attempt | `POST /v1/deals/enrollments/:id/attempt` with `{expectedVersion,outcome:"opened"|"submitted"|"uncertain",existingMembershipChecked:true}` |
| Enrollment actions | `POST /v1/deals/enrollments/:id/{retry,confirm,opt-out,resume,confirm-unsubscribe}` |
| Evidence | `GET /v1/deals/messages`, `/messages/:id` |
| Offers / immutable revisions | `GET /v1/deals/offers`, `/offers/:id` |
| Evidence-backed correction | `POST /v1/deals/offers/:id/review` with expected revision |
| Optimizer candidates | `POST /v1/deals/candidates` |
| Source recovery | `POST /v1/deals/sources/photon_email/retry` |
| Explicit failed-job recovery | `POST /v1/deals/jobs/:id/retry` (dead jobs only; attempts reset only after this authenticated action) |
| Durable consumer invalidation | `GET /v1/deals/events?after=<sequence>` |

`/confirm` requires `{expectedVersion,messageId,loyalty:"existing"|"enrolled"|"not_enrolled",promotions,senderVerified:true,existingMembershipChecked:true}`. Select only outcomes the merchant actually confirmed; a false/unselected outcome preserves previously verified status. At least one positive outcome is required. The message must belong to the owner, match the program's sender domain, and postdate the current verification cycle. This is labeled user-verified evidence, not automatic merchant API verification.

`/confirm-unsubscribe` requires `{expectedVersion,completedAtMerchant:true}` after the user completes the official merchant preference step. Local suppression is immediate; the external action is still pending until then. A version conflict requires reloading the current flow. An uncertain/submitted signup opens existing-account verification instead of resubmitting; do not reset it merely to retry a form. The mobile flow supports requesting promotional email only, while explaining that a merchant can still require loyalty enrollment.

Use [src/contracts.ts](../src/contracts.ts) for exact validated purchase/review/query fields. Clients must consume every event page and save their cursor only after processing, and reload or discard cached recommendations on material offer changes. Candidate responses retain rejection reasons, required actions, revision, evidence, private audience and `priceEvidence:null`. This layer never asserts affordability.

## Retention and limitations

Sanitized message text/subject: seven days. Offer field evidence, private codes and URLs: validity plus 30 days; unknown-expiry offers use seven-day freshness plus 30 days. Purging removes content from revisions too; normal revisions remain unchanged until erasure. Lifecycle/outbox/completed-job metadata: 400 days. Owner/program and replay hashes retain minimal metadata to prevent duplicate accounts/work. Raw HTML/attachments are not stored. Explicit consent withdrawal removes private content immediately, including cached eligibility. These are selected engineering defaults, not a provider retention guarantee.

The pinned Photon API documents no message DELETE endpoint. Local erasure cannot prove Photon/merchant erasure; the app exposes this limitation. Database backup retention/encryption at rest and production key management need a deployment review before handling real financial history. Public logs contain codes/IDs only, not tokens, body text, email addresses or signed links.

Capital One Offers and Shopping have separate blocked source records. No free permitted route passed the access gate; measured imported coverage is **zero**. Official link-outs are navigation, not aggregation. [The source decision](deals-validation.md#capital-one-access-decision) preserves REWARD-05 as unmet. Never seed test offers into a real demo or relabel sandbox purchases as customer history.
