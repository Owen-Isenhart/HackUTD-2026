import { test } from "node:test";
import assert from "node:assert/strict";
import {
  modelOfferSchema,
  normalizeModelOffer,
  proposeWithNemotron,
  type ModelOffer,
} from "../src/nemotron.js";
import { validateEvidence, contentReasons } from "../src/extraction.js";
import { cfg, text } from "./fixtures.js";

const modelCfg = {
  ...cfg,
  NEMOTRON_BASE_URL: "http://127.0.0.1:18000/v1",
  NEMOTRON_MODEL: "synthetic-model",
  NEMOTRON_API_KEY: "synthetic-model-only-key",
};
export function modelProposal(): ModelOffer {
  return {
    title: "Burrito promotion",
    benefitType: "percent",
    benefitQuote: "20% off burritos.",
    products: ["burrito"],
    productScopeQuote: "20% off burritos.",
    channels: ["online"],
    channelQuote: "Online only.",
    minimumSpendQuote: "Minimum spend $10.",
    expiryQuote: "Expires 2030-12-01T00:00:00Z.",
    codeQuote: "Use code SAVE20.",
    membership: "not_required",
    membershipQuote: "No membership required.",
    activation: "not_required",
    activationQuote: "No activation required.",
    customers: "all",
    customerQuote: "All customers.",
    paymentRequirement: null,
    paymentQuote: "No payment restriction.",
    stacking: "unknown",
    stackingQuote: null,
    exclusions: [],
    exclusionsQuote: null,
    payoutTimingQuote: null,
  };
}
function response(
  offer = modelProposal(),
  extra: Record<string, unknown> = {},
) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ offers: [offer] }) },
          ...extra,
        },
      ],
    }),
  );
}
test("model normalization computes amounts and exact UTF-16 evidence without model arithmetic", () => {
  const unicode = "🙂 " + text;
  const t = normalizeModelOffer(modelProposal(), unicode, "synthetic-model");
  assert.equal(t.benefit.rateBps, 2000);
  assert.equal(t.benefit.amountMinor, null);
  assert.equal(t.minSpendMinor, 1000);
  assert.equal(t.code, "SAVE20");
  assert.equal(t.expiresAt, "2030-12-01T00:00:00Z");
  assert.equal(t.evidence.benefit!.start, unicode.indexOf("20% off"));
  assert.deepEqual(validateEvidence(t, unicode), []);
  assert.deepEqual(contentReasons(t), []);
});
test("absent or ambiguous quotes fail instead of inventing source offsets", () => {
  const p = modelProposal();
  p.benefitQuote = "100% off";
  assert.throws(
    () => normalizeModelOffer(p, text, "test"),
    /nemotron_unresolved_quote/,
  );
  assert.throws(
    () =>
      normalizeModelOffer(modelProposal(), text + " 20% off burritos.", "test"),
    /nemotron_unresolved_quote/,
  );
});
test("date-only expiry remains uncertain and point rewards never gain a cash amount", () => {
  const source = text.replace("2030-12-01T00:00:00Z", "December 1");
  const p = modelProposal();
  p.expiryQuote = "Expires December 1.";
  const t = normalizeModelOffer(p, source, "test");
  assert.equal(t.expiresAt, null);
  assert.equal(t.expirySemantics, "date_only");
  const points = modelProposal();
  points.benefitType = "points";
  points.benefitQuote = "Earn 500 bonus points.";
  const pt = normalizeModelOffer(
    points,
    "Earn 500 bonus points. " + text,
    "test",
  );
  assert.equal(pt.benefit.amountMinor, null);
  assert.equal(pt.payout.form, "points");
});
test("explicit source formulas override a mistaken model benefit classification", () => {
  const p = modelProposal();
  p.benefitType = "fixed_price";
  p.benefitQuote = "Get $5 off sandwiches.";
  p.products = ["sandwiches"];
  p.productScopeQuote = p.benefitQuote;
  const t = normalizeModelOffer(
    p,
    text.replace("20% off burritos.", "Get $5 off sandwiches."),
    "test",
  );
  assert.equal(t.benefit.type, "fixed_discount");
  assert.equal(t.benefit.amountMinor, 500);
  assert.equal(t.payout.form, "immediate_discount");
});
test("unverified payment restrictions stay unknown even when a quote exists", () => {
  const p = modelProposal();
  p.paymentRequirement = "unknown";
  p.paymentQuote = "Use the eligible card.";
  const t = normalizeModelOffer(
    p,
    text.replace("No payment restriction.", "Use the eligible card."),
    "test",
  );
  assert.equal(t.evidence.paymentRequirement, undefined);
  assert.ok(contentReasons(t).includes("payment_requirement_unknown"));
  p.paymentRequirement = "Card X";
  assert.throws(
    () =>
      normalizeModelOffer(
        p,
        text.replace("No payment restriction.", "Use the eligible card."),
        "test",
      ),
    /nemotron_payment_not_in_quote/,
  );
});
test("missing-value markers cannot verify model-suggested restrictions or stacking", () => {
  const p = modelProposal();
  p.stacking = "allowed";
  p.stackingQuote = "unknown";
  p.membership = "required";
  p.membershipQuote = "not provided";
  const t = normalizeModelOffer(p, text, "test");
  assert.equal(t.stacking, "unknown");
  assert.equal(t.membershipRequired, null);
  assert.equal(t.evidence.stacking, undefined);
});
test("model cannot invent product applicability or supported currency", () => {
  const p = modelProposal();
  p.products = ["espresso"];
  assert.throws(
    () => normalizeModelOffer(p, text, "test"),
    /nemotron_product_not_in_quote/,
  );
  const euro = modelProposal();
  euro.benefitQuote = "EUR 20% off burritos.";
  assert.throws(
    () => normalizeModelOffer(euro, "EUR 20% off burritos. " + text, "test"),
    /nemotron_unsupported_currency/,
  );
});
test("model transport carries no tools or Photon credentials and produces validated proposals", async () => {
  const offers = await proposeWithNemotron(
    text,
    modelCfg,
    async (url, init) => {
      assert.equal(String(url), "http://127.0.0.1:18000/v1/chat/completions");
      const body = String(init?.body);
      assert.ok(!body.includes(cfg.PHOTON_API_KEY));
      assert.ok(!body.includes("propertyNames"));
      const payload = JSON.parse(body);
      assert.equal(payload.tools, undefined);
      assert.equal(payload.chat_template_kwargs.enable_thinking, false);
      return response();
    },
  );
  assert.equal(offers?.length, 1);
  assert.equal(offers?.[0]?.benefit.rateBps, 2000);
});
test("truncated or malicious model output has a permanent actionable failure code", async () => {
  await assert.rejects(
    () =>
      proposeWithNemotron(text, modelCfg, async () =>
        response(modelProposal(), { finish_reason: "length" }),
      ),
    /nemotron_output_truncated/,
  );
  await assert.rejects(
    () =>
      proposeWithNemotron(
        text,
        modelCfg,
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: '{"offers":[],"send_secret":true}' },
                },
              ],
            }),
          ),
      ),
    /nemotron_malformed_proposal/,
  );
  await assert.rejects(
    () =>
      proposeWithNemotron(text, modelCfg, async () =>
        response(modelProposal(), {
          message: { tool_calls: [{ name: "send_key" }] },
        }),
      ),
    /nemotron_unexpected_response/,
  );
});
test("unconfigured, oversized and insecure model requests do not transmit data", async () => {
  const never = async () => {
    throw new Error("Unexpected transport");
  };
  assert.equal(await proposeWithNemotron(text, cfg, never), null);
  await assert.rejects(
    () => proposeWithNemotron("a".repeat(8001), modelCfg, never),
    /nemotron_input_too_large/,
  );
  await assert.rejects(
    () =>
      proposeWithNemotron(
        text,
        { ...modelCfg, NEMOTRON_BASE_URL: "http://public.example/v1" },
        never,
      ),
    /nemotron_secure_endpoint_required/,
  );
  await assert.rejects(
    () =>
      proposeWithNemotron(
        text,
        {
          ...modelCfg,
          NEMOTRON_BASE_URL: "https://user:password@example.test/v1",
        },
        never,
      ),
    /nemotron_secure_endpoint_required/,
  );
  assert.equal(
    modelOfferSchema.safeParse({ ...modelProposal(), action: "leak" }).success,
    false,
  );
});
