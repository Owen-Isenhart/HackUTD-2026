const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  database,
  owner,
  checking,
  card,
  nessieFixture,
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

test("a v2 chargeback reverses its refund instead of discounting the original purchase", () => {
  const ledger = normalizeTransactions([
    raw("purchase", "purchase", 1000),
    raw("refund", "refund", 700, { parent_transaction_id: "purchase", payer_id: null, payee_id: checking }),
    raw("chargeback", "chargeback", 200, { parent_transaction_id: "refund" }),
    raw("foreign_refund", "refund", 700, { parent_transaction_id: "purchase", payer_id: null, payee_id: card }),
  ], [checking, card], []);
  assert.equal(ledger.find(({ id }) => id === "purchase").reversed_cents, 500);
  assert.equal(ledger.find(({ id }) => id === "chargeback").direction, "outflow");
});

test("v2 import refuses a bank account reassigned to another customer", async () => {
  const db = await database();
  try {
    const accountOwner = await owner(db);
    const nessie = nessieFixture();
    nessie.account = async (id) => ({ id, customer_id: "cust_other", available_cents: 1 });
    const { importFromNessie } = require("../backend/ledger");
    await assert.rejects(importFromNessie(db, accountOwner.id, nessie), { code: "nessie_account_owner_mismatch" });
  } finally {
    await db.end();
  }
});

test("the import asks for only the most recent rows and never reads tenant-wide pages", async () => {
  const { nessieFixture } = require("./helpers/pipeline-fixtures");
  const { importFromNessie, readLedger } = require("../backend/ledger");
  const db = await database();
  try {
    const a = await owner(db);
    const n = nessieFixture();
    const limits = [];
    n.accountTransactions = async (id, options) => {
      limits.push(options?.limit);
      return id === checking ? [raw("txn_one", "purchase", 500)] : [];
    };
    let page = 0;
    n.tenantTransactions = async () => {
      page++;
      return { items: [raw("txn_foreign", "purchase", 900, { payer_id: "other" })], next_cursor: null };
    };
    const result = await importFromNessie(db, a.id, n, new Date("2026-11-08"));
    assert.equal(page, 0);
    assert.ok(limits.length && limits.every((l) => l === 1000));
    assert.equal(result.coverage[0].truncated, false);
    assert.deepEqual(
      (await readLedger(db, a.id)).map((r) => r.id),
      ["txn_one"],
    );
  } finally {
    await db.end();
  }
});
