const { spentInPeriod } = require("./budget-derive");
const { requestInsight } = require("./nemotron");

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents) => usd.format(cents / 100);

async function dashboardInsight(data, panel, { env, fetchImpl, now = new Date() }) {
  const { forecast, profile, ledger, budgets, owner } = data;
  if (!forecast || !profile || Date.parse(forecast.validUntil) <= now.getTime()) return null;
  const choices = [];
  const add = (id, title, text) => choices.push({ id, title, text });

  if (panel === "spending") {
    const bankLedger = ledger.filter((entry) => entry.provenance === "nessie_sandbox");
    const over = budgets.map((budget) => ({
      category: budget.category,
      excess: spentInPeriod(bankLedger, budget, now, owner.time_zone) - budget.limit_cents,
    })).filter(({ excess }) => excess > 0).sort((a, b) => b.excess - a.excess)[0];
    if (over) add("budget_over", "Review your budget",
      `Posted purchases are ${money(over.excess)} above your ${over.category === "all" ? "overall" : over.category} limit for the current budget period.`);
    const month = profile.asOfLocalDate.slice(0, 7);
    const purchases = profile.transactions.filter((row) =>
      row.provenance === "nessie_sandbox" && row.date.startsWith(month));
    if (purchases.length) add("spending_review", "Review this month’s purchases",
      `Nessie shows ${purchases.length} posted purchases totaling ${money(purchases.reduce((sum, row) => sum + row.amountCents, 0))} in the current month.`);
  } else {
    if (forecast.missingSources.length) add("commitment_review", "Check incomplete commitments",
      "Review missing bank information and undated commitments before using the cash forecast for a new purchase.");
    if (Number.isSafeInteger(forecast.minimumBalanceLowCents) && forecast.minimumBalanceLowCents < forecast.reserveCents) {
      add("reserve_shortfall", "Review your cash reserve",
        `The projected low balance falls ${money(forecast.reserveCents - forecast.minimumBalanceLowCents)} below your reserve.`);
    }
    const total = forecast.commitments.filter((item) => !item.estimated).reduce((sum, item) => sum + item.amount, 0);
    if (total > 0) add("scheduled_outflows", "Plan for scheduled outflows",
      `Scheduled outflows total ${money(total)} over the next 30 days. Use the calendar to check when they’re due.`);
  }
  if (!choices.length) return null;
  let selected;
  if (env.NEMOTRON_BASE_URL) {
    const ids = choices.map(({ id }) => id);
    const { insight } = await requestInsight({
      name: "dashboard_finance_insight",
      prompt: "Choose one available dashboard action. Prefer a known budget or reserve shortfall, or incomplete commitments, ahead of a general review. Return only the action ID.",
      facts: { panel, choices: ids },
      properties: { action: { type: "string", enum: ids } },
      timeout: 4000,
    }, { env, fetchImpl });
    selected = choices.find(({ id }) => id === insight?.action);
  }
  return { ...(selected ?? choices[0]), source: selected ? "nemotron" : "profile" };
}

module.exports = { dashboardInsight };
