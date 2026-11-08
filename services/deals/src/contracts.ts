import { z } from "zod";
export const iso = z.iso.datetime({ offset: true });
export const purchaseSchema = z
  .object({
    transactionId: z.string().min(1).max(200),
    merchantId: z.string().min(1).max(100),
    branchId: z.string().max(200).optional(),
    occurredAt: iso,
    status: z.enum(["posted", "pending", "refunded", "cancelled"]),
    provenance: z.enum(["nessie_sandbox", "verified_import", "synthetic_test"]),
    sourceVersion: z.number().int().positive().default(1),
  })
  .strict();
export type Purchase = z.infer<typeof purchaseSchema>;
export const enrollmentRequestSchema = z
  .object({
    programId: z.string().min(1).max(100),
    initiation: z
      .enum(["owner_request", "store_selection"])
      .default("owner_request"),
    existingMembership: z.enum(["unknown", "yes", "no"]),
    intent: z
      .enum(["loyalty_and_promotions", "promotions_only"])
      .default("loyalty_and_promotions"),
  })
  .strict();
export const enrollmentAttemptSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    outcome: z.enum(["opened", "submitted", "uncertain"]),
    existingMembershipChecked: z.literal(true),
  })
  .strict();
export const spanSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(2000),
  })
  .strict();
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const termsSchema = z
  .object({
    title: z.string().min(1).max(200),
    currency: z.literal("USD"),
    benefit: z
      .object({
        type: z.enum([
          "percent",
          "fixed_discount",
          "fixed_price",
          "cashback",
          "points",
          "gift_card",
          "bogo",
          "unsupported",
        ]),
        amountMinor: money.nullable(),
        rateBps: z.number().int().min(1).max(10000).nullable(),
        upTo: z.boolean(),
        capMinor: money.nullable(),
      })
      .strict(),
    minSpendMinor: money.nullable(),
    channels: z
      .array(z.enum(["online", "in_store", "in_app", "pickup"]))
      .max(4),
    products: z.array(z.string().max(200)).max(30),
    exclusions: z.array(z.string().max(500)).max(30),
    branches: z.array(z.string().max(200)).max(30),
    code: z.string().max(100).nullable(),
    membershipRequired: z.boolean().nullable(),
    newCustomerOnly: z.boolean().nullable(),
    activationRequired: z.boolean().nullable(),
    paymentRequirement: z.string().max(200).nullable(),
    stacking: z.enum(["allowed", "prohibited", "unknown"]),
    validFrom: iso.nullable(),
    expiresAt: iso.nullable(),
    expirySemantics: z.enum(["exclusive_instant", "date_only", "unknown"]),
    sourceTimezone: z.string().max(100).nullable(),
    payout: z
      .object({
        form: z.enum([
          "immediate_discount",
          "cashback",
          "points",
          "gift_card",
          "unknown",
        ]),
        timing: z.string().max(500).nullable(),
      })
      .strict(),
    redemptionUrl: z.url().max(2048).nullable(),
    evidence: z.record(z.string(), spanSchema),
    parserVersion: z.string().max(100),
  })
  .strict();
export type Terms = z.infer<typeof termsSchema>;
export const purchaseContextSchema = z
  .object({
    merchantIds: z.array(z.string().min(1).max(100)).min(1).max(50),
    channel: z.enum(["online", "in_store", "in_app", "pickup"]),
    branchId: z.string().max(200).optional(),
    eligibleSpendMinor: money.optional(),
    product: z.string().max(200).optional(),
    membershipVerified: z.boolean().optional(),
    newCustomerVerified: z.boolean().optional(),
    activationVerified: z.boolean().optional(),
    paymentMethod: z.string().max(200).optional(),
    useWithOtherOffers: z.boolean().default(false),
  })
  .strict();
export type PurchaseContext = z.infer<typeof purchaseContextSchema>;
export const reviewSchema = z
  .object({
    revision: z.number().int().positive(),
    terms: termsSchema,
    senderVerified: z.literal(true),
    evidenceConfirmed: z.literal(true),
    note: z.string().min(10).max(500),
  })
  .strict();
