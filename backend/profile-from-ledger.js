const {
  localParts,
  net,
  baseline,
  addDays,
  hash,
} = require("./pipeline-utils");
const { scheduleCashflow } = require("./forecast-bands");
const { financeForecast } = require("./finance-forecast");
function profileFromLedger({
  owner,
  ledger,
  bank,
  routines = [],
  budgets = [],
  selections = [],
  asOf = bank.asOf,
  plans = {},
}) {
  const timeZone = owner.time_zone,
    today = localParts(asOf, timeZone);
  const checking = (bank.balances || []).filter((a) => a.type === "Checking");
  const balance =
    checking.length &&
    checking.every((a) => Number.isSafeInteger(a.available_cents))
      ? checking.reduce((s, a) => s + a.available_cents, 0)
      : null;
  const dates = Array.from({ length: 90 }, (_, i) => addDays(today.date, i));
  const { schedule } = scheduleCashflow(
    { ledger, bank, asOf, timeZone, obligations: plans.obligations || [] },
    dates,
  );
  const transactions = ledger.filter(baseline).map((r) => ({
    id: r.id,
    type: "purchase",
    amountCents: net(r),
    date: localParts(r.occurred_at, timeZone).date,
    occurredAt: r.occurred_at,
    merchant: r.brand_key,
    category: r.category,
    provenance: r.provenance,
  }));
  const summarize = (rows) => ({
    count: rows.length,
    totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
  });
  return {
    schemaVersion: 2,
    asOf,
    timeZone,
    currency: "USD",
    source: "nessie_sandbox",
    ownerId: owner.id,
    accountType: "checking",
    balanceCents: balance,
    savingsBalanceCents:((bank.balances||[]).filter(a=>a.type==="Savings").every(a=>Number.isSafeInteger(a.available_cents))?(bank.balances||[]).filter(a=>a.type==="Savings").reduce((sum,a)=>sum+a.available_cents,0):null),
    historyStartDate: transactions[0]?.date || today.date,
    transactions,
    routines,
    budgets,
    selectedStores: selections,
    profileVersion: hash([
      ledger.map((r) => [r.id, r.version]),
      bank.inputHash,
      routines.map((r) => [r.id, r.version]),
      plans.summary?.version,
    ]),
    memoryVersion: hash(budgets.map((b) => [b.category, b.version])),
    socialObligations: plans.summary
      ? {
          version: plans.summary.version,
          unverifiedPendingCount:
            plans.pendingUnknownAmounts ||
            plans.summary.unverifiedPendingCount ||
            0,
          upcoming: [],
          pendingClarifications: [],
        }
      : null,
    confirmedBudget: null,
    confirmedReserveCents: plans.reserveCents || 0,
    spend: {
      monthToDate: summarize(
        transactions.filter((r) => r.date.startsWith(today.month)),
      ),
      weekToDate: summarize(
        transactions.filter(
          (r) => r.date >= addDays(today.date, 1 - today.weekday),
        ),
      ),
      last90Days: summarize(
        transactions.filter((r) => r.date >= addDays(today.date, -90)),
      ),
    },
    bankCashflow: {
      coverage: {
        bills: (bank.bills || []).length,
        loans: (bank.loans || []).length,
        deposits: 0,
      },
      unresolvedSchedules: 0,
      incomeHistory: ledger
        .filter(
          (r) =>
            r.kind === "deposit" &&
            r.status === "completed" &&
            /PAYROLL/i.test(r.descriptor || ""),
        )
        .map((r) => ({
          source: "payroll",
          date: localParts(r.occurred_at, timeZone).date,
          amountCents: r.amount_cents,
        })),
      postedBills: [],
      schedules: dates
        .filter((d) => schedule.get(d).out > 0)
        .map((d) => ({
          id: "ledger-schedule:" + d,
          source: "nessie",
          nextDate: d,
          amountCents: schedule.get(d).out,
          payee: "scheduled bank commitments",
        })),
    },
    coverage: bank.coverage,
    notice: "Synthetic demo purchases do not change your sandbox balance.",
  };
}
function comparisonForecast(context, now = new Date()) {
  return financeForecast(profileFromLedger(context), now, 30, {
    includeEstimates: false,
  });
}
module.exports = { profileFromLedger, comparisonForecast };
