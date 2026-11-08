const { test } = require("node:test");
const assert = require("node:assert/strict");
const { hash, localParts, localToUTC } = require("../backend/pipeline-utils");
const { database, owner } = require("./helpers/pipeline-fixtures");
const { loadPersona } = require("../backend/persona");
test("persona generation is deterministic, bounded and keeps times local through DST", async () => {
  const { generatePersona, HABITS, campusBreak } =
    await import("../scripts/generate-persona-history.mjs");
  const a = generatePersona();
  assert.equal(
    require("crypto")
      .createHash("sha256")
      .update(require("fs").readFileSync("data/persona/alex-taylor.v1.json"))
      .digest("hex"),
    "ad25bb54134596868c15575d085bf8e7313623499e9bebda5202886eb4e4b114",
  );
  assert.deepEqual(a, generatePersona());
  assert.deepEqual(a, require("../data/persona/alex-taylor.v1.json"));
  assert.ok(a.records.length > 750 && a.records.length < 950);
  for (const r of a.records) {
    const p = localParts(r.occurredAt, a.timeZone),
      h = HABITS.find((h) => h[0] === r.brand);
    assert.ok(p.minute >= h[2] && p.minute <= h[3]);
    if (["chipotle", "starbucks", "chick_fil_a"].includes(r.brand))
      assert.equal(campusBreak(p.date), false);
  }
  for (const d of ["2025-03-09", "2025-11-02", "2026-03-08", "2026-11-01"])
    assert.equal(
      localParts(localToUTC(d, 11 * 60, "America/Chicago"), "America/Chicago")
        .minute,
      660,
    );
});
test("persona loader gates customer, writes idempotently, and never changes balances", async () => {
  const db = await database();
  try {
    const a = await owner(db);
    assert.equal((await loadPersona(db, a, {})).count, 0);
    const b = { ...a, nessie_customer_id: "other" };
    assert.equal(
      (await loadPersona(db, b, { PERSONA_HISTORY_ENABLED: "1" })).count,
      0,
    );
    const first = await loadPersona(db, a, { PERSONA_HISTORY_ENABLED: "1" }),
      second = await loadPersona(db, a, { PERSONA_HISTORY_ENABLED: "1" });
    assert.ok(first.changed > 750);
    assert.equal(second.changed, 0);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM hackutd_finance.ledger_transaction WHERE account_id IS NOT NULL",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.end();
  }
});
