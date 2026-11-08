// The policy gateway: one checkpoint that decides whether an action may go
// ahead when it was proposed by Nemotron, caused by an incoming text or email,
// or requested by the app.
//
// Nemotron reads untrusted messages and proposes structured facts. It is never
// the authority. This module decides in plain code, from facts the server
// supplies: the owner (from the session or the text store's configured owner,
// never from model output or a request body), which part of the system asked
// (the origin), who the content came from (the source), and the action. The
// model cannot add an action, raise a source's authority, name an owner or
// approve its own proposal.
//
// Decisions are ALLOW, DENY (with a reason code) or REQUIRE_APPROVAL. In this
// prototype REQUIRE_APPROVAL means pending only: nothing is stored or run.
// Every decision goes to an in-memory audit list that never holds parameters,
// message text, prompts, phone numbers or keys. See docs/security-mvp-plan.md.
const { randomUUID } = require('node:crypto');
const { KINDS, BASES, CATEGORIES, CONFIDENCE, dayNumberOf } = require('./text-obligations');

const POLICY_VERSION = 'security-mvp-2026-11-08';

// Which part of our system is asking.
const ORIGINS = new Set(['app', 'provider_event', 'scheduler', 'agent_proposal']);
// Who the content came from. Any text or email is untrusted_external, even the user's own.
const SOURCES = new Set(['authenticated_user', 'verified_provider', 'untrusted_external']);

// The same ceiling the app already applies to a confirmed text plan (validUserEdit).
const MAX_EXTRACTED_CENTS = 10_000_000;
const AUDIT_LIMIT = 1000;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const nullOr = (check) => (value) => value === null || check(value);
const validOwner = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;

/** True when the object has exactly these fields: none missing, none extra. */
function hasExactly(params, fields) {
  if (!isRecord(params)) return false;
  return Object.keys(params).length === fields.length && fields.every((field) => Object.hasOwn(params, field));
}

// The fields validateInterpretation (text-obligations.js) produces for a real proposal.
const OBLIGATION_FIELDS = ['kind', 'category', 'statedAmountCents', 'amountBasis', 'participantCount',
  'shareCents', 'dueDate', 'dateBasis', 'confidence', 'evidence', 'senderRole', 'channel'];
const PROPOSED_KINDS = KINDS.filter((kind) => kind !== 'none' && kind !== 'already_paid');

function validObligation(p) {
  return hasExactly(p, OBLIGATION_FIELDS)
    && PROPOSED_KINDS.includes(p.kind) && CATEGORIES.includes(p.category)
    && BASES.includes(p.amountBasis) && CONFIDENCE.includes(p.confidence)
    && nullOr(isCount)(p.statedAmountCents) && nullOr(isCount)(p.shareCents)
    && nullOr((n) => Number.isSafeInteger(n) && n >= 2 && n <= 20)(p.participantCount)
    && nullOr((date) => dayNumberOf(date) !== null)(p.dueDate)
    && [null, 'stated', 'payable_now'].includes(p.dateBasis)
    && typeof p.evidence === 'string' && p.evidence.length <= 200
    && ['owner', 'participant'].includes(p.senderRole) && ['text', 'email'].includes(p.channel);
}

// "set" writes a limit; "release" hands a user budget back to the derived one.
function validBudgetChange(p) {
  if (!isRecord(p) || typeof p.category !== 'string' || !/^[a-z_]{1,64}$/.test(p.category) || !isCount(p.version)) return false;
  if (p.change === 'release') return hasExactly(p, ['category', 'change', 'version']);
  return p.change === 'set' && hasExactly(p, ['category', 'change', 'version', 'period', 'limitCents'])
    && ['week', 'month'].includes(p.period) && isCount(p.limitCents);
}

// The closed list of actions. A name that is not here is refused. Raw SQL,
// sending email or texts, fetching URLs and running shell commands are left
// off on purpose, so nothing can ask for them.
const ACTIONS = new Map([
  ['extract_obligation', {
    riskTier: 'R0',
    // Proposal only. The deterministic checks in text-obligations.js and the
    // user's own confirmation still decide what counts in the forecast.
    origins: ['provider_event'],
    sources: ['untrusted_external', 'verified_provider'],
    valid: validObligation,
    withinLimits: (p) => [p.statedAmountCents, p.shareCents].every((cents) => cents === null || cents <= MAX_EXTRACTED_CENTS),
    decision: 'ALLOW',
  }],
  ['propose_budget_change', {
    riskTier: 'R3',
    // A signed-in user or verified provider may suggest a change; a text or email may not.
    origins: [...ORIGINS],
    sources: ['authenticated_user', 'verified_provider'],
    valid: validBudgetChange,
    decision: 'REQUIRE_APPROVAL',
  }],
  ['apply_budget_change', {
    riskTier: 'R3',
    // Only the app's own budget editor: an explicit, versioned save by the signed-in owner.
    origins: ['app'],
    sources: ['authenticated_user'],
    valid: validBudgetChange,
    decision: 'ALLOW',
  }],
]);

/** Keeps decisions only. Each record has the same fixed fields; nothing from the request body. */
function createAuditLog({ limit = AUDIT_LIMIT } = {}) {
  const events = [];
  return {
    record(e) {
      events.push(Object.freeze({
        requestId: e.requestId, occurredAt: e.occurredAt, ownerId: e.ownerId, origin: e.origin,
        sourceTrust: e.sourceTrust, action: e.action, riskTier: e.riskTier, decision: e.decision,
        reasonCode: e.reasonCode, policyVersion: e.policyVersion,
      }));
      if (events.length > limit) events.splice(0, events.length - limit);
    },
    /** Newest first, and only this owner's decisions. */
    list(ownerId, max = 100) {
      if (!validOwner(ownerId)) return [];
      return events.filter((e) => e.ownerId === ownerId).slice(-max).reverse();
    },
  };
}

function createActionGateway({ audit = createAuditLog(), clock = () => new Date() } = {}) {
  // Checks run in the plan's order and stop at the first failure.
  function decide({ principal, origin, sourceTrust, action, params, targetOwnerId }) {
    const definition = typeof action === 'string' && ACTIONS.has(action) ? ACTIONS.get(action) : null;
    const deny = (reasonCode) => ({ decision: 'DENY', reasonCode, riskTier: definition?.riskTier ?? null });
    if (!validOwner(principal?.ownerId)) return deny('DENY_NO_PRINCIPAL');
    if (!definition) return deny('DENY_UNKNOWN_ACTION');
    if (!definition.valid(params)) return deny('DENY_BAD_ARGUMENTS');
    // Callers that resolved a stored record pass its owner; anything but an exact match is refused.
    if (targetOwnerId !== undefined && targetOwnerId !== principal.ownerId) return deny('DENY_OWNER_MISMATCH');
    if (!ORIGINS.has(origin) || !SOURCES.has(sourceTrust)
      || !definition.origins.includes(origin) || !definition.sources.includes(sourceTrust)) return deny('DENY_SOURCE_AUTHORITY');
    if (definition.withinLimits && !definition.withinLimits(params)) return deny('DENY_CONSTRAINT');
    return { decision: definition.decision, reasonCode: null, riskTier: definition.riskTier };
  }

  /** Returns { requestId, policyVersion, decision, reasonCode, riskTier } and records it. */
  function evaluate(request) {
    let outcome;
    try {
      outcome = decide(request ?? {});
    } catch {
      outcome = { decision: 'DENY', reasonCode: 'DENY_GATEWAY_ERROR', riskTier: null };
    }
    const result = { requestId: randomUUID(), policyVersion: POLICY_VERSION, ...outcome };
    const owner = request?.principal?.ownerId;
    audit.record({
      ...result,
      occurredAt: clock().toISOString(),
      ownerId: validOwner(owner) ? owner : null,
      origin: ORIGINS.has(request?.origin) ? request.origin : 'invalid',
      sourceTrust: SOURCES.has(request?.sourceTrust) ? request.sourceTrust : 'invalid',
      // A model-chosen name could carry private text, so only plain identifiers are kept.
      action: typeof request?.action === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(request.action) ? request.action : 'invalid_action_name',
    });
    return result;
  }

  return { evaluate, audit };
}

// One shared gateway per server process, so the text worker and the HTTP routes write to one audit list.
const defaultGateway = createActionGateway();

module.exports = { POLICY_VERSION, MAX_EXTRACTED_CENTS, createActionGateway, createAuditLog, defaultGateway };
