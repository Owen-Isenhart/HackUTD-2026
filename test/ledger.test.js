const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  database,
  owner,
  checking,
  card,
} = require("./helpers/pipeline-fixtures");
const { normalizeTransactions, upsertLedger } = require("../backend/ledger");
const { matchBrand } = require("../backend/brands");
const raw = (id, kind, amount, extra = {}) => ({
  id,
  kind,
  amount_cents: amount,
  status: "completed",
  created_at: "2026-11-07T12:00Z",
  payer_id: checking,
  ...extra,
});
test("ledger deduplicates internal transfers, tracks refunds and isolates accounts", async () => {
  const pool = await database();
  try {
    const a = await owner(pool);
    const transfer = raw("txn_1", "transfer", 1000, { payee_id: card });
    const rows = normalizeTransactions(
      [
        transfer,
        transfer,
        raw("txn_2", "purchase", 500),
        raw("txn_3", "refund", 500, { parent_transaction_id: "txn_2" }),
        raw("txn_foreign", "purchase", 999, { payer_id: "other" }),
      ],
      [checking, card],
      [],
    );
    assert.equal(rows.length, 3);
    assert.equal(rows.find((r) => r.id === "txn_1").direction, "internal");
    assert.equal(rows.find((r) => r.id === "txn_2").reversed_cents, 500);
    assert.ok(
      rows.find((r) => r.id === "txn_2").screen_flags.includes("reversed"),
    );
    assert.equal(await upsertLedger(pool, a.id, rows), 3);
    assert.equal(await upsertLedger(pool, a.id, rows), 0);
  } finally {
    await pool.end();
  }
});
test("brands use merchant names, correct v2 categories and card testing screens", () => {
  assert.equal(
    matchBrand("Bluebird Coffee Roasters #123").key,
    "bluebird_coffee",
  );
  assert.equal(matchBrand("Unknown Diner").key, null);
  const m = [{ id: "m", name: "Unlisted", category: "gas" }];
  const r = normalizeTransactions(
    [0, 1, 2].map((i) =>
      raw("txn_" + i, "purchase", 100, {
        merchant_id: "m",
        created_at: new Date(
          Date.parse("2026-11-07T12:00Z") + i * 60000,
        ).toISOString(),
      }),
    ),
    [checking],
    m,
  );
  assert.ok(
    r.every(
      (r) => r.category === "fuel" && r.screen_flags.includes("card_testing"),
    ),
  );
});

test("a saturated account list falls back to all tenant pages without importing another owner", async () => {
  const { nessieFixture } = require("./helpers/pipeline-fixtures");
  const { importFromNessie, readLedger } = require("../backend/ledger");
  const db = await database();
  try {
    const a = await owner(db);
    const n = nessieFixture();
    n.accountTransactions = async (id) =>
      id === checking ? Array(5000).fill(raw("txn_one", "purchase", 500)) : [];
    let page = 0;
    n.tenantTransactions = async () =>
      ++page === 1
        ? {
            items: [
              raw("txn_one", "purchase", 500),
              raw("txn_foreign", "purchase", 900, { payer_id: "other" }),
            ],
            next_cursor: "next",
          }
        : { items: [raw("txn_two", "purchase", 600)], next_cursor: null };
    const result = await importFromNessie(db, a.id, n, new Date("2026-11-08"));
    assert.equal(page, 2);
    assert.equal(result.coverage[0].truncated, true);
    assert.equal(result.coverage[0].recovered, true);
    assert.deepEqual(
      (await readLedger(db, a.id)).map((r) => r.id),
      ["txn_one", "txn_two"],
    );
  } finally {
    await db.end();
  }
});
