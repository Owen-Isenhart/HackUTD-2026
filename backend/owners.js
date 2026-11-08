const { randomUUID, randomBytes, timingSafeEqual } = require("node:crypto");
const digest = (token) =>
  require("node:crypto").createHash("sha256").update(token).digest("hex");
async function findOwnerByCustomer(db, id) {
  return (
    await db.query(
      "SELECT * FROM hackutd_finance.owner WHERE nessie_customer_id=$1",
      [id],
    )
  ).rows[0];
}
async function createOwner(db, f) {
  return (
    await db.query(
      `INSERT INTO hackutd_finance.owner(id,nessie_customer_id,card_account_id,first_name,time_zone,is_synthetic_person,persona_enabled) VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(nessie_customer_id) DO UPDATE SET first_name=EXCLUDED.first_name RETURNING *`,
      [
        randomUUID(),
        f.customerId,
        f.cardAccountId,
        f.firstName,
        f.timeZone,
        f.personaEnabled,
      ],
    )
  ).rows[0];
}
async function issueSession(db, ownerId) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  await db.query(
    "INSERT INTO hackutd_finance.owner_session(token_hash,owner_id,expires_at) VALUES($1,$2,$3)",
    [digest(token), ownerId, expiresAt],
  );
  return { token, expiresAt };
}
async function resolveSession(db, bearer) {
  if (!/^Bearer [a-zA-Z0-9_-]{43}$/.test(bearer || "")) return null;
  const h = digest(bearer.slice(7));
  const r = (
    await db.query(
      "SELECT token_hash,owner_id FROM hackutd_finance.owner_session WHERE token_hash=$1 AND expires_at>now() AND revoked_at IS NULL",
      [h],
    )
  ).rows[0];
  return r && timingSafeEqual(Buffer.from(h), Buffer.from(r.token_hash))
    ? { ownerId: r.owner_id, tokenHash: h }
    : null;
}
async function authenticate(db, bearer, env) {
  const expected = "Bearer " + env.FINANCE_DEMO_TOKEN;
  if (
    env.FINANCE_OPERATOR_OWNER_ID &&
    env.FINANCE_DEMO_TOKEN?.length >= 24 &&
    Buffer.byteLength(bearer || "") === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(bearer), Buffer.from(expected))
  )
    return { ownerId: env.FINANCE_OPERATOR_OWNER_ID };
  return resolveSession(db, bearer);
}
const revokeSession = (db, h) =>
  db.query(
    "UPDATE hackutd_finance.owner_session SET revoked_at=now() WHERE token_hash=$1",
    [h],
  );
module.exports = {
  createOwner,
  findOwnerByCustomer,
  issueSession,
  resolveSession,
  revokeSession,
  authenticate,
  digest,
};
