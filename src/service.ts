import { randomBytes } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { calendarYearAfter, validateTimezone } from "./calendar.js";
import { type Config } from "./config.js";
import {
  type Purchase,
  type PurchaseContext,
  type Terms,
  reviewSchema,
} from "./contracts.js";
import { DomainError, emit, enqueue, tenant, type Tx } from "./db.js";
import {
  contentReasons,
  digest,
  extract,
  termsFingerprint,
  validateEvidence,
} from "./extraction.js";
import { evaluateOffer } from "./eligibility.js";
import { proposeWithNemotron } from "./nemotron.js";

export async function consent(
  tx: Tx,
  owner: string,
  cfg: Config,
  timezone: string,
  version: string,
) {
  validateTimezone(timezone);
  const { rows } = await tx.query(
    "SELECT * FROM deals.owner WHERE id=$1 FOR UPDATE",
    [owner],
  );
  if (!rows[0]) throw new DomainError("owner_not_found", 404);
  await tx.query(
    "UPDATE deals.owner SET timezone=$2,consent_version=$3,consent_at=now(),revoked_at=NULL WHERE id=$1",
    [owner, timezone, version],
  );
  await tx.query(
    `INSERT INTO deals.identity(owner_id,address,project_id) VALUES($1,$2,$3)
    ON CONFLICT(owner_id) DO UPDATE SET disabled_at=NULL`,
    [
      owner,
      `${randomBytes(18).toString("hex")}@${cfg.PHOTON_EMAIL_DOMAIN.toLowerCase()}`,
      cfg.PHOTON_PROJECT_ID ?? "unconfigured",
    ],
  );
  for (const product of [
    "photon_email",
    "capital_one_offers",
    "capital_one_shopping",
  ]) {
    const reason =
      product === "photon_email"
        ? "provider_readiness_unverified"
        : "no_permitted_free_acquisition_route";
    await tx.query(
      `INSERT INTO deals.source(owner_id,product,status,reason) VALUES($1,$2,'blocked',$3)
      ON CONFLICT(owner_id,product) DO UPDATE SET status='blocked',reason=$3,updated_at=now()`,
      [owner, product, reason],
    );
  }
  await enqueue(tx, owner, "reconcile", `consent:${version}:${Date.now()}`);
  await emit(tx, owner, "consent.changed", owner, 1, "granted");
}
export async function assertConsent(tx: Tx, owner: string, lock = false) {
  const { rows } = await tx.query(
    `SELECT * FROM deals.owner WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [owner],
  );
  if (!rows[0]?.consent_at || rows[0].revoked_at)
    throw new DomainError("deals_consent_required", 403);
  return rows[0];
}
export async function observePurchase(
  tx: Tx,
  owner: string,
  p: Purchase,
  now = new Date(),
) {
  const user = await assertConsent(tx, owner, true);
  if (Date.parse(p.occurredAt) > now.getTime() + 300_000)
    throw new DomainError("future_purchase_not_verified");
  const existing = await tx.query(
    "SELECT * FROM deals.purchase_observation WHERE owner_id=$1 AND transaction_id=$2 FOR UPDATE",
    [owner, p.transactionId],
  );
  if (existing.rows[0] && existing.rows[0].source_version >= p.sourceVersion)
    return { duplicate: true };
  const previousMerchant = existing.rows[0]?.merchant_id;
  await tx.query(
    `INSERT INTO deals.purchase_observation(owner_id,transaction_id,merchant_id,branch_id,occurred_at,status,provenance,source_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_id,transaction_id) DO UPDATE SET
    merchant_id=$3,branch_id=$4,occurred_at=$5,status=$6,provenance=$7,source_version=$8,imported_at=now()`,
    [
      owner,
      p.transactionId,
      p.merchantId,
      p.branchId ?? null,
      p.occurredAt,
      p.status,
      p.provenance,
      p.sourceVersion,
    ],
  );
  if (previousMerchant && previousMerchant !== p.merchantId)
    await updateEnrollmentFromPurchases(
      tx,
      owner,
      previousMerchant,
      user.timezone,
      now,
    );
  const result = await updateEnrollmentFromPurchases(
    tx,
    owner,
    p.merchantId,
    user.timezone,
    now,
  );
  return { duplicate: false, ...result };
}
async function updateEnrollmentFromPurchases(
  tx: Tx,
  owner: string,
  merchant: string,
  timezone: string,
  now: Date,
) {
  const program = (
    await tx.query("SELECT * FROM deals.program WHERE merchant_id=$1", [
      merchant,
    ])
  ).rows[0];
  if (!program)
    return { status: "unsupported", reason: "no_supported_merchant_program" };
  const last = (
    await tx.query(
      `SELECT max(occurred_at) AS last FROM deals.purchase_observation
    WHERE owner_id=$1 AND merchant_id=$2 AND status='posted' AND provenance='verified_import'`,
      [owner, merchant],
    )
  ).rows[0]?.last;
  let enrollment = (
    await tx.query(
      "SELECT * FROM deals.enrollment WHERE owner_id=$1 AND program_id=$2 FOR UPDATE",
      [owner, program.id],
    )
  ).rows[0];
  // Synthetic and Nessie sandbox observations never register real merchant accounts.
  if (!last && !enrollment)
    return {
      status: "recorded_test_only",
      reason: "sandbox_purchases_do_not_enroll",
    };
  if (!enrollment) {
    const deadline = calendarYearAfter(now, last, timezone);
    enrollment = (
      await tx.query(
        `INSERT INTO deals.enrollment(owner_id,program_id,state,activation_at,last_purchase_at,inactivity_at)
      VALUES($1,$2,'queued',$3,$4,$5) ON CONFLICT(owner_id,program_id) DO NOTHING RETURNING *`,
        [owner, program.id, now, last, deadline],
      )
    ).rows[0];
    await enqueue(tx, owner, "enroll", `${enrollment.id}:1`, {
      enrollmentId: enrollment.id,
    });
    await emit(
      tx,
      owner,
      "enrollment.changed",
      enrollment.id,
      1,
      "purchase_discovered",
    );
    return { status: "queued", enrollmentId: enrollment.id };
  }
  const deadline = calendarYearAfter(enrollment.activation_at, last, timezone);
  const returned =
    enrollment.suppressed_at &&
    last &&
    new Date(last) > new Date(enrollment.suppressed_at) &&
    !enrollment.opted_out_at;
  const row = (
    await tx.query(
      `UPDATE deals.enrollment SET last_purchase_at=$3,inactivity_at=$4,
    state=CASE WHEN $5 THEN 'queued' ELSE state END,suppressed_at=CASE WHEN $5 THEN NULL ELSE suppressed_at END,
    signup_status=CASE WHEN $5 THEN 'not_started' ELSE signup_status END,
    verification_started_at=CASE WHEN $5 THEN now() ELSE verification_started_at END,
    submitted_at=CASE WHEN $5 THEN NULL ELSE submitted_at END,
    existing_membership=CASE WHEN $5 AND loyalty_status IN ('existing','enrolled') THEN 'yes' ELSE existing_membership END,
    version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *`,
      [owner, enrollment.id, last, deadline, Boolean(returned)],
    )
  ).rows[0];
  if (returned)
    await enqueue(tx, owner, "enroll", `${row.id}:${row.version}`, {
      enrollmentId: row.id,
    });
  await emit(
    tx,
    owner,
    "enrollment.changed",
    row.id,
    row.version,
    returned ? "verified_return" : "purchase_updated",
  );
  return { status: row.state, enrollmentId: row.id };
}

export async function enrollmentHandoff(tx: Tx, owner: string, id: string) {
  await assertConsent(tx, owner, true);
  const e = (
    await tx.query(
      `SELECT e.*,p.signup_url,p.preferences_url,p.capabilities FROM deals.enrollment e
    JOIN deals.program p ON p.id=e.program_id WHERE e.owner_id=$1 AND e.id=$2 FOR UPDATE OF e`,
      [owner, id],
    )
  ).rows[0];
  if (!e || e.opted_out_at || e.suppressed_at) return;
  if (
    e.signup_status === "confirmed" ||
    ["verification_pending", "outcome_unknown"].includes(e.signup_status)
  )
    return;
  await tx.query(
    `UPDATE deals.enrollment SET state='needs_user_input',reason='complete_existing_membership_check_and_official_verification',
    signup_status='awaiting_user',verification_started_at=coalesce(verification_started_at,now()),
    version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2`,
    [owner, id],
  );
  // No speculative HTTP form submission: both registry entries require real identity/OTP and an observed outcome.
  await emit(
    tx,
    owner,
    "enrollment.changed",
    id,
    e.version + 1,
    "merchant_verification_required",
  );
}
export async function confirmEnrollment(
  tx: Tx,
  owner: string,
  id: string,
  input: {
    messageId: string;
    loyalty: "existing" | "enrolled" | "not_enrolled";
    promotions: boolean;
    senderVerified: true;
    existingMembershipChecked: true;
    expectedVersion: number;
  },
) {
  await assertConsent(tx, owner, true);
  const e = (
    await tx.query(
      "SELECT e.*,p.sender_domains FROM deals.enrollment e JOIN deals.program p ON p.id=e.program_id WHERE owner_id=$1 AND e.id=$2 FOR UPDATE OF e",
      [owner, id],
    )
  ).rows[0];
  if (!e) throw new DomainError("enrollment_not_found", 404);
  if (e.version !== input.expectedVersion)
    throw new DomainError("enrollment_version_conflict", 409);
  if (e.opted_out_at || e.suppressed_at)
    throw new DomainError("enrollment_suppressed", 409);
  const m = (
    await tx.query(
      "SELECT sender,received_at FROM deals.message WHERE owner_id=$1 AND id=$2",
      [owner, input.messageId],
    )
  ).rows[0];
  if (!m || !matchesDomain(m.sender, e.sender_domains))
    throw new DomainError("merchant_confirmation_evidence_required");
  if (
    new Date(m.received_at) <
    new Date(e.verification_started_at ?? e.activation_at)
  )
    throw new DomainError("confirmation_predates_current_registration", 409);
  if (input.loyalty === "not_enrolled" && !input.promotions)
    throw new DomainError("no_confirmed_enrollment_outcome");
  await tx.query(
    `UPDATE deals.enrollment SET state='enrolled',
    loyalty_status=CASE WHEN $3='not_enrolled' THEN loyalty_status ELSE $3 END,
    promotion_status=CASE WHEN $4 THEN 'subscribed' ELSE promotion_status END,reason=NULL,
    evidence=$5,signup_status='confirmed',existing_membership=CASE WHEN $3 IN ('existing','enrolled') THEN 'yes' ELSE existing_membership END,
    version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2`,
    [
      owner,
      id,
      input.loyalty,
      input.promotions,
      JSON.stringify({
        kind: "user_verified_merchant_message",
        messageId: input.messageId,
        confirmedAt: new Date().toISOString(),
        existingMembershipChecked: true,
        loyaltyOutcome: input.loyalty,
        promotionsConfirmed: input.promotions,
      }),
    ],
  );
  await emit(
    tx,
    owner,
    "enrollment.changed",
    id,
    e.version + 1,
    "merchant_evidence_confirmed",
  );
}
export function matchesDomain(sender: string, domains: string[]) {
  const domain = sender.toLowerCase().split("@")[1];
  return (
    !!domain && domains.some((d) => domain === d || domain.endsWith(`.${d}`))
  );
}

export async function processMessage(
  tx: Tx,
  owner: string,
  id: string,
  cfg: Config,
) {
  await assertConsent(tx, owner, true);
  const m = (
    await tx.query(
      "SELECT * FROM deals.message WHERE owner_id=$1 AND id=$2 FOR UPDATE",
      [owner, id],
    )
  ).rows[0];
  if (!m || new Date(m.purge_at) <= new Date()) return;
  if (!m.sanitized_text) {
    await tx.query(
      "UPDATE deals.message SET classification='needs_review' WHERE owner_id=$1 AND id=$2",
      [owner, id],
    );
    return;
  }
  const programs = (
    await tx.query(
      `SELECT p.*,e.suppressed_at,e.opted_out_at FROM deals.program p
    JOIN deals.enrollment e ON e.program_id=p.id WHERE e.owner_id=$1`,
      [owner],
    )
  ).rows;
  const matching = programs.filter((p) =>
    matchesDomain(m.sender, p.sender_domains),
  );
  if (
    matching.length !== 1 ||
    matching[0].suppressed_at ||
    matching[0].opted_out_at
  ) {
    await tx.query(
      "UPDATE deals.message SET classification=$3 WHERE owner_id=$1 AND id=$2",
      [owner, id, "unresolved_or_suppressed_sender"],
    );
    return;
  }
  const program = matching[0];
  const parsed = extract(m.sanitized_text, m.subject);
  let proposals = parsed.proposals;
  if (
    ["promotion", "newsletter"].includes(parsed.classification) &&
    (proposals.length === 0 ||
      proposals.some((t) => contentReasons(t).length > 0))
  ) {
    const model = await proposeWithNemotron(m.sanitized_text, cfg);
    if (model) proposals = model;
  }
  await tx.query(
    "UPDATE deals.message SET classification=$3 WHERE owner_id=$1 AND id=$2",
    [
      owner,
      id,
      m.trust.unreadable
        ? "needs_review"
        : proposals.length
          ? "promotion"
          : parsed.classification,
    ],
  );
  for (const terms of proposals)
    await saveProposal(tx, owner, program.id, m, terms);
}
async function saveProposal(
  tx: Tx,
  owner: string,
  program: string,
  message: any,
  terms: Terms,
) {
  const reasons = [
    ...validateEvidence(terms, message.sanitized_text),
    ...contentReasons(terms),
    "sender_authentication_requires_review",
    "terms_require_review",
  ];
  const fingerprint = digest({
    terms: termsFingerprint(terms),
    sourceText: message.sanitized_text.replace(/\s+/g, " ").trim(),
  });
  // No stable provider campaign ID exists in this contract. Exact fingerprints dedupe repeat deliveries;
  // revisions are explicit reviewed changes. Different rates/codes/expiries remain separate offers.
  const key = fingerprint;
  const expiry = terms.expiresAt;
  const stale = new Date(
    Math.min(
      Date.now() + 7 * 86400_000,
      new Date(message.received_at).getTime() + 7 * 86400_000,
    ),
  );
  const status =
    expiry && Date.parse(expiry) <= Date.now() ? "expired" : "needs_review";
  const result = await tx.query(
    `INSERT INTO deals.offer(owner_id,program_id,message_id,fingerprint,campaign_key,status,terms,reasons,valid_from,expires_at,stale_at,evidence_purge_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING *`,
    [
      owner,
      program,
      message.id,
      fingerprint,
      key,
      status,
      JSON.stringify(terms),
      reasons,
      terms.validFrom,
      expiry,
      stale,
      new Date(
        (expiry ? Date.parse(expiry) : stale.getTime()) + 30 * 86400_000,
      ),
    ],
  );
  const offer = result.rows[0];
  if (!offer) return;
  await tx.query(
    `INSERT INTO deals.offer_revision(owner_id,offer_id,revision,message_id,terms,status,reasons)
    VALUES($1,$2,1,$3,$4,$5,$6)`,
    [owner, offer.id, message.id, JSON.stringify(terms), status, reasons],
  );
  await emit(tx, owner, "offer.changed", offer.id, 1, "extracted_for_review");
}
export async function reviewOffer(
  tx: Tx,
  owner: string,
  id: string,
  input: z.infer<typeof reviewSchema>,
) {
  await assertConsent(tx, owner, true);
  const offer = (
    await tx.query(
      `SELECT o.*,m.sanitized_text FROM deals.offer o JOIN deals.message m ON m.id=o.message_id AND m.owner_id=o.owner_id
    WHERE o.owner_id=$1 AND o.id=$2 FOR UPDATE OF o`,
      [owner, id],
    )
  ).rows[0];
  if (!offer) throw new DomainError("offer_not_found", 404);
  if (offer.revision !== input.revision)
    throw new DomainError("offer_revision_conflict", 409);
  if (!offer.sanitized_text)
    throw new DomainError("source_content_retained_no_longer", 409);
  if (["withdrawn", "expired", "rejected"].includes(offer.status))
    throw new DomainError("offer_no_longer_reviewable", 409);
  const errors = validateEvidence(input.terms, offer.sanitized_text);
  if (errors.length) throw new DomainError("invalid_field_evidence");
  const reasons = contentReasons(input.terms);
  const expiry = input.terms.expiresAt;
  if (expiry && Date.parse(expiry) <= Date.now())
    throw new DomainError("offer_already_expired", 409);
  const state = reasons.length ? "needs_review" : "active";
  const revision = offer.revision + 1;
  await tx.query(
    `UPDATE deals.offer SET terms=$3,status=$4,reasons=$5,valid_from=$6,expires_at=$7,revision=$8,updated_at=now(),
    stale_at=now()+interval '7 days',evidence_purge_at=coalesce($7::timestamptz,now()+interval '7 days')+interval '30 days'
    WHERE owner_id=$1 AND id=$2`,
    [
      owner,
      id,
      JSON.stringify(input.terms),
      state,
      reasons,
      input.terms.validFrom,
      expiry,
      revision,
    ],
  );
  await tx.query(
    "INSERT INTO deals.offer_revision(owner_id,offer_id,revision,message_id,terms,status,reasons) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      owner,
      id,
      revision,
      offer.message_id,
      JSON.stringify(input.terms),
      state,
      reasons,
    ],
  );
  await tx.query(
    "DELETE FROM deals.eligibility WHERE owner_id=$1 AND offer_id=$2",
    [owner, id],
  );
  await emit(
    tx,
    owner,
    "offer.changed",
    id,
    revision,
    `reviewed:${digest(input.note).slice(0, 16)}`,
  );
  return { status: state, revision, reasons };
}
export async function candidates(
  tx: Tx,
  owner: string,
  context: PurchaseContext,
  asOf = new Date(),
) {
  await assertConsent(tx, owner);
  const offers = (
    await tx.query(
      `SELECT o.*,p.merchant_id FROM deals.offer o JOIN deals.program p ON p.id=o.program_id
    JOIN deals.enrollment e ON e.owner_id=o.owner_id AND e.program_id=o.program_id
    WHERE o.owner_id=$1 AND p.merchant_id=ANY($2) AND e.suppressed_at IS NULL AND e.opted_out_at IS NULL
    AND o.status NOT IN ('withdrawn','expired','rejected') ORDER BY o.created_at DESC LIMIT 200`,
      [owner, context.merchantIds],
    )
  ).rows;
  const result = [];
  for (const o of offers) {
    const eligibility = evaluateOffer(o, context, asOf);
    await tx.query(
      `INSERT INTO deals.eligibility(owner_id,offer_id,revision,context_hash,result,reasons) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(owner_id,offer_id,revision,context_hash) DO UPDATE SET result=$5,reasons=$6,evaluated_at=now()`,
      [
        owner,
        o.id,
        o.revision,
        digest(context),
        eligibility.result,
        eligibility.reasons,
      ],
    );
    result.push({
      ...o,
      eligibility,
      priceEvidence: null,
      affordability: "not_evaluated",
      audience: "private_owner",
    });
  }
  return result;
}
export async function suppressEnrollment(
  tx: Tx,
  owner: string,
  id: string,
  explicit: boolean,
  now = new Date(),
) {
  const e = (
    await tx.query(
      "SELECT * FROM deals.enrollment WHERE owner_id=$1 AND id=$2 FOR UPDATE",
      [owner, id],
    )
  ).rows[0];
  if (!e) throw new DomainError("enrollment_not_found", 404);
  if (!explicit && new Date(e.inactivity_at) > now) return;
  if (e.suppressed_at && (!explicit || e.opted_out_at)) return;
  const row = (
    await tx.query(
      `UPDATE deals.enrollment SET suppressed_at=$3,opted_out_at=CASE WHEN $4 THEN $3 ELSE opted_out_at END,
    state='unsubscribe_pending',promotion_status='unsubscribe_pending',version=version+1,reason='external_unsubscribe_requires_confirmation',updated_at=now()
    WHERE owner_id=$1 AND id=$2 RETURNING *`,
      [owner, id, now, explicit],
    )
  ).rows[0];
  const offers = (
    await tx.query(
      `UPDATE deals.offer SET status='withdrawn',reasons=ARRAY['enrollment_suppressed'],revision=revision+1,updated_at=now()
    WHERE owner_id=$1 AND program_id=$2 AND status<>'withdrawn' RETURNING *`,
      [owner, e.program_id],
    )
  ).rows;
  for (const o of offers) {
    await saveLifecycleRevision(tx, o);
    await emit(
      tx,
      owner,
      "offer.withdrawn",
      o.id,
      o.revision,
      "enrollment_suppressed",
    );
  }
  await enqueue(tx, owner, "unsubscribe", `${id}:${row.version}`, {
    enrollmentId: id,
    version: row.version,
  });
  await emit(
    tx,
    owner,
    "enrollment.changed",
    id,
    row.version,
    explicit ? "user_opt_out" : "calendar_year_inactivity",
  );
}
export async function unsubscribeHandoff(
  tx: Tx,
  owner: string,
  id: string,
  version: number,
) {
  // Purchases and cleanup share the owner lock. A returning purchase invalidates old unsubscribe work.
  await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [owner]);
  const e = (
    await tx.query(
      "SELECT * FROM deals.enrollment WHERE owner_id=$1 AND id=$2 FOR UPDATE",
      [owner, id],
    )
  ).rows[0];
  if (!e || e.version !== version || !e.suppressed_at) return;
  // No verified merchant unsubscribe API is available. Keep pending, expose official preferences URL.
  await tx.query(
    "UPDATE deals.enrollment SET reason='open_official_preferences_and_confirm_unsubscribe',updated_at=now() WHERE owner_id=$1 AND id=$2",
    [owner, id],
  );
}
export async function confirmUnsubscribe(
  tx: Tx,
  owner: string,
  id: string,
  expectedVersion: number,
) {
  await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [owner]);
  const row = (
    await tx.query(
      `UPDATE deals.enrollment SET promotion_status='unsubscribed',state='unsubscribed',reason='user_confirmed_external_unsubscribe',
    version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 AND version=$3 AND suppressed_at IS NOT NULL RETURNING *`,
      [owner, id, expectedVersion],
    )
  ).rows[0];
  if (!row) throw new DomainError("unsubscribe_not_pending", 409);
  await emit(
    tx,
    owner,
    "enrollment.changed",
    id,
    row.version,
    "user_confirmed_external_unsubscribe",
  );
}
export async function resumeEnrollment(tx: Tx, owner: string, id: string) {
  await assertConsent(tx, owner, true);
  const row = (
    await tx.query(
      `UPDATE deals.enrollment SET opted_out_at=NULL,suppressed_at=NULL,state='queued',version=version+1,
    signup_status='not_started',submitted_at=NULL,verification_started_at=now(),
    existing_membership=CASE WHEN loyalty_status IN ('existing','enrolled') THEN 'yes' ELSE existing_membership END,
    activation_at=now(),reason=NULL,updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *`,
      [owner, id],
    )
  ).rows[0];
  if (!row) throw new DomainError("enrollment_not_found", 404);
  const timezone = (
    await tx.query("SELECT timezone FROM deals.owner WHERE id=$1", [owner])
  ).rows[0].timezone;
  await tx.query(
    "UPDATE deals.enrollment SET inactivity_at=$3 WHERE owner_id=$1 AND id=$2",
    [
      owner,
      id,
      calendarYearAfter(row.activation_at, row.last_purchase_at, timezone),
    ],
  );
  await enqueue(tx, owner, "enroll", `${id}:${row.version}`, {
    enrollmentId: id,
  });
  await emit(
    tx,
    owner,
    "enrollment.changed",
    id,
    row.version,
    "explicit_resume",
  );
}
async function saveLifecycleRevision(tx: Tx, o: any) {
  await tx.query(
    "INSERT INTO deals.offer_revision(owner_id,offer_id,revision,message_id,terms,status,reasons) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      o.owner_id,
      o.id,
      o.revision,
      o.message_id,
      JSON.stringify(o.terms),
      o.status,
      o.reasons,
    ],
  );
  await tx.query(
    "DELETE FROM deals.eligibility WHERE owner_id=$1 AND offer_id=$2",
    [o.owner_id, o.id],
  );
}
export async function maintenance(tx: Tx, owner: string, now = new Date()) {
  await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [owner]);
  const due = (
    await tx.query(
      "SELECT id FROM deals.enrollment WHERE owner_id=$1 AND inactivity_at<=$2 AND suppressed_at IS NULL",
      [owner, now],
    )
  ).rows;
  for (const e of due) await suppressEnrollment(tx, owner, e.id, false, now);
  const offers = (
    await tx.query(
      `UPDATE deals.offer SET status=CASE WHEN expires_at<=$2 THEN 'expired' ELSE 'stale' END,
    revision=revision+1,updated_at=now() WHERE owner_id=$1 AND status IN ('active','needs_review','pending_extraction')
    AND (expires_at<=$2 OR stale_at<=$2) RETURNING *`,
      [owner, now],
    )
  ).rows;
  for (const o of offers) {
    await saveLifecycleRevision(tx, o);
    await emit(
      tx,
      owner,
      o.status === "expired" ? "offer.expired" : "offer.changed",
      o.id,
      o.revision,
      o.status,
    );
  }
  await tx.query(
    "UPDATE deals.message SET sanitized_text=NULL,subject='' WHERE owner_id=$1 AND purge_at<=$2 AND sanitized_text IS NOT NULL",
    [owner, now],
  );
  // Evidence, personalized codes and URLs are purged together after validity+30 days (unknown: 37 days).
  const purged = (
    await tx.query(
      `SELECT id FROM deals.offer WHERE owner_id=$1 AND evidence_purge_at<=$2 AND terms<>'{}'::jsonb`,
      [owner, now],
    )
  ).rows;
  for (const o of purged) {
    const removed = (
      await tx.query(
        "UPDATE deals.offer SET terms='{}',status='withdrawn',reasons=ARRAY['retention_purged'],revision=revision+1 WHERE owner_id=$1 AND id=$2 RETURNING revision",
        [owner, o.id],
      )
    ).rows[0];
    await tx.query(
      "UPDATE deals.offer_revision SET terms='{}' WHERE owner_id=$1 AND offer_id=$2",
      [owner, o.id],
    );
    await emit(
      tx,
      owner,
      "offer.withdrawn",
      o.id,
      removed.revision,
      "retention_purged",
    );
  }
  await tx.query(
    "DELETE FROM deals.eligibility WHERE owner_id=$1 AND evaluated_at<$2::timestamptz-interval '30 days'",
    [owner, now],
  );
  await tx.query(
    `UPDATE deals.job SET state='dead',last_error='lease_exhausted',lease_token=NULL,lease_until=NULL
    WHERE owner_id=$1 AND state='running' AND lease_until<=$2 AND attempts>=max_attempts`,
    [owner, now],
  );
  // Minimal replay/lifecycle metadata is retained for 400 days. No raw email body is persisted.
  await tx.query(
    "DELETE FROM deals.event WHERE owner_id=$1 AND created_at<$2::timestamptz-interval '400 days'",
    [owner, now],
  );
  await tx.query(
    "DELETE FROM deals.job WHERE owner_id=$1 AND state IN ('completed','cancelled') AND created_at<$2::timestamptz-interval '400 days'",
    [owner, now],
  );
}
export async function withdrawConsent(tx: Tx, owner: string) {
  await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [owner]);
  await tx.query("UPDATE deals.owner SET revoked_at=now() WHERE id=$1", [
    owner,
  ]);
  await tx.query(
    "UPDATE deals.identity SET disabled_at=now() WHERE owner_id=$1",
    [owner],
  );
  await tx.query(
    "UPDATE deals.source SET status='revoked',reason='consent_withdrawn',cursor='{}',updated_at=now() WHERE owner_id=$1",
    [owner],
  );
  await tx.query(
    "UPDATE deals.job SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE owner_id=$1 AND state IN ('queued','running')",
    [owner],
  );
  const enrollments = (
    await tx.query("SELECT id FROM deals.enrollment WHERE owner_id=$1", [owner])
  ).rows;
  for (const e of enrollments) await suppressEnrollment(tx, owner, e.id, true);
  await deleteContent(tx, owner);
  await emit(tx, owner, "consent.changed", owner, 1, "withdrawn");
}
export async function deleteContent(tx: Tx, owner: string) {
  await tx.query(
    "UPDATE deals.message SET sanitized_text=NULL,subject='',sender='[deleted]',trust='{}' WHERE owner_id=$1",
    [owner],
  );
  await tx.query(
    "UPDATE deals.offer SET terms='{}',status='withdrawn',reasons=ARRAY['consent_withdrawn'] WHERE owner_id=$1",
    [owner],
  );
  await tx.query(
    "UPDATE deals.offer_revision SET terms='{}' WHERE owner_id=$1",
    [owner],
  );
  await tx.query(
    "UPDATE deals.enrollment SET evidence='{}' WHERE owner_id=$1",
    [owner],
  );
  await tx.query("DELETE FROM deals.eligibility WHERE owner_id=$1", [owner]);
}
export async function bootstrapOwner(
  pool: pg.Pool,
  id: string,
  timezone: string,
) {
  validateTimezone(timezone);
  return tenant(pool, id, async (tx) => {
    await tx.query(
      "INSERT INTO deals.owner(id,timezone) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
      [id, timezone],
    );
  });
}
