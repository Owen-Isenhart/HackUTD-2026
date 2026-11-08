import { calendarYearAfter } from "./calendar.js";
import { DomainError, emit, enqueue, type Tx } from "./db.js";
import type { z } from "zod";
import type {
  enrollmentRequestSchema,
  enrollmentAttemptSchema,
} from "./contracts.js";

async function authorizedOwner(tx: Tx, owner: string) {
  const user = (
    await tx.query("SELECT * FROM deals.owner WHERE id=$1 FOR UPDATE", [owner])
  ).rows[0];
  if (!user?.consent_at || user.revoked_at)
    throw new DomainError("deals_consent_required", 403);
  return user;
}
/** Explicit enrollment is distinct from an imported purchase; never fabricate a transaction. */
export async function requestEnrollment(
  tx: Tx,
  owner: string,
  input: z.input<typeof enrollmentRequestSchema>,
) {
  const user = await authorizedOwner(tx, owner);
  const program = (
    await tx.query("SELECT * FROM deals.program WHERE id=$1", [input.programId])
  ).rows[0];
  if (program?.kind === "card_linked_offer" || program?.paid_membership)
    throw new DomainError("not_a_free_loyalty_program", 422);
  if (!program) throw new DomainError("unsupported_merchant_program", 422);
  let enrollment = (
    await tx.query(
      "SELECT * FROM deals.enrollment WHERE owner_id=$1 AND program_id=$2 FOR UPDATE",
      [owner, program.id],
    )
  ).rows[0];
  if (enrollment) {
    if (enrollment.opted_out_at || enrollment.suppressed_at)
      throw new DomainError("explicit_resume_required", 409);
    // Replayed requests must not reset the inactivity year, verification clock, or external outcome.
    return enrollment;
  }
  const now = new Date();
  enrollment = (
    await tx.query(
      `INSERT INTO deals.enrollment(owner_id,program_id,state,initiation,enrollment_intent,existing_membership,
    activation_at,inactivity_at,signup_status,verification_started_at,reason)
    VALUES($1,$2,'queued',$8,$3,$4,$5,$6,'not_started',$5,$7) RETURNING *`,
      [
        owner,
        program.id,
        input.intent,
        input.existingMembership,
        now,
        calendarYearAfter(now, null, user.timezone),
        input.existingMembership === "unknown"
          ? "check_existing_membership_before_signup"
          : "merchant_verification_required",
        input.initiation ?? "owner_request",
      ],
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
    "owner_requested_enrollment",
  );
  return enrollment;
}
export async function enrollmentFlow(tx: Tx, owner: string, id: string) {
  const e = (
    await tx.query(
      `SELECT e.*,p.name,p.signup_url,p.preferences_url,p.capabilities,p.policy_evidence,i.address,o.first_name
    FROM deals.enrollment e JOIN deals.program p ON p.id=e.program_id JOIN deals.identity i ON i.owner_id=e.owner_id JOIN deals.owner o ON o.id=e.owner_id
    WHERE e.owner_id=$1 AND e.id=$2`,
      [owner, id],
    )
  ).rows[0];
  if (!e) throw new DomainError("enrollment_not_found", 404);
  const suspended = !!e.suppressed_at || !!e.opted_out_at;
  const uncertain = ["verification_pending", "outcome_unknown"].includes(
    e.signup_status,
  );
  const action = suspended
    ? e.promotion_status === "unsubscribed"
      ? "resume_requires_explicit_consent"
      : "complete_unsubscribe"
    : e.state === "enrolled"
      ? e.promotion_status === "subscribed"
        ? "manage_membership"
        : "complete_promotional_subscription"
      : uncertain
        ? "verify_existing_outcome"
        : e.existing_membership === "unknown"
          ? "check_existing_membership"
          : e.existing_membership === "yes"
            ? "update_existing_preferences"
            : "complete_signup";
  return {
    enrollmentId: e.id,
    version: e.version,
    merchant: e.name,
    state: e.state,
    signupStatus: e.signup_status,
    intent: e.enrollment_intent,
    existingMembership: e.existing_membership,
    promotionalAddress: e.address,
    firstName: e.first_name,
    copyFields: [
      { name: "email", value: e.address },
      ...(e.first_name ? [{ name: "firstName", value: e.first_name }] : []),
    ],
    nextAction: action,
    url: action === "complete_signup" ? e.signup_url : e.preferences_url,
    termsUrl: e.policy_evidence.url,
    requiredInputs: e.capabilities.requires ?? [],
    verificationStartedAt: e.verification_started_at ?? e.activation_at,
    submittedAt: e.submitted_at,
    simulated: e.simulated,
    externalOutcome: e.simulated
      ? "simulated_demo_signup"
      : e.signup_status === "confirmed"
        ? "user_verified_merchant_evidence"
        : "unconfirmed",
    safeToCreateAccount:
      action === "complete_signup" && !suspended && !uncertain,
    loyaltyStatus: e.loyalty_status,
    promotionStatus: e.promotion_status,
    instructions:
      action === "complete_signup"
        ? [
            `1. Open merchant signup: ${e.signup_url}`,
            `2. Use your private alias for email: ${e.address}`,
            "3. Enter your name and mobile number, and enter the SMS verification code sent to your phone.",
            "4. Once submitted, our background worker will automatically detect your confirmation email and activate your deals.",
          ]
        : action === "update_existing_preferences"
          ? [
              `1. Open merchant preferences: ${e.preferences_url}`,
              `2. Update your email to your private alias: ${e.address}`,
              "3. We will automatically capture merchant promotions and sync them to your account.",
            ]
          : null,
  };
}
export async function setExistingMembership(
  tx: Tx,
  owner: string,
  id: string,
  expectedVersion: number,
  value: "yes" | "no",
) {
  await authorizedOwner(tx, owner);
  const e = (
    await tx.query(
      "SELECT * FROM deals.enrollment WHERE owner_id=$1 AND id=$2 FOR UPDATE",
      [owner, id],
    )
  ).rows[0];
  if (!e) throw new DomainError("enrollment_not_found", 404);
  if (e.version !== expectedVersion)
    throw new DomainError("enrollment_version_conflict", 409);
  if (e.suppressed_at || e.opted_out_at)
    throw new DomainError("explicit_resume_required", 409);
  if (
    e.state === "enrolled" ||
    ["verification_pending", "outcome_unknown"].includes(e.signup_status)
  )
    throw new DomainError("reconcile_existing_outcome_first", 409);
  const row = (
    await tx.query(
      `UPDATE deals.enrollment SET existing_membership=$3,signup_status='awaiting_user',
    verification_started_at=coalesce(verification_started_at,now()),reason='merchant_verification_required',version=version+1,updated_at=now()
    WHERE owner_id=$1 AND id=$2 RETURNING *`,
      [owner, id, value],
    )
  ).rows[0];
  await emit(
    tx,
    owner,
    "enrollment.changed",
    id,
    row.version,
    "existing_membership_checked",
  );
  return enrollmentFlow(tx, owner, id);
}
export async function recordEnrollmentAttempt(
  tx: Tx,
  owner: string,
  id: string,
  input: z.infer<typeof enrollmentAttemptSchema>,
) {
  await authorizedOwner(tx, owner);
  const e = (
    await tx.query(
      "SELECT * FROM deals.enrollment WHERE owner_id=$1 AND id=$2 FOR UPDATE",
      [owner, id],
    )
  ).rows[0];
  if (!e) throw new DomainError("enrollment_not_found", 404);
  if (e.version !== input.expectedVersion)
    throw new DomainError("enrollment_version_conflict", 409);
  if (e.suppressed_at || e.opted_out_at)
    throw new DomainError("explicit_resume_required", 409);
  if (e.existing_membership === "unknown")
    throw new DomainError("existing_membership_check_required", 409);
  if (e.state === "enrolled") return enrollmentFlow(tx, owner, id);
  if (["verification_pending", "outcome_unknown"].includes(e.signup_status))
    throw new DomainError("reconcile_existing_outcome_first", 409);
  const status =
    input.outcome === "opened"
      ? "awaiting_user"
      : input.outcome === "submitted"
        ? "verification_pending"
        : "outcome_unknown";
  const row = (
    await tx.query(
      `UPDATE deals.enrollment SET signup_status=$3,state='needs_user_input',
    submitted_at=CASE WHEN $4 THEN now() ELSE submitted_at END,verification_started_at=coalesce(verification_started_at,now()),
    reason=$5,version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *`,
      [
        owner,
        id,
        status,
        input.outcome !== "opened",
        input.outcome === "opened"
          ? "complete_merchant_verification"
          : "verify_merchant_outcome_before_retry",
      ],
    )
  ).rows[0];
  await emit(
    tx,
    owner,
    "enrollment.changed",
    id,
    row.version,
    `merchant_attempt_${input.outcome}`,
  );
  return enrollmentFlow(tx, owner, id);
}
