import type { Terms } from "../src/contracts.js";
import { config } from "../src/config.js";
export const project = "pho_prj_00000000000000000000000001";
export const webhookSecret = "whsec_" + Buffer.alloc(32, 7).toString("base64");
export const cfg = {
  ...config,
  PHOTON_PROJECT_ID: project,
  PHOTON_EMAIL_DOMAIN: "deals.example.test",
  PHOTON_API_KEY: "isolated-test-key",
  PHOTON_WEBHOOK_SECRET: webhookSecret,
  DEALS_AUTH_SECRET: "isolated-test-auth-secret-that-is-at-least-32-bytes",
  PHOTON_EMAIL_ENTITLEMENT_CONFIRMED: true,
  NEMOTRON_BASE_URL: undefined,
  NEMOTRON_MODEL: undefined,
};
export const text =
  "Save 20% off burritos. Use code SAVE20. Minimum spend $10. Expires 2030-12-01T00:00:00Z. Online only. No activation required. All customers. No membership required. No payment restriction.";
export function terms(): Terms {
  function span(quote: string) {
    const start = text.indexOf(quote);
    return { start, end: start + quote.length, quote };
  }
  return {
    title: "20% off burritos",
    currency: "USD",
    benefit: {
      type: "percent",
      amountMinor: null,
      rateBps: 2000,
      upTo: false,
      capMinor: null,
    },
    minSpendMinor: 1000,
    channels: ["online"],
    products: ["burrito"],
    exclusions: [],
    branches: [],
    code: "SAVE20",
    membershipRequired: false,
    newCustomerOnly: false,
    activationRequired: false,
    paymentRequirement: null,
    stacking: "unknown",
    validFrom: null,
    expiresAt: "2030-12-01T00:00:00Z",
    expirySemantics: "exclusive_instant",
    sourceTimezone: "UTC",
    payout: { form: "immediate_discount", timing: "At checkout" },
    redemptionUrl: null,
    evidence: {
      benefit: span("20% off"),
      expiresAt: span("Expires 2030-12-01T00:00:00Z"),
      code: span("code SAVE20"),
      minSpendMinor: span("Minimum spend $10"),
      paymentRequirement: span("No payment restriction"),
    },
    parserVersion: "isolated-test-fixture",
  };
}
export function message(address = "a@deals.example.test", suffix = "01") {
  const id = `pho_msg_000000000000000000000000${suffix}`;
  const user = (handle: string, s: string) => ({
    id: `pho_usr_000000000000000000000000${s}`,
    projectId: project,
    platform: "email",
    handle,
    kind: "contact",
    details: {},
    metadata: {},
  });
  return {
    id,
    projectId: project,
    platform: "email",
    status: "received",
    sentBy: user("offers@chipotle.com", "01"),
    receivedBy: user(address, "02"),
    metadata: {},
    content: {
      type: "text",
      format: "plain",
      text,
      metadata: {
        email: { subject: "A real-looking test promotion (synthetic fixture)" },
      },
    },
    space: {
      id: "pho_spc_00000000000000000000000001",
      projectId: project,
      platform: "email",
      kind: "direct",
      participantIds: [],
      details: {},
      metadata: {},
    },
    timestamps: { receivedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
export function event(address = "a@deals.example.test", suffix = "01") {
  return {
    id: `pho_evt_000000000000000000000000${suffix}`,
    type: "message.received",
    apiVersion: "2026-07-01",
    source: "email.photon",
    timestamp: new Date().toISOString(),
    data: { projectId: project, object: message(address, suffix) },
  };
}
