const { hash, fail, transaction } = require("./pipeline-utils");
const { createOwner, findOwnerByCustomer, issueSession } = require("./owners");
const NOTICE =
  "This finds a record in the Nessie sandbox bank. It is not bank sign-in.";
const canonicalName = (name) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
function normalizeName(name, maximum = 60) {
  if (typeof name !== "string") throw fail("invalid_identification");
  const value = canonicalName(name);
  if (!value || value.length > maximum) throw fail("invalid_identification");
  return value;
}
const fullName = (input) => input.fullName === undefined
  ? normalizeName(input.firstName) + " " + normalizeName(input.lastName)
  : normalizeName(input.fullName, 121);

async function identifyCustomer(nessie, input) {
  const name = fullName(input);
  if (typeof input.last4 !== "string" || !/^\d{4}$/.test(input.last4)) throw fail("invalid_identification");
  const matches = [];
  for (const c of await nessie.listCustomers()) {
    if (typeof c.first_name !== "string" || !c.first_name.trim() || typeof c.last_name !== "string" || !c.last_name.trim()
      || canonicalName(c.first_name + " " + c.last_name) !== name)
      continue;
    const accounts = await nessie.customerAccounts(c.id);
    const chosen = accounts
      .filter((a) => a.customer_id === c.id && typeof a.account_number === "string"
        && /^\d{4,}$/.test(a.account_number) && a.account_number.endsWith(input.last4))
      .sort(
        (a, b) =>
          Number(b.type === "Credit Card") - Number(a.type === "Credit Card"),
      );
    if (chosen.length) matches.push({ customer: c, accounts, card: chosen[0] });
  }
  if (!matches.length) throw fail("no_sandbox_match", 404);
  if (matches.length > 1) throw fail("ambiguous_sandbox_match", 409);
  return matches[0];
}
function createIdentifyLimiter() {
  const entries = new Map();
  return (address, input, now = Date.now()) => {
    for (const [key, times] of entries)
      if (times.at(-1) <= now - 600000) entries.delete(key);
    const keys = [
      "ip:" + address,
      "name:" + hash(fullName(input)).slice(0, 12),
    ];
    for (const key of keys) {
      const ts = (entries.get(key) || []).filter((t) => t > now - 600000);
      if (ts.length >= 5) throw fail("identification_rate_limited", 429);
      entries.set(key, ts);
    }
    for (const k of keys) entries.get(k).push(now);
  };
}
async function onboard({ pool, nessie, input, env, queueRun }) {
  const match = await identifyCustomer(nessie, input);
  return transaction(pool, async (tx) => {
    const previous = await findOwnerByCustomer(tx, match.customer.id);
    const owner = await createOwner(tx, {
      customerId: match.customer.id,
      cardAccountId: match.card.id,
      firstName: match.customer.first_name,
      timeZone: env.FINANCE_TIME_ZONE || "America/Chicago",
      personaEnabled:
        env.PERSONA_HISTORY_ENABLED === "1" &&
        match.customer.id === "cust_01m6x5w635z27trg3dfbhjxjvx",
    });
    for (const a of match.accounts.filter((account) => account.customer_id === match.customer.id))
      await tx.query(
        `INSERT INTO hackutd_finance.owner_account(owner_id,account_id,account_type,last4,nickname) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,account_id) DO UPDATE SET account_type=$3,last4=$4,nickname=$5`,
        [
          owner.id,
          a.id,
          a.type,
          String(a.account_number).slice(-4),
          a.nickname,
        ],
      );
    const session = await issueSession(tx, owner.id);
    const runId = await queueRun(tx, owner.id);
    return {
      status: previous ? 200 : 201,
      ownerId: owner.id,
      session,
      runId,
      onboardingStep: owner.onboarding_step,
      sandbox: true,
      notice: NOTICE,
    };
  });
}
module.exports = {
  normalizeName,
  identifyCustomer,
  createIdentifyLimiter,
  onboard,
  NOTICE,
};
