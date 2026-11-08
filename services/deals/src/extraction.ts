import { createHash } from "node:crypto";
import { convert } from "html-to-text";
import { termsSchema, type Terms } from "./contracts.js";

export function digest(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}
export function termsFingerprint(terms: Terms): string {
  const {
    evidence: _evidence,
    parserVersion: _version,
    title: _title,
    ...facts
  } = terms;
  return digest({
    ...facts,
    channels: [...facts.channels].sort(),
    products: [...facts.products].sort(),
    exclusions: [...facts.exclusions].sort(),
    branches: [...facts.branches].sort(),
  });
}
export function sanitizeHtml(html: string): string {
  return convert(html.slice(0, 500_000), {
    wordwrap: false,
    limits: { maxInputLength: 500_000, maxDepth: 40, maxChildNodes: 10_000 },
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "iframe", format: "skip" },
      { selector: "form", format: "skip" },
      { selector: "object", format: "skip" },
    ],
  }).slice(0, 100_000);
}
export function validateEvidence(terms: Terms, text: string): string[] {
  const errors: string[] = [];
  for (const [field, span] of Object.entries(terms.evidence)) {
    if (
      span.end > text.length ||
      span.start >= span.end ||
      text.slice(span.start, span.end) !== span.quote
    )
      errors.push(`invalid_evidence:${field}`);
  }
  if (!terms.evidence.benefit) errors.push("missing_benefit_evidence");
  if (terms.expiresAt && !terms.evidence.expiresAt)
    errors.push("missing_expiry_evidence");
  if (terms.code && !terms.evidence.code) errors.push("missing_code_evidence");
  if (terms.minSpendMinor !== null && !terms.evidence.minSpendMinor)
    errors.push("missing_minimum_spend_evidence");
  const quotedRate = terms.evidence.benefit?.quote.match(
    /(\d+(?:\.\d{1,2})?)\s*%/,
  );
  if (
    terms.benefit.rateBps !== null &&
    (!quotedRate || decimalMinor(quotedRate[1]!) !== terms.benefit.rateBps)
  )
    errors.push("benefit_rate_not_supported_by_quote");
  const quotedAmount = terms.evidence.benefit?.quote.match(
    /\$(\d+(?:\.\d{1,2})?)/,
  );
  if (
    terms.benefit.amountMinor !== null &&
    (!quotedAmount ||
      decimalMinor(quotedAmount[1]!) !== terms.benefit.amountMinor)
  )
    errors.push("benefit_amount_not_supported_by_quote");
  const quotedExpiry = terms.evidence.expiresAt?.quote.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})/,
  );
  if (
    terms.expiresAt &&
    quotedExpiry &&
    Date.parse(quotedExpiry[0]) !== Date.parse(terms.expiresAt)
  )
    errors.push("expiry_not_supported_by_quote");
  if (
    terms.code &&
    terms.evidence.code &&
    !terms.evidence.code.quote.includes(terms.code)
  )
    errors.push("code_not_supported_by_quote");
  if (
    terms.expiresAt &&
    terms.validFrom &&
    Date.parse(terms.expiresAt) <= Date.parse(terms.validFrom)
  )
    errors.push("contradictory_dates");
  if (terms.benefit.type === "percent" && terms.benefit.rateBps === null)
    errors.push("missing_rate");
  if (
    ["fixed_discount", "fixed_price"].includes(terms.benefit.type) &&
    terms.benefit.amountMinor === null
  )
    errors.push("missing_amount");
  return errors;
}
export function classify(text: string): string {
  if (
    /\b(?:verification code|verify your (?:email|account)|one.time (?:code|password)|reset your password)\b/i.test(
      text,
    )
  )
    return "verification";
  if (
    /\b(?:order confirmation|your receipt|order #|payment received)\b/i.test(
      text,
    ) &&
    !/(?:\b\d+% off\b|\$\d+ off\b)/i.test(text)
  )
    return "receipt";
  if (
    /(?:\b\d+(?:\.\d+)?%\s*(?:off|cash\s?back)\b|\$\d+(?:\.\d{2})?\s*off\b|\bbuy one.{0,30}get one\b|\b\d+\s*(?:bonus )?points\b)/i.test(
      text,
    )
  )
    return "promotion";
  if (/\bwelcome\b/i.test(text)) return "welcome";
  return "newsletter";
}
export function emptyTerms(title: string): Terms {
  return {
    title: title.slice(0, 200) || "Promotion needs review",
    currency: "USD",
    benefit: {
      type: "unsupported",
      amountMinor: null,
      rateBps: null,
      upTo: false,
      capMinor: null,
    },
    minSpendMinor: null,
    channels: [],
    products: [],
    exclusions: [],
    branches: [],
    code: null,
    membershipRequired: null,
    newCustomerOnly: null,
    activationRequired: null,
    paymentRequirement: null,
    stacking: "unknown",
    validFrom: null,
    expiresAt: null,
    expirySemantics: "unknown",
    sourceTimezone: null,
    payout: { form: "unknown", timing: null },
    redemptionUrl: null,
    evidence: {},
    parserVersion: "conservative-v1",
  };
}
/** Proposals only. Unknown templates/qualifications always require human review. No LLM action authority. */
export function extract(
  text: string,
  subject: string,
): { classification: string; proposals: Terms[] } {
  const classification = classify(text);
  if (classification !== "promotion") return { classification, proposals: [] };
  // A message may contain several benefits. Preserve each separately; no combining alternatives.
  const matches = [
    ...text.matchAll(
      /(?:up to\s+)?(\d{1,3}(?:\.\d{1,2})?)%\s*(off|cash\s?back)|\$(\d+(?:\.\d{2})?)\s*off/gi,
    ),
  ];
  if (!matches.length)
    return { classification, proposals: [emptyTerms(subject)] };
  const proposals = matches.slice(0, 20).map((match) => {
    const terms = emptyTerms(subject);
    const start = match.index!;
    terms.evidence.benefit = {
      start,
      end: start + match[0].length,
      quote: match[0],
    };
    const cashback = match[2]?.replace(/\s/g, "").toLowerCase() === "cashback";
    terms.benefit = {
      type: match[3] ? "fixed_discount" : cashback ? "cashback" : "percent",
      amountMinor: match[3] ? decimalMinor(match[3]) : null,
      rateBps: match[1] ? decimalMinor(match[1]) : null,
      upTo: /^up to/i.test(match[0]),
      capMinor: null,
    };
    terms.payout = {
      form: cashback ? "cashback" : "immediate_discount",
      timing: cashback ? null : "At checkout, subject to terms",
    };
    // Only explicit ISO instants are parsed automatically. Date-only offers remain uncertain.
    const expiry =
      /\b(?:expires?|valid until|ends?)\s*:?\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))/i.exec(
        text,
      );
    if (expiry && Number.isFinite(Date.parse(expiry[1]!))) {
      terms.expiresAt = expiry[1]!;
      terms.expirySemantics = "exclusive_instant";
      terms.evidence.expiresAt = {
        start: expiry.index,
        end: expiry.index + expiry[0].length,
        quote: expiry[0],
      };
    }
    const code =
      /\b(?:use code|promo code|code)\s*:?\s*([A-Z0-9_-]{3,30})\b/.exec(text);
    if (code) {
      terms.code = code[1]!;
      terms.evidence.code = {
        start: code.index,
        end: code.index + code[0].length,
        quote: code[0],
      };
    }
    const min =
      /\b(?:minimum spend|orders? (?:of|over)|spend)\s*:?\s*\$(\d+(?:\.\d{2})?)/i.exec(
        text,
      );
    if (min) {
      terms.minSpendMinor = decimalMinor(min[1]!);
      terms.evidence.minSpendMinor = {
        start: min.index,
        end: min.index + min[0].length,
        quote: min[0],
      };
    }
    return termsSchema.parse(terms);
  });
  return { classification, proposals };
}
export function decimalMinor(decimal: string): number {
  const [whole, fraction = ""] = decimal.split(".");
  const value = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Amount exceeds supported range");
  return Number(value);
}
export function contentReasons(terms: Terms): string[] {
  const reasons: string[] = [];
  if (!terms.expiresAt || terms.expirySemantics !== "exclusive_instant")
    reasons.push("expiry_unknown");
  if (!terms.channels.length) reasons.push("channel_unknown");
  if (!terms.products.length) reasons.push("product_scope_unknown");
  if (terms.minSpendMinor === null) reasons.push("minimum_spend_unknown");
  if (terms.paymentRequirement === null && !terms.evidence.paymentRequirement)
    reasons.push("payment_requirement_unknown");
  if (terms.benefit.type === "unsupported") reasons.push("formula_unsupported");
  if (terms.benefit.upTo) reasons.push("benefit_is_upper_bound");
  if (terms.membershipRequired === null)
    reasons.push("membership_requirement_unknown");
  if (terms.newCustomerOnly === null)
    reasons.push("customer_requirement_unknown");
  if (terms.activationRequired === null)
    reasons.push("activation_requirement_unknown");
  if (terms.benefit.type === "cashback" && !terms.payout.timing)
    reasons.push("payout_timing_unknown");
  return reasons;
}
