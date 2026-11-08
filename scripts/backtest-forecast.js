const fs = require("node:fs");
const { forecastBands } = require("../backend/forecast-bands");
const { financeForecast } = require("../backend/finance-forecast");
const { profileFromLedger } = require("../backend/profile-from-ledger");
const {
  baseline,
  net,
  localParts,
  localToUTC,
  addDays,
  hash,
} = require("../backend/pipeline-utils");
const loss = (actual, predicted, q) =>
  Math.max(q * (actual - predicted), (q - 1) * (actual - predicted));
function backtest({ owner, ledger, bank, asOf = new Date() }) {
  const origins = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(
        localParts(asOf, owner.time_zone).month + "-01T12:00Z",
      );
      d.setUTCMonth(d.getUTCMonth() - i - 1);
      return d.toISOString().slice(0, 10);
    }).reverse(),
    windows = [];
  for (const date of origins) {
    const cutoff = localToUTC(date, 0, owner.time_zone),
      end = addDays(date, 30),
      training = ledger.filter(
        (r) => Date.parse(r.occurred_at) < Date.parse(cutoff),
      );
    if (
      training.length < 30 ||
      !training.some(
        (r) =>
          localParts(r.occurred_at, owner.time_zone).date <=
          addDays(date, -182),
      )
    )
      continue;
    const future = ledger.filter(
      (r) =>
        r.status === "completed" &&
        localParts(r.occurred_at, owner.time_zone).date >= date &&
        localParts(r.occurred_at, owner.time_zone).date < end,
    );
    const prior = training.filter(
      (r) =>
        r.status === "completed" &&
        localParts(r.occurred_at, owner.time_zone).date >= addDays(date, -30),
    );
    const delta = (rows) =>
      rows.reduce(
        (s, r) =>
          s +
          (r.direction === "inflow"
            ? r.amount_cents
            : r.direction === "outflow"
              ? -r.amount_cents
              : 0),
        0,
      );
    const spend = (rows) =>
      rows.filter(baseline).reduce((s, r) => s + net(r), 0);
    // Only schedules that existed at the origin are visible; never use current balances as historical balances.
    const originBank = {
      balances: [{ type: "Checking", available_cents: 0 }],
      bills: (bank.bills || []).filter(
        (b) => b.created_at && Date.parse(b.created_at) < Date.parse(cutoff),
      ),
      loans: (bank.loans || []).filter(
        (l) => l.created_at && Date.parse(l.created_at) < Date.parse(cutoff),
      ),
    };
    const bands = forecastBands(
      {
        ownerId: owner.id,
        ledger: training,
        bank: originBank,
        asOf: cutoff,
        timeZone: owner.time_zone,
      },
      { paths: 1000 },
    );
    const old = financeForecast(
      profileFromLedger({
        owner,
        ledger: training,
        bank: { ...originBank, asOf: cutoff },
        asOf: cutoff,
      }),
      new Date(cutoff),
      30,
    );
    const oldSpending = (old.estimates.dailyDiscretionaryCents || 0) * 30;
    const predictions = {
      bootstrap: {
        balance: [
          bands.daily.at(-1).lowCents,
          bands.daily.at(-1).middleCents,
          bands.daily.at(-1).highCents,
        ],
        spending: [
          bands.spending.lowCents,
          bands.spending.middleCents,
          bands.spending.highCents,
        ],
      },
      existing: {
        balance: Array(3).fill(
          old.estimatedEndingBalanceCents ??
            old.minimumProjectedBalanceCents ??
            0,
        ),
        spending: Array(3).fill(oldSpending),
      },
      repeat30: {
        balance: Array(3).fill(delta(prior)),
        spending: Array(3).fill(spend(prior)),
      },
    };
    const actual = { balance: delta(future), spending: spend(future) };
    const losses = Object.fromEntries(
      Object.entries(predictions).map(([method, targets]) => [
        method,
        Object.fromEntries(
          Object.entries(targets).map(([target, values]) => [
            target,
            [0.1, 0.5, 0.9].map((q, i) => loss(actual[target], values[i], q)),
          ]),
        ),
      ]),
    );
    windows.push({
      origin: date,
      trainingEndExclusive: date,
      evaluationEndExclusive: end,
      actual,
      predictions,
      losses,
      covered:
        actual.balance >= predictions.bootstrap.balance[0] &&
        actual.balance <= predictions.bootstrap.balance[2],
      middleErrorCents: predictions.bootstrap.balance[1] - actual.balance,
    });
  }
  const scores = Object.fromEntries(
    ["bootstrap", "existing", "repeat30"].map((method) => [
      method,
      Object.fromEntries(
        ["balance", "spending"].map((target) => [
          target,
          windows.reduce(
            (s, w) =>
              s + w.losses[method][target].reduce((a, b) => a + b, 0) / 3,
            0,
          ) / (windows.length || 1),
        ]),
      ),
    ]),
  );
  const coverage =
    windows.filter((w) => w.covered).length / (windows.length || 1);
  const accepted =
    windows.length === 12 &&
    ["balance", "spending"].every(
      (target) =>
        scores.bootstrap[target] < scores.existing[target] &&
        scores.bootstrap[target] < scores.repeat30[target],
    ) &&
    coverage >= 0.7 &&
    coverage <= 0.9;
  return {
    status: "evaluated",
    accepted,
    inputHash: bank.inputHash,
    method: "weekly_block_bootstrap_v1",
    scores,
    coverage,
    averageMiddleErrorCents:
      windows.reduce((s, w) => s + w.middleErrorCents, 0) /
      (windows.length || 1),
    windows,
    limitation:
      "Simulator plus synthetic persona; no evidence about real people. Balance changes are reconstructed from posted ledger cash flows, including labeled persona outflows, with zero as the common origin; these are not historical bank balance observations. Only schedules created before each origin are visible. Historical schedule edits cannot be reconstructed; historical schedule changes limit this evaluation.",
  };
}
if (require.main === module) {
  (async () => {
    let report;
    if (!process.env.TIGER_DATA_URL)
      report = {
        status: "blocked",
        accepted: false,
        reason:
          "TIGER_DATA_URL is not configured; no live forecast validation claimed",
      };
    else {
      const { createTigerPool } = require("../backend/tiger-memory");
      const { loadOwnerData } = require("../backend/pipeline-data");
      const pool = createTigerPool();
      try {
        const ownerId = process.env.FINANCE_OPERATOR_OWNER_ID;
        if (!ownerId) throw Error("owner_required");
        const data = await loadOwnerData(pool, ownerId);
        report = backtest(data);
        await pool.query(
          "INSERT INTO hackutd_finance.provider_cursor(owner_id,source,cursor) VALUES($1,'forecast_evaluation',$2) ON CONFLICT(owner_id,source) DO UPDATE SET cursor=$2,updated_at=now()",
          [ownerId, { ...report, accepted: report.accepted }],
        );
      } finally {
        await pool.end();
      }
    }
    fs.writeFileSync(
      "docs/forecast-backtest.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(report.status);
  })().catch(() => {
    console.error("Backtest unavailable.");
    process.exitCode = 1;
  });
}
module.exports = { backtest, loss };
