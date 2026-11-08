import { config, required } from "../src/config.js";
import { digest } from "../src/extraction.js";
import { PhotonClient } from "../src/photon.js";
import { saveRuntimeSettings } from "./runtime-env.js";

const url = new URL(required(config.PHOTON_WEBHOOK_URL, "PHOTON_WEBHOOK_URL"));
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.hash ||
  url.search ||
  url.pathname !== "/webhooks/photon"
)
  throw new Error(
    "Set PHOTON_WEBHOOK_URL to the public HTTPS /webhooks/photon receiver",
  );
const client = new PhotonClient(config);
const root = `/v1/projects/${required(config.PHOTON_PROJECT_ID, "PHOTON_PROJECT_ID")}/webhooks/destinations`;
const name = "Nessiessential deals email";

if (config.PHOTON_WEBHOOK_SECRET) {
  const page = await client.request(root);
  const choices = (page.destinations ?? page.items ?? []).filter((d: any) =>
    config.PHOTON_WEBHOOK_DESTINATION_ID
      ? d.destinationId === config.PHOTON_WEBHOOK_DESTINATION_ID
      : d.name === name && !d.deletedAt,
  );
  if (choices.length !== 1)
    throw new Error(
      "Cannot uniquely resolve the existing destination. Inspect Photon before changing configuration.",
    );
  const existing = choices[0];
  if (existing.apiVersion !== "2026-07-01")
    throw new Error(
      "Existing destination version differs from the pinned email contract.",
    );
  if (
    existing.url !== url.href ||
    existing.status !== "enabled" ||
    JSON.stringify(existing.enabledEvents) !==
      JSON.stringify(["message.received"])
  ) {
    await client.request(`${root}/${existing.destinationId}`, {
      method: "PATCH",
      headers: {
        "Idempotency-Key": `nessiessential-deals-webhook-update-${digest(existing.destinationId + url.href).slice(0, 32)}`,
      },
      body: JSON.stringify({
        url: url.href,
        status: "enabled",
        enabledEvents: ["message.received"],
      }),
    });
  }
  await saveRuntimeSettings({
    PHOTON_WEBHOOK_URL: url.href,
    PHOTON_WEBHOOK_DESTINATION_ID: existing.destinationId,
  });
  console.log(
    "Existing destination reconciled. Signing secret preserved; no duplicate created.",
  );
} else {
  const data = await client.request(root, {
    method: "POST",
    headers: {
      "Idempotency-Key": `nessiessential-deals-webhook-v1-${digest(url.href).slice(0, 24)}`,
    },
    body: JSON.stringify({
      name,
      url: url.href,
      apiVersion: "2026-07-01",
      enabledEvents: ["message.received"],
      status: "enabled",
    }),
  });
  if (
    typeof data.signingSecret !== "string" ||
    !data.signingSecret.startsWith("whsec_") ||
    !data.destination?.destinationId
  )
    throw new Error("Unexpected Photon destination response");
  await saveRuntimeSettings({
    PHOTON_WEBHOOK_SECRET: data.signingSecret,
    PHOTON_WEBHOOK_URL: url.href,
    PHOTON_WEBHOOK_DESTINATION_ID: data.destination.destinationId,
  });
  console.log(
    "Destination created. Stored its signing secret in .env.deals.runtime.local (0600). Restart the API.",
  );
}
