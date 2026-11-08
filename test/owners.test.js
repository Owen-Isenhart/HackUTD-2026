const { test } = require("node:test");
const assert = require("node:assert/strict");
const { database, owner } = require("./helpers/pipeline-fixtures");
const { migrateTiger } = require("../backend/tiger-memory");
const {
  issueSession,
  resolveSession,
  revokeSession,
  authenticate,
} = require("../backend/owners");
test("migrations replay and sessions reject expiry/revocation, operator token stays scoped", async () => {
  const db = await database();
  try {
    await migrateTiger(db);
    const a = await owner(db),
      b = await owner(db, { customerId: "cust_00000000000000000000000002" });
    const session = await issueSession(db, a.id);
    assert.equal(
      (await resolveSession(db, "Bearer " + session.token)).ownerId,
      a.id,
    );
    assert.notEqual(
      (await resolveSession(db, "Bearer " + session.token)).ownerId,
      b.id,
    );
    await revokeSession(
      db,
      (await resolveSession(db, "Bearer " + session.token)).tokenHash,
    );
    assert.equal(await resolveSession(db, "Bearer " + session.token), null);
    const expired = await issueSession(db, a.id);
    await db.query(
      "UPDATE hackutd_finance.owner_session SET expires_at=now()-interval '1 second' WHERE owner_id=$1",
      [a.id],
    );
    assert.equal(await resolveSession(db, "Bearer " + expired.token), null);
    const env = {
      FINANCE_DEMO_TOKEN: "a".repeat(30),
      FINANCE_OPERATOR_OWNER_ID: b.id,
    };
    assert.equal(
      (await authenticate(db, "Bearer " + env.FINANCE_DEMO_TOKEN, env)).ownerId,
      b.id,
    );
  } finally {
    await db.end();
  }
});
