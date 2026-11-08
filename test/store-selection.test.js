const { test } = require("node:test");
const assert = require("node:assert/strict");
const { selectStores } = require("../backend/store-selection");
const { personaLedger } = require("./helpers/pipeline-fixtures");
test("frequency selects persona stores and preserves explicit opt-out", () => {
  const ledger = personaLedger(),
    brands = [...new Set(ledger.map((r) => r.brand_key))],
    programs = brands.map((merchant_id) => ({
      merchant_id,
      kind: "store_loyalty",
      paid_membership: false,
    }));
  const args = {
    ledger,
    programs,
    now: new Date("2026-11-08T12:00Z"),
    timeZone: "America/Chicago",
  };
  const a = selectStores(args);
  assert.equal(a.filter((s) => s.selected).length, 7);
  const b = selectStores({
    ...args,
    previous: [{ brand_key: "chipotle", decided_by: "user", selected: false }],
  });
  assert.equal(b.find((s) => s.brand_key === "chipotle").selected, false);
  assert.ok(
    selectStores({ ...args, programs: [] }).every((s) =>
      s.reasons.includes("no_program"),
    ),
  );
});
