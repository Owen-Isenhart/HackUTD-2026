const {
  hash,
  random,
  quantile,
  localParts,
  addDays,
  net,
  baseline,
} = require("./pipeline-utils");
function weeklyBlocks(ledger, asOf, timeZone) {
  const today = localParts(asOf, timeZone);
  const end = addDays(today.date, -today.weekday);
  const start = addDays(end, -181),
    totals = new Map();
  for (const r of ledger.filter(baseline)) {
    const d = localParts(r.occurred_at, timeZone).date;
    if (d >= start && d <= end) totals.set(d, (totals.get(d) || 0) + net(r));
  }
  return Array.from({ length: 26 }, (_, w) =>
    Array.from(
      { length: 7 },
      (_, d) => totals.get(addDays(start, w * 7 + d)) || 0,
    ),
  );
}
function scheduleCashflow(
  { ledger = [], bank = {}, asOf, timeZone, obligations = [] },
  days,
) {
  const today = localParts(asOf, timeZone).date;
  const schedule = new Map(days.map((d) => [d, { out: 0, in: 0 }])),
    commitments = [];
  const unresolved = new Set();
  const out = (date, amount, payee, source, estimated = false) => {
    if (schedule.has(date) && Number.isSafeInteger(amount) && amount > 0) {
      schedule.get(date).out += amount;
      commitments.push({ date, amount, payee, source, estimated });
    }
  };
  const billOccurrences = [];
  for (const b of bank.bills || []) {
    if (["cancelled", "completed"].includes(b.status)) continue;
    const amount = Math.round(Number(b.payment_amount) * 100);
    if (!Number.isSafeInteger(amount) || amount < 0 || b.payment_amount == null) {
      unresolved.add("bill_amount_unknown");
      continue;
    }
    const day = Number(b.recurring_date);
    if (day) {
      for (const d of days) {
        const month = d.slice(0, 7);
        const last = new Date(
          Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
        ).getUTCDate();
        if (Number(d.slice(-2)) === Math.min(day, last))
          billOccurrences.push({
            date: d,
            amount,
            payee: b.payee,
            billId: b.id,
          });
      }
    } else {
      const explicit = String(
        b.upcoming_payment_date || b.payment_date || "",
      ).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(explicit) || !Number.isFinite(Date.parse(explicit))) {
        unresolved.add("bill_date_unknown");
        continue;
      }
      billOccurrences.push({
        date: explicit < today ? today : explicit,
        paymentDate: explicit,
        amount,
        payee: b.payee,
        billId: b.id,
      });
    }
  }
  const { uniqueMatches: matchBills } = require("./finance-forecast");
  const posted = ledger.filter(
    (r) => r.kind === "bill_payment" && r.status === "completed",
  );
  const paid = matchBills(
    billOccurrences,
    posted,
    (b, p) =>
      (b.paymentDate ?? b.date) === localParts(p.occurred_at, timeZone).date &&
      b.amount === net(p) &&
      ((p.bill_id && b.billId === p.bill_id) ||
        (!p.bill_id &&
          b.payee &&
          String(p.descriptor || "")
            .toLowerCase()
            .includes(b.payee.toLowerCase()))),
  );
  for (const b of billOccurrences)
    if (!paid.has(b)) out(b.date, b.amount, b.payee || "Scheduled bill", "bill");
  for (const loan of bank.loans || []) {
    if (
      [
        "cancelled",
        "canceled",
        "completed",
        "paid",
        "paid_off",
        "closed",
        "rejected",
        "denied",
      ].includes(String(loan.status).toLowerCase())
    )
      continue;
    const amount = Number(
      loan.monthly_payment_cents ??
        Math.round(
          Number(loan.monthly_payment ?? loan.payment_amount ?? 0) * 100,
        ),
    );
    if (amount === 0 && loan.monthly_payment_cents === 0) continue;
    // The v2 loan resource supplies a monthly amount without a due date.
    unresolved.add("loan_schedule_unknown");
    if (!Number.isSafeInteger(amount) || amount <= 0) continue;
    for (const month of new Set(days.map((d) => d.slice(0, 7)))) {
      const day = days.find((d) => d.startsWith(month));
      out(day, amount, loan.description || "Loan payment reserve", "loan", true);
    }
  }
  const payroll = ledger
    .filter(
      (r) =>
        r.kind === "deposit" &&
        r.status === "completed" &&
        /PAYROLL/i.test(r.descriptor || "") &&
        Date.parse(r.occurred_at) < Date.parse(asOf),
    )
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
    .slice(-6);
  let incomeUnscheduled = true;
  if (payroll.length === 6) {
    const dates = payroll.map((r) => localParts(r.occurred_at, timeZone).date),
      gaps = dates
        .slice(1)
        .map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / 86400000);
    let interval = [7, 14].find((n) => gaps.every((g) => Math.abs(g - n) <= 2));
    const dom = dates.map((d) => Number(d.slice(-2)));
    let future = [];
    if (interval) {
      for (
        let d = addDays(dates.at(-1), interval);
        d <= days.at(-1);
        d = addDays(d, interval)
      )
        if (d >= today) future.push(d);
    } else if (
      gaps.every((g) => g >= 27 && g <= 32) &&
      Math.max(...dom) - Math.min(...dom) <= 3
    ) {
      future = days.filter((d) => Number(d.slice(-2)) === quantile(dom, 0.5));
    } else if (gaps.every((g) => g >= 12 && g <= 18)) {
      const first = dom.filter((d) => d <= 16),
        second = dom.filter((d) => d > 16);
      if (first.length >= 2 && second.length >= 2)
        future = days.filter((d) =>
          [quantile(first, 0.5), quantile(second, 0.5)].includes(
            Number(d.slice(-2)),
          ),
        );
    }
    if (future.length) {
      incomeUnscheduled = false;
      for (const d of future)
        schedule.get(d).in += Math.min(...payroll.map((r) => r.amount_cents));
    }
  }
  const normalized = (s) =>
    String(s || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const candidates = obligations.filter(
    (o) => o.amountCents != null || o.upperCents != null,
  );
  const { uniqueMatches } = require("./finance-forecast");
  const linked = uniqueMatches(
    candidates,
    commitments,
    (o, c) =>
      c.date === o.dueDate &&
      c.amount === Number(o.upperCents ?? o.amountCents) &&
      c.payee &&
      normalized(c.payee).length >= 4 &&
      normalized(o.evidence || o.description).includes(normalized(c.payee)),
  );
  for (const o of candidates)
    if (!linked.has(o)) {
      if (!o.dueDate) unresolved.add("plan_date_unknown");
      out(o.dueDate || today, Number(o.upperCents ?? o.amountCents), "Plan from messages", "plan", !o.dueDate);
    }
  for (const r of ledger)
    if (
      r.status === "pending" &&
      r.direction === "outflow" &&
      !(bank.balances || []).some(
        (a) => a.id === r.account_id && a.type === "Checking",
      ) &&
      r.provenance !== "synthetic_persona"
    )
      out(today, net(r), "Pending bank debit", "pending");
  return { schedule, commitments, unresolved: [...unresolved], incomeUnscheduled };
}
function forecastBands(inputs, { horizonDays = 30, paths = 1000 } = {}) {
  if (
    !Number.isInteger(horizonDays) ||
    horizonDays < 1 ||
    horizonDays > 90 ||
    !Number.isInteger(paths) ||
    paths < 1 ||
    paths > 10000
  )
    throw new Error("invalid_forecast_dimensions");
  const {
    ownerId = "",
    ledger = [],
    bank = {},
    asOf = new Date().toISOString(),
    timeZone = "America/Chicago",
    reserveCents = 0,
    obligations = [],
    pendingUnknownAmounts = 0,
  } = inputs;
  const checking = (bank.balances || []).filter((a) => a.type === "Checking");
  const startingBalanceCents =
    checking.length &&
    checking.every((a) => Number.isSafeInteger(a.available_cents))
      ? checking.reduce((s, a) => s + a.available_cents, 0)
      : null;
  const inputHash = hash({
    ownerId,
    ledger,
    bank,
    asOf,
    timeZone,
    reserveCents,
    obligations,
    pendingUnknownAmounts,
  });
  const rng = random(parseInt(inputHash.slice(0, 8), 16));
  const blocks = weeklyBlocks(ledger, asOf, timeZone);
  const dates = Array.from({ length: horizonDays }, (_, i) =>
    addDays(localParts(asOf, timeZone).date, i),
  );
  const { schedule, incomeUnscheduled, unresolved } = scheduleCashflow(
    { ...inputs, ledger, bank, asOf, timeZone, obligations },
    dates,
  );
  const weekdays = dates.map((d) => localParts(d + "T12:00Z", "UTC").weekday);
  const balances = dates.map(() => []),
    minima = [],
    spending = [];
  for (let p = 0; p < paths; p++) {
    let balance = startingBalanceCents ?? 0,
      minimum = balance,
      block,
      total = 0;
    for (let d = 0; d < dates.length; d++) {
      const weekday = weekdays[d];
      if (!block || weekday === 1)
        block = blocks[Math.floor(rng() * blocks.length)];
      const spend = block[weekday - 1],
        scheduled = schedule.get(dates[d]);
      balance -= spend + scheduled.out;
      minimum = Math.min(minimum, balance);
      balance += scheduled.in;
      balances[d].push(balance);
      total += spend;
    }
    minima.push(minimum);
    spending.push(total);
  }
  const minimumBalanceLowCents =
    startingBalanceCents === null ? null : quantile(minima, 0.1);
  const missingSources = [
    ...unresolved,
    ...(startingBalanceCents === null ? ["checking_balance"] : []),
    ...(pendingUnknownAmounts ||
    obligations.some((o) => o.amountCents == null && o.upperCents == null)
      ? ["unbounded_obligation"]
      : []),
    ...(bank.coverage?.some((c) => c.truncated && !c.recovered)
      ? ["truncated_ledger"]
      : []),
  ];
  return {
    method: "weekly_block_bootstrap_v1",
    inputHash,
    asOf,
    validUntil: new Date(Date.parse(asOf) + 1800000).toISOString(),
    horizonDays,
    startingBalanceCents,
    minimumBalanceLowCents,
    safeToSpendCents: missingSources.length
      ? null
      : Math.max(0, minimumBalanceLowCents - reserveCents),
    chanceBelowReserve: minima.filter((n) => n < reserveCents).length / paths,
    incomeUnscheduled,
    coverage: bank.coverage || [],
    missingSources,
    daily: dates.map((date, i) => ({
      date,
      lowCents: quantile(balances[i], 0.1),
      middleCents: quantile(balances[i], 0.5),
      highCents: quantile(balances[i], 0.9),
    })),
    spending: {
      lowCents: quantile(spending, 0.1),
      middleCents: quantile(spending, 0.5),
      highCents: quantile(spending, 0.9),
    },
  };
}
module.exports = { forecastBands, weeklyBlocks, scheduleCashflow };
