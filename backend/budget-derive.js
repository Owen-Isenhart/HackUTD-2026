const defaults = require("./budget-policy");
const { baseline, net, localParts } = require("./pipeline-utils");
// Budget medians average the two center months, rounding half a cent down.
function median(values){const sorted=[...values].sort((a,b)=>a-b);if(!sorted.length)return 0;const i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:sorted[i-1]+Math.floor((sorted[i]-sorted[i-1])/2);}
function historyInputs(
  ledger,
  now = new Date(),
  timeZone = "America/Chicago",
  bank = {},
  obligations = [],
) {
  const current = localParts(now, timeZone).month;
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(current + "-01T12:00Z");
    d.setUTCMonth(d.getUTCMonth() - i - 1);
    return d.toISOString().slice(0, 7);
  });
  const categories = new Map(),
    payroll = months.map(() => 0);
  for (const r of ledger) {
    const month = localParts(r.occurred_at, timeZone).month,
      idx = months.indexOf(month);
    if (idx < 0) continue;
    if (baseline(r)) {
      if (!categories.has(r.category))
        categories.set(
          r.category,
          months.map(() => 0),
        );
      categories.get(r.category)[idx] += net(r);
    }
    if (
      r.kind === "deposit" &&
      r.status === "completed" &&
      /PAYROLL/i.test(r.descriptor || "")
    )
      payroll[idx] += r.amount_cents;
  }
  const normal = Object.fromEntries(
    [...categories].map(([c, values]) => [c, median(values)]),
  );
  const income =
    payroll.filter((n) => n > 0).length >= 3 ? median(payroll) : null;
  const fixed =
    (bank.bills || [])
      .filter((b) => !["cancelled", "completed"].includes(b.status))
      .reduce(
        (s, b) => s + Math.round(Number(b.payment_amount || 0) * 100),
        0,
      ) +
    (bank.loans || [])
      .filter(
        (l) =>
          ![
            "cancelled",
            "canceled",
            "completed",
            "paid",
            "paid_off",
            "closed",
            "rejected",
            "denied",
          ].includes(String(l.status).toLowerCase()),
      )
      .reduce(
        (s, l) =>
          s +
          Number(
            l.monthly_payment_cents ??
              Math.round(
                Number(l.monthly_payment ?? l.payment_amount ?? 0) * 100,
              ),
          ),
        0,
      ) +
    obligations
      .filter((o) => o.recurring && o.confirmed)
      .reduce((s, o) => s + Number(o.upperCents ?? o.amountCents ?? 0), 0);
  return { normal, income, fixed, months };
}
function deriveBudgets(ledger, forecast = {}, obligations = [], policy = {}) {
  const p = { ...defaults, ...policy },
    inputs =
      policy.inputs ||
      historyInputs(
        ledger,
        policy.now,
        policy.timeZone,
        policy.bank,
        obligations,
      );
  const { normal, income, fixed } = inputs,
    total = Object.values(normal).reduce((s, n) => s + n, 0),
    savings =
      policy.savingsGoalCents ??
      (income === null ? null : Math.floor(income * p.SAVINGS_SHARE)),
    room = income === null ? null : income - fixed - savings,
    scale =
      room === null || room >= total || !total
        ? 1
        : Math.max(p.MIN_SCALE, room / total),
    flags = [
      ...(income === null ? ["income_unknown"] : []),
      ...(room !== null && total && room / total < p.MIN_SCALE
        ? ["spending_above_income"]
        : []),
    ];
  const round = (n) =>
    Math.max(0, Math.floor((n * scale) / p.ROUND_TO_CENTS) * p.ROUND_TO_CENTS);
  const evidence = { ...inputs, total, savings, room, scale, flags, policy: p };
  return [
    ...Object.entries(normal)
      .filter(([, n]) => n > 0)
      .map(([category, n]) => ({
        category,
        limit_cents: round(n),
        period: p.PERIOD,
        source: "derived",
        evidence,
      })),
    {
      category: "all",
      limit_cents: round(total),
      period: p.PERIOD,
      source: "derived",
      evidence,
    },
  ];
}
function shouldDerive(current, next, now, timeZone) {
  if (!current) return true;
  if (current.source === "user") return false;
  if (current.evidence?.released) return true;
  if (
    localParts(current.effective_from, timeZone).month !==
    localParts(now, timeZone).month
  )
    return true;
  const a = current.evidence,
    b = next.evidence;
  return (
    (a.income !== b.income &&
      (a.income === null ||
        b.income === null ||
        Math.abs(a.income - b.income) > Math.abs(a.income) * 0.1)) ||
    Math.abs((a.fixed || 0) - (b.fixed || 0)) >= 5000
  );
}
function spentInPeriod(ledger, budget, now, timeZone) {
  const today = localParts(now, timeZone),
    start =
      budget.period === "week"
        ? require("./pipeline-utils").addDays(today.date, 1 - today.weekday)
        : today.month + "-01";
  return ledger
    .filter(
      (r) =>
        r.direction === "outflow" &&
        r.status === "completed" &&
        r.kind !== "bill_payment" &&
        (budget.category === "all" || r.category === budget.category) &&
        localParts(r.occurred_at, timeZone).date >= start &&
        Date.parse(r.occurred_at) <= +new Date(now),
    )
    .reduce((s, r) => s + net(r), 0);
}
module.exports = { deriveBudgets, historyInputs, shouldDerive, spentInPeriod };
