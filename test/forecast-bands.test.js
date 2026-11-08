const { test } = require("node:test");
const assert = require("node:assert/strict");
const { forecastBands, weeklyBlocks } = require("../backend/forecast-bands");
const { personaLedger } = require("./helpers/pipeline-fixtures");
const input = {
  ownerId: "fixture",
  ledger: personaLedger(),
  asOf: "2026-11-08T12:00:00Z",
  timeZone: "America/Chicago",
  bank: {
    balances: [
      { type: "Checking", available_cents: 1000000 },
      { type: "Credit Card", available_cents: 9000000 },
    ],
    bills: [],
    loans: [],
  },
};
test("forecast deterministic integer bands, checking start and bounded weekly blocks", () => {
  const a = forecastBands(input, { paths: 100 });
  assert.deepEqual(a, forecastBands(input, { paths: 100 }));
  assert.equal(a.startingBalanceCents, 1000000);
  assert.ok(
    a.daily.every(
      (d) =>
        Number.isSafeInteger(d.lowCents) &&
        d.lowCents <= d.middleCents &&
        d.middleCents <= d.highCents,
    ),
  );
  assert.ok(
    weeklyBlocks(input.ledger, input.asOf, input.timeZone).every(
      (b) => b.length === 7,
    ),
  );
  const b = forecastBands(
    { ...input, ledger: input.ledger.slice(1) },
    { paths: 100 },
  );
  assert.notEqual(a.inputHash, b.inputHash);
});
test("bill and undated loan lower every path exactly; unknown obligations fail closed", () => {
  const base = forecastBands({ ...input, ledger: [] }, { paths: 10 });
  const bill = forecastBands(
    {
      ...input,
      ledger: [],
      bank: {
        ...input.bank,
        bills: [{ payment_amount: 1450, recurring_date: 8 }],
      },
    },
    { paths: 10 },
  );
  assert.equal(base.daily[0].lowCents - bill.daily[0].lowCents, 145000);
  const loan = forecastBands(
    {
      ...input,
      ledger: [],
      bank: {
        ...input.bank,
        loans: [{ monthly_payment_cents: 22500, status: "in_repayment" }],
      },
    },
    { paths: 10 },
  );
  assert.equal(base.daily[0].lowCents - loan.daily[0].lowCents, 22500);
  assert.notEqual(loan.safeToSpendCents, null);
  assert.equal(
    forecastBands({ ...input, pendingUnknownAmounts: 1 }).safeToSpendCents,
    null,
  );
});
