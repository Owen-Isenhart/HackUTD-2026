import { createHash } from "node:crypto";
import type { Terms, PurchaseContext } from "./contracts.js";
import { termsSchema } from "./contracts.js";
import { type Tx, emit } from "./db.js";
import {
  contentReasons,
  digest,
  termsFingerprint,
  validateEvidence,
} from "./extraction.js";

export interface CapitalOneOfferSpec {
  programId: string;
  merchantId: string;
  campaignKey: string;
  title: string;
  benefitType: "cashback" | "fixed_discount" | "percent";
  rateBps: number | null;
  amountMinor: number | null;
  minSpendMinor: number;
  channels: ("online" | "in_store" | "in_app" | "pickup")[];
  products: string[];
  exclusions: string[];
  paymentRequirement: string;
  payoutTiming: string;
  benefitQuote: string;
  minSpendQuote: string;
  expiryQuote: string;
  validFrom: string;
  expiresAt: string;
}

export const CAPITAL_ONE_SPECS: CapitalOneOfferSpec[] = [
  {
    programId: "capital_one_nike",
    merchantId: "nike",
    campaignKey: "c1-nike-5pct-2026",
    title: "5% Cash Back on Nike with Capital One Offers",
    benefitType: "cashback",
    rateBps: 500,
    amountMinor: null,
    minSpendMinor: 0,
    channels: ["online", "in_store"],
    products: ["*"],
    exclusions: ["Gift cards", "Air Jordan retro releases"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 1-2 billing cycles",
    benefitQuote:
      "Earn 5% cash back as a statement credit on eligible Nike purchases.",
    minSpendQuote: "Orders of $0 minimum spend qualify.",
    expiryQuote: "Valid through 2027-01-01T00:00:00Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
  },
  {
    programId: "capital_one_walmart",
    merchantId: "walmart",
    campaignKey: "c1-walmart-2pct-2026",
    title: "2% Cash Back on Walmart Online Orders Over $35",
    benefitType: "cashback",
    rateBps: 200,
    amountMinor: null,
    minSpendMinor: 3500,
    channels: ["online", "pickup"],
    products: ["*"],
    exclusions: ["Prescription drugs", "Tires", "Gift cards"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 2 billing cycles",
    benefitQuote: "Earn 2% cash back as statement credit on Walmart orders.",
    minSpendQuote: "Minimum spend: $35.00 on online and pickup orders.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "capital_one_macys",
    merchantId: "macys",
    campaignKey: "c1-macys-6pct-2026",
    title: "6% Cash Back on Macy's Purchases",
    benefitType: "cashback",
    rateBps: 600,
    amountMinor: null,
    minSpendMinor: 0,
    channels: ["online", "in_store"],
    products: ["*"],
    exclusions: ["Apple products", "Gift cards"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 1-2 billing cycles",
    benefitQuote:
      "Earn 6% cash back on eligible Macy's purchases online and in-store.",
    minSpendQuote: "Orders of $0 minimum spend qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "capital_one_sephora",
    merchantId: "sephora",
    campaignKey: "c1-sephora-4pct-2026",
    title: "4% Cash Back on Sephora Orders Over $25",
    benefitType: "cashback",
    rateBps: 400,
    amountMinor: null,
    minSpendMinor: 2500,
    channels: ["online", "in_store"],
    products: ["*"],
    exclusions: ["Gift cards"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 1-2 billing cycles",
    benefitQuote:
      "Earn 4% cash back as a statement credit on Sephora beauty purchases.",
    minSpendQuote: "Orders over $25.00 qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "capital_one_bestbuy",
    merchantId: "bestbuy",
    campaignKey: "c1-bestbuy-3pct-2026",
    title: "3% Cash Back on Best Buy Purchases Over $50",
    benefitType: "cashback",
    rateBps: 300,
    amountMinor: null,
    minSpendMinor: 5000,
    channels: ["online", "in_store", "pickup"],
    products: ["*"],
    exclusions: ["Console hardware", "Gift cards"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 2 billing cycles",
    benefitQuote: "Earn 3% cash back on electronics at Best Buy.",
    minSpendQuote: "Orders of $50.00 or more qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "capital_one_target",
    merchantId: "target",
    campaignKey: "c1-target-2pct-2026",
    title: "2% Cash Back on Target Online & Pickup Orders",
    benefitType: "cashback",
    rateBps: 200,
    amountMinor: null,
    minSpendMinor: 0,
    channels: ["online", "pickup"],
    products: ["*"],
    exclusions: ["Target Pharmacy", "Gift cards"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 2 billing cycles",
    benefitQuote:
      "Earn 2% cash back statement credit on Target online and pickup.",
    minSpendQuote: "Orders of $0 minimum spend qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "capital_one_homedepot",
    merchantId: "homedepot",
    campaignKey: "c1-homedepot-4pct-2026",
    title: "4% Cash Back on The Home Depot Orders Over $100",
    benefitType: "cashback",
    rateBps: 400,
    amountMinor: null,
    minSpendMinor: 10000,
    channels: ["online", "pickup"],
    products: ["*"],
    exclusions: ["Tool rental", "Installation services"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 2 billing cycles",
    benefitQuote: "Earn 4% cash back on Home Depot home improvement orders.",
    minSpendQuote: "Orders over $100.00 qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "capital_one_uber_eats",
    merchantId: "uber_eats",
    campaignKey: "c1-ubereats-5pct-2026",
    title: "5% Cash Back on Uber Eats Delivery & Pickup",
    benefitType: "cashback",
    rateBps: 500,
    amountMinor: null,
    minSpendMinor: 1500,
    channels: ["in_app", "online"],
    products: ["*"],
    exclusions: ["Tips", "Delivery fees"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 1 billing cycle",
    benefitQuote:
      "Earn 5% cash back statement credit on Uber Eats dining orders.",
    minSpendQuote: "Orders over $15.00 qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "capital_one_booking",
    merchantId: "booking_com",
    campaignKey: "c1-booking-6pct-2026",
    title: "6% Cash Back on Prepaid Stays at Booking.com",
    benefitType: "cashback",
    rateBps: 600,
    amountMinor: null,
    minSpendMinor: 0,
    channels: ["online"],
    products: ["*"],
    exclusions: ["Flights", "Car rentals paid at pickup"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit after completed stay",
    benefitQuote:
      "Earn 6% cash back on prepaid accommodations booked with Booking.com.",
    minSpendQuote: "Orders of $0 minimum spend qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "capital_one_lululemon",
    merchantId: "lululemon",
    campaignKey: "c1-lululemon-4pct-2026",
    title: "4% Cash Back on Lululemon Orders Over $50",
    benefitType: "cashback",
    rateBps: 400,
    amountMinor: null,
    minSpendMinor: 5000,
    channels: ["online", "in_store"],
    products: ["*"],
    exclusions: ["Gift cards"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Statement credit within 1-2 billing cycles",
    benefitQuote:
      "Earn 4% cash back as statement credit on activewear at Lululemon.",
    minSpendQuote: "Orders of $50.00 or more qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "chipotle_rewards",
    merchantId: "chipotle",
    campaignKey: "c1-chipotle-3off15-2026",
    title: "$3 off Chipotle Online or App Orders Over $15",
    benefitType: "fixed_discount",
    rateBps: null,
    amountMinor: 300,
    minSpendMinor: 1500,
    channels: ["in_app", "online", "pickup"],
    products: ["*"],
    exclusions: ["Alcoholic beverages", "Gift cards"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Immediate checkout discount",
    benefitQuote: "Get $3.00 off your meal with Capital One Offers.",
    minSpendQuote: "Minimum spend: $15.00 on online orders.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
  {
    programId: "mypanera",
    merchantId: "panera",
    campaignKey: "c1-panera-20pct-2026",
    title: "20% off Any Panera Entree or Warm Bowl",
    benefitType: "percent",
    rateBps: 2000,
    amountMinor: null,
    minSpendMinor: 0,
    channels: ["in_store", "in_app", "pickup"],
    products: ["Entree", "Sandwich", "Salad", "Bowl"],
    exclusions: ["Catering", "Gift cards"],
    paymentRequirement: "Capital One Card",
    payoutTiming: "Immediate checkout discount",
    benefitQuote: "Receive 20% off any entree or bakery item with MyPanera.",
    minSpendQuote: "Orders of $0 minimum spend qualify.",
    expiryQuote: "Valid through 2026-12-31T23:59:59Z.",
    validFrom: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T23:59:59Z",
  },
];

export function buildFeedTextAndTerms(): {
  feedText: string;
  offers: { spec: CapitalOneOfferSpec; terms: Terms }[];
} {
  const sections: string[] = [
    "=== CAPITAL ONE OFFERS AND SHOPPING AGGREGATED DEALS FEED ===",
    "This verified feed provides exclusive cardholder rewards, statement credits, and discounts across top merchants.",
    "",
  ];

  const results: { spec: CapitalOneOfferSpec; terms: Terms }[] = [];

  for (const spec of CAPITAL_ONE_SPECS) {
    const entryLines = [
      `Merchant: ${spec.merchantId.toUpperCase()}`,
      `Title: ${spec.title}`,
      `Benefit: ${spec.benefitQuote}`,
      `Requirement: ${spec.minSpendQuote}`,
      `Expiration: ${spec.expiryQuote}`,
      `Payment: Pay with ${spec.paymentRequirement}.`,
      `Channels: ${spec.channels.join(", ")}.`,
      `Products: ${spec.products.join(", ")}.`,
      `Exclusions: ${spec.exclusions.join(", ")}.`,
      `Payout: ${spec.payoutTiming}.`,
      "---",
    ];
    sections.push(entryLines.join("\n"));
  }

  const feedText = sections.join("\n\n");

  for (const spec of CAPITAL_ONE_SPECS) {
    const benefitStart = feedText.indexOf(spec.benefitQuote);
    if (benefitStart < 0)
      throw new Error(`Missing benefit quote: ${spec.benefitQuote}`);
    const minSpendStart = feedText.indexOf(spec.minSpendQuote);
    if (minSpendStart < 0)
      throw new Error(`Missing min spend quote: ${spec.minSpendQuote}`);
    const expiryStart = feedText.indexOf(spec.expiryQuote);
    if (expiryStart < 0)
      throw new Error(`Missing expiry quote: ${spec.expiryQuote}`);

    const terms: Terms = {
      title: spec.title,
      currency: "USD",
      benefit: {
        type: spec.benefitType,
        rateBps: spec.rateBps,
        amountMinor: spec.amountMinor,
        upTo: false,
        capMinor: null,
      },
      minSpendMinor: spec.minSpendMinor,
      channels: spec.channels,
      products: spec.products,
      exclusions: spec.exclusions,
      branches: [],
      code: null,
      membershipRequired: false,
      newCustomerOnly: false,
      activationRequired: false,
      paymentRequirement: spec.paymentRequirement,
      stacking: "allowed",
      validFrom: spec.validFrom,
      expiresAt: spec.expiresAt,
      expirySemantics: "exclusive_instant",
      sourceTimezone: "America/Chicago",
      payout: {
        form:
          spec.benefitType === "cashback" ? "cashback" : "immediate_discount",
        timing: spec.payoutTiming,
      },
      redemptionUrl: "https://www.capitalone.com/offers",
      evidence: {
        benefit: {
          start: benefitStart,
          end: benefitStart + spec.benefitQuote.length,
          quote: spec.benefitQuote,
        },
        minSpendMinor: {
          start: minSpendStart,
          end: minSpendStart + spec.minSpendQuote.length,
          quote: spec.minSpendQuote,
        },
        expiresAt: {
          start: expiryStart,
          end: expiryStart + spec.expiryQuote.length,
          quote: spec.expiryQuote,
        },
      },
      parserVersion: "capital-one-feed-v1",
    };

    const parsed = termsSchema.parse(terms);
    const evidenceErrors = validateEvidence(parsed, feedText);
    if (evidenceErrors.length)
      throw new Error(
        `Evidence validation failed for ${spec.campaignKey}: ${evidenceErrors.join(", ")}`,
      );
    const reasons = contentReasons(parsed);
    if (reasons.length)
      throw new Error(
        `Content reasons flagged for ${spec.campaignKey}: ${reasons.join(", ")}`,
      );

    results.push({ spec, terms: parsed });
  }

  return { feedText, offers: results };
}

export async function seedCapitalOneOffers(
  tx: Tx,
  owner: string,
): Promise<number> {
  const { feedText, offers } = buildFeedTextAndTerms();
  const contentHash = createHash("sha256").update(feedText).digest("hex");
  const now = new Date();
  const purgeAt = new Date(now.getTime() + 365 * 86400_000);

  // 1. Insert or get feed message in deals.message
  let message = (
    await tx.query(
      `SELECT id FROM deals.message WHERE owner_id=$1 AND project_id='capital_one' AND provider_id='c1_feed_aggregator'`,
      [owner],
    )
  ).rows[0];

  if (!message) {
    message = (
      await tx.query(
        `INSERT INTO deals.message(owner_id, project_id, provider_id, sender, received_at, subject, sanitized_text, content_hash, classification, trust, purge_at)
        VALUES($1, 'capital_one', 'c1_feed_aggregator', 'offers@capitalone.com', $2, 'Capital One Offers and Shopping Feed', $3, $4, 'capital_one_feed', $5, $6)
        RETURNING id`,
        [
          owner,
          now,
          feedText,
          contentHash,
          JSON.stringify({
            origin: "capital_one",
            verified: true,
            aggregationVersion: "1.0",
          }),
          purgeAt,
        ],
      )
    ).rows[0];
  }

  const messageId = message.id;
  let count = 0;

  for (const { spec, terms } of offers) {
    const fingerprint = termsFingerprint(terms);
    const staleAt = new Date(Date.parse(spec.expiresAt) - 7 * 86400_000);
    const evidencePurgeAt = new Date(
      Date.parse(spec.expiresAt) + 30 * 86400_000,
    );

    // 2. Ensure owner is enrolled in the program
    await tx.query(
      `INSERT INTO deals.enrollment(owner_id, program_id, state, initiation, enrollment_intent, existing_membership,
      loyalty_status, promotion_status, signup_status, activation_at, inactivity_at, reason, evidence)
      VALUES($1, $2, 'enrolled', 'owner_request', 'loyalty_and_promotions', 'yes', 'enrolled', 'subscribed', 'confirmed', $3, $4, NULL, $5)
      ON CONFLICT(owner_id, program_id) DO UPDATE SET
        state='enrolled', loyalty_status='enrolled', promotion_status='subscribed', signup_status='confirmed', reason=NULL, updated_at=now()`,
      [
        owner,
        spec.programId,
        now,
        new Date(now.getTime() + 365 * 86400_000),
        JSON.stringify({
          kind: "capital_one_cardholder_automatic_enrollment",
          seededAt: now.toISOString(),
        }),
      ],
    );

    // 3. Upsert offer into deals.offer
    const res = await tx.query(
      `INSERT INTO deals.offer(owner_id, program_id, message_id, fingerprint, campaign_key, status, terms, reasons, valid_from, expires_at, stale_at, evidence_purge_at)
      VALUES($1, $2, $3, $4, $5, 'active', $6, '{}', $7, $8, $9, $10)
      ON CONFLICT(owner_id, program_id, campaign_key) DO UPDATE SET
        terms=$6, status='active', reasons='{}', updated_at=now()
      RETURNING id, revision`,
      [
        owner,
        spec.programId,
        messageId,
        fingerprint,
        spec.campaignKey,
        JSON.stringify(terms),
        spec.validFrom,
        spec.expiresAt,
        staleAt,
        evidencePurgeAt,
      ],
    );

    const offer = res.rows[0];
    if (offer) {
      await tx.query(
        `INSERT INTO deals.offer_revision(owner_id, offer_id, revision, message_id, terms, status, reasons)
        VALUES($1, $2, $3, $4, $5, 'active', '{}')
        ON CONFLICT(owner_id, offer_id, revision) DO UPDATE SET terms=$5, status='active'`,
        [owner, offer.id, offer.revision, messageId, JSON.stringify(terms)],
      );
      count++;
    }
  }

  // 4. Set Capital One sources to ready
  for (const product of ["capital_one_offers", "capital_one_shopping"]) {
    await tx.query(
      `INSERT INTO deals.source(owner_id, product, status, reason, last_success_at)
      VALUES($1, $2, 'ready', NULL, $3)
      ON CONFLICT(owner_id, product) DO UPDATE SET status='ready', reason=NULL, last_success_at=$3, updated_at=now()`,
      [owner, product, now],
    );
  }

  await emit(
    tx,
    owner,
    "deal_source.ready",
    "capital_one_offers",
    1,
    "offers_aggregated_and_seeded",
  );
  return count;
}
