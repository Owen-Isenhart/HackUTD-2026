import { randomBytes } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { config, required } from "../src/config.js";

// Transport verification only: use an unallocated recipient, never fabricated demo data.
const endpoint = new URL(
  required(config.PHOTON_WEBHOOK_URL, "PHOTON_WEBHOOK_URL"),
);
const project = required(config.PHOTON_PROJECT_ID, "PHOTON_PROJECT_ID");
const secret = required(config.PHOTON_WEBHOOK_SECRET, "PHOTON_WEBHOOK_SECRET");
if (
  endpoint.protocol !== "https:" ||
  endpoint.pathname !== "/webhooks/photon" ||
  endpoint.username ||
  endpoint.password
)
  throw new Error("Configured HTTPS webhook required");
const id = (prefix: string) =>
  `${prefix}_0${randomBytes(13).toString("hex").slice(0, 25)}`;
const now = new Date(),
  eventId = id("pho_evt");
const user = (handle: string) => ({
  id: id("pho_usr"),
  projectId: project,
  platform: "email",
  handle,
  kind: "contact",
  details: {},
  metadata: {},
});
const body = JSON.stringify({
  id: eventId,
  type: "message.received",
  apiVersion: "2026-07-01",
  source: "email.photon",
  timestamp: now.toISOString(),
  data: {
    projectId: project,
    object: {
      id: id("pho_msg"),
      projectId: project,
      platform: "email",
      status: "received",
      metadata: {},
      sentBy: user("transport-test@example.invalid"),
      receivedBy: user(
        `unrouted-${randomBytes(18).toString("hex")}@${config.PHOTON_EMAIL_DOMAIN}`,
      ),
      space: {
        id: id("pho_spc"),
        projectId: project,
        platform: "email",
        kind: "direct",
        participantIds: [],
        details: {},
        metadata: {},
      },
      content: {
        type: "text",
        format: "plain",
        text: "Synthetic HTTPS transport check only. No real email or offer.",
        metadata: { email: { subject: "Synthetic transport check" } },
      },
      timestamps: { receivedAt: now.toISOString() },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  },
});
const headers = {
  "Content-Type": "application/json",
  "webhook-id": eventId,
  "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
  "webhook-signature": new Webhook(secret).sign(eventId, now, body),
};
for (const [name, path, init, expected] of [
  ["public_health", "/health", {}, 200],
  ["unauthenticated_api", "/v1/deals/status", {}, 401],
  [
    "tampered_body",
    endpoint.pathname,
    { method: "POST", headers, body: body + " " },
    400,
  ],
  [
    "valid_signature_unallocated_alias",
    endpoint.pathname,
    { method: "POST", headers, body },
    204,
  ],
] as const) {
  const response = await fetch(new URL(path, endpoint), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  console.log(
    JSON.stringify({
      check: name,
      status: response.status,
      expected,
      passed: response.status === expected,
      syntheticTransportOnly: true,
    }),
  );
  if (response.status !== expected) process.exitCode = 1;
  await response.body?.cancel();
}
