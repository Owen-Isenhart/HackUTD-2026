const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  visitsFromLedger,
  detectRoutines,
  circularWindow,
} = require("../backend/routines-v2");
const { personaLedger } = require("./helpers/pipeline-fixtures");
const { random } = require("../backend/pipeline-utils");
const { validateEntries } = require("../backend/stated-routines");
const now = new Date("2026-11-08T12:00Z");
test("persona yields weekday Chipotle and MWF Starbucks, stale habits disappear", () => {
  const routines = detectRoutines(visitsFromLedger(personaLedger(), now), now);
  assert.deepEqual(
    routines.find((r) => r.brand_key === "chipotle").weekdays,
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    routines.find((r) => r.brand_key === "starbucks").weekdays,
    [1, 3, 5],
  );
  assert.equal(
    detectRoutines(
      visitsFromLedger(
        personaLedger().filter(
          (r) => Date.parse(r.occurred_at) < +now - 70 * 86400000,
        ),
        now,
      ),
      now,
    ).length,
    0,
  );
  assert.equal(circularWindow([1430, 10]).width, 20);
});
test("2500 evenly spaced simulator purchases with random brands yield no routines", () => {
  const rng = random(2026);
  const ledger = Array.from({ length: 2500 }, (_, i) => ({
    id: "txn_" + i,
    kind: "purchase",
    status: "completed",
    direction: "outflow",
    brand_key: "brand_" + Math.floor(rng() * 11),
    amount_cents: 1000,
    occurred_at: new Date(+now - (2499 - i) * 25239000).toISOString(),
    provenance: "nessie_sandbox",
  }));
  assert.equal(detectRoutines(visitsFromLedger(ledger, now), now).length, 0);
});
test("model stop entries require evidence, known brands and matching clocks", () => {
  const base = {
    brand: "chipotle",
    purpose: "purchase",
    days: ["mon"],
    start: "12:00",
    end: "12:25",
    quote: "around 11",
  };
  assert.equal(
    validateEntries("around 11", [{ ...base, quote: "invented" }]).accepted
      .length,
    0,
  );
  assert.equal(
    validateEntries("around 11", [{ ...base, brand: "fake" }]).accepted.length,
    0,
  );
  assert.equal(
    validateEntries("around 11", [{ ...base, start: "13:00" }]).accepted[0]
      .start,
    "",
  );
});
