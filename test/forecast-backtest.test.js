const { test } = require("node:test");
const assert = require("node:assert/strict");
const { backtest } = require("../scripts/backtest-forecast");
const { personaLedger } = require("./helpers/pipeline-fixtures");
test("rolling forecast evaluation keeps future rows out of training and records both comparisons", () => {
  const args = {
    owner: { id: "fixture", time_zone: "America/Chicago" },
    ledger: personaLedger(),
    bank: { bills: [], loans: [], inputHash: "fixture" },
    asOf: new Date("2026-11-08T12:00Z"),
  };
  const first = backtest(args);
  assert.equal(first.windows.length, 12);
  assert.deepEqual(Object.keys(first.scores), [
    "bootstrap",
    "existing",
    "repeat30",
  ]);
  assert.ok(first.windows.every((w) => w.trainingEndExclusive === w.origin));
  const later = {
    ...args.ledger[0],
    id: "far-future",
    occurred_at: "2027-01-01T12:00Z",
    amount_cents: 99999999,
  };
  const second = backtest({ ...args, ledger: [...args.ledger, later] });
  assert.deepEqual(second.windows, first.windows);
  assert.match(first.limitation, /synthetic persona/);
});
