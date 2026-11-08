import { contentReasons } from "./extraction.js";
import type { PurchaseContext, Terms } from "./contracts.js";
export type Eligibility = {
  result: "eligible" | "ineligible" | "unknown";
  reasons: string[];
  requiredActions: string[];
};
export function evaluateOffer(
  offer: {
    status: string;
    terms: Terms;
    expires_at: Date | string | null;
    valid_from: Date | string | null;
    stale_at: Date | string;
  },
  context: PurchaseContext,
  asOf = new Date(),
): Eligibility {
  const no: string[] = [],
    unknown: string[] = [],
    actions: string[] = [];
  const t = offer.terms,
    now = asOf.getTime();
  if (offer.status !== "active") no.push(`offer_${offer.status}`);
  if (offer.expires_at && new Date(offer.expires_at).getTime() <= now)
    no.push("expired");
  if (new Date(offer.stale_at).getTime() <= now) no.push("stale");
  if (offer.valid_from && new Date(offer.valid_from).getTime() > now)
    no.push("not_started");
  unknown.push(...contentReasons(t));
  if (t.channels.length && !t.channels.includes(context.channel))
    no.push("channel_mismatch");
  if (
    t.branches.length &&
    (!context.branchId || !t.branches.includes(context.branchId))
  )
    no.push("branch_not_verified");
  if (t.products.length && !context.product)
    unknown.push("purchase_intent_unknown");
  else if (
    t.products.length &&
    !t.products.includes("*") &&
    !t.products.some((p) => p.toLowerCase() === context.product?.toLowerCase())
  )
    no.push("product_mismatch");
  // Exclusions remain conservative: the caller must narrow to a reviewed, explicitly eligible product.
  if (t.exclusions.length && t.products.includes("*"))
    unknown.push("exclusions_need_verification");
  if (
    context.product &&
    t.exclusions.some((p) => p.toLowerCase() === context.product?.toLowerCase())
  )
    no.push("excluded_product");
  if (t.minSpendMinor !== null) {
    if (context.eligibleSpendMinor === undefined)
      unknown.push("eligible_spend_unknown");
    else if (context.eligibleSpendMinor < t.minSpendMinor)
      no.push("minimum_spend");
  }
  if (t.membershipRequired && !context.membershipVerified) {
    unknown.push("membership_unverified");
    actions.push("verify_membership");
  }
  if (t.newCustomerOnly && !context.newCustomerVerified)
    unknown.push("new_customer_unverified");
  if (t.activationRequired && !context.activationVerified) {
    unknown.push("activation_unverified");
    actions.push("activate_at_source");
  }
  if (t.paymentRequirement && context.paymentMethod !== t.paymentRequirement)
    unknown.push("payment_method_unverified");
  if (context.useWithOtherOffers && t.stacking !== "allowed")
    no.push("stacking_not_allowed");
  if (t.code) actions.push("apply_private_code");
  return {
    result: no.length ? "ineligible" : unknown.length ? "unknown" : "eligible",
    reasons: [...new Set([...no, ...unknown])],
    requiredActions: actions,
  };
}
