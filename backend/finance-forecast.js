const { normalizeName } = require('./nessie-cashflow');
const { dayNumberOf, localParts } = require('./text-obligations');

const DAY_MS = 86_400_000;
const BURN_WINDOW_DAYS = 60;
const variableCategories = new Set(['dining', 'coffee', 'groceries', 'fuel', 'retail']);
const dateOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const amountKnown = (value) => Number.isSafeInteger(value) && value >= 0;

function monthDates(days, start, end) {
  const first = new Date(start * DAY_MS);
  const last = new Date(end * DAY_MS);
  const dates = [];
  const firstMonth = first.getUTCFullYear() * 12 + first.getUTCMonth();
  const lastMonth = last.getUTCFullYear() * 12 + last.getUTCMonth();
  for (let month = firstMonth; month <= lastMonth; month += 1) {
    const year = Math.floor(month / 12);
    const index = month % 12;
    const lastDay = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    for (const day of new Set(days.map((value) => Math.min(value, lastDay)))) {
      const occurrence = Date.UTC(year, index, day) / DAY_MS;
      if (occurrence >= start && occurrence <= end) dates.push(occurrence);
    }
  }
  return dates.sort((a, b) => a - b);
}

function bankOccurrences(schedules, start, end) {
  return schedules.flatMap((schedule) => {
    const explicit = dayNumberOf(schedule.nextDate);
    const creation = dayNumberOf(schedule.creationDate);
    const anchorMonth = explicit === null ? null : dateOf(explicit).slice(0, 7);
    const dates = schedule.recurringDay
      ? monthDates([schedule.recurringDay], Math.max(start, explicit ?? start, creation ?? start), end)
        .filter((day) => dateOf(day).slice(0, 7) !== anchorMonth)
      : [];
    if (explicit !== null && explicit <= end) dates.push(explicit);
    return dates.map((day) => ({ ...schedule, day, date: dateOf(day) }));
  });
}

const exactPayment = (a, b) => Boolean(a.payee) && a.payee === b.payee && a.amountCents === b.amountCents && a.date === b.date;
const mentionsPayee = (evidence, payee) => payee.length >= 4 && ` ${normalizeName(evidence)} `.includes(` ${payee} `);

// Reconcile only mutually unique matches. An ambiguous match must leave both expenses visible.
function uniqueMatches(left, right, matches) {
  const byRight = new Map();
  const byLeft = left.map((row) => right.filter((other) => {
    if (!matches(row, other)) return false;
    byRight.set(other, (byRight.get(other) ?? 0) + 1);
    return true;
  }));
  return new Map(left.flatMap((row, index) => {
    const [match] = byLeft[index];
    return byLeft[index].length === 1 && byRight.get(match) === 1 ? [[row, match]] : [];
  }));
}

function reconcileOutflows(profile, start, end) {
  const bank = profile.bankCashflow;
  const plans = profile.socialObligations;
  const postedBills = bank?.postedBills ?? [];
  const purchases = (profile.transactions ?? []).filter((row) => row.type === 'purchase' && row.date <= dateOf(start))
    .map((row) => ({ ...row, payee: normalizeName(row.merchant) }));
  const billPurchases = uniqueMatches(purchases, postedBills, exactPayment);
  const purchasedBills = new Set(billPurchases.values());
  const posted = [...postedBills, ...purchases.filter((row) => !billPurchases.has(row))];
  const scheduled = bankOccurrences(bank?.schedules ?? [], start, end);
  const social = [...(plans?.upcoming ?? []), ...(plans?.pendingClarifications ?? [])]
    .filter((row) => amountKnown(row.amountCents))
    .map((row) => ({ ...row, date: row.dueDate, day: row.dueDate ? dayNumberOf(row.dueDate) : start, source: 'photon' }))
    .filter((row) => row.day !== null && row.day >= start && row.day <= end);
  const linked = uniqueMatches(social, scheduled, (plan, bill) => plan.amountCents === bill.amountCents
    && plan.date === bill.date && mentionsPayee(plan.evidence, bill.payee));
  const upcoming = [...scheduled, ...social.filter((plan) => !linked.has(plan))];
  const paid = uniqueMatches(upcoming, posted, (plan, payment) => plan.amountCents === payment.amountCents && plan.date === payment.date
    && (plan.source === 'photon' ? mentionsPayee(plan.evidence, payment.payee) : exactPayment(plan, payment)));
  const historicalSchedules = (bank?.schedules ?? []).map((schedule) => schedule.recurringDay && schedule.creationDate
    ? { ...schedule, nextDate: null } : schedule);
  const historicalBills = bankOccurrences(historicalSchedules, start - BURN_WINDOW_DAYS, start - 1);
  const historicalMatches = uniqueMatches(purchases, historicalBills, exactPayment);
  const paidPurchases = new Set([...paid.values()]);
  return {
    outflows: upcoming.filter((row) => !paid.has(row)),
    reconciliation: { linkedPlans: linked.size, matchedPostedPayments: paid.size },
    postedBillOutflows: postedBills.filter((row) => !purchasedBills.has(row)).map(({ date, amountCents }) => ({ date, amountCents })),
    variablePurchases: purchases.filter((row) => variableCategories.has(row.category) && !billPurchases.has(row)
      && !historicalMatches.has(row) && !paidPurchases.has(row)),
  };
}

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1] + Math.round((sorted[mid] - sorted[mid - 1]) / 2);
}

function inferCadence(observations) {
  const gaps = observations.slice(1).map((day, index) => day - observations[index]);
  if (gaps.every((gap) => Math.abs(gap - 7) <= 1)) return { cadence: 'weekly', interval: 7 };
  const parts = observations.map((day) => dateOf(day));
  const monthlyDay = Math.max(...parts.map((date) => Number(date.slice(-2))));
  const monthly = monthDates([monthlyDay], observations[0] - 2, observations.at(-1) + 2);
  if (gaps.every((gap) => gap >= 26 && gap <= 33)
    && monthly.length === observations.length && monthly.every((day, index) => Math.abs(day - observations[index]) <= 2)) {
    return { cadence: 'monthly', days: [monthlyDay] };
  }
  if (parts.length >= 6 && gaps.every((gap) => gap >= 12 && gap <= 19)) {
    const anchors = [0, 1].map((parity) => Math.max(...parts.filter((_, index) => index % 2 === parity).map((date) => Number(date.slice(-2)))));
    if (anchors[0] !== anchors[1]) {
      const expected = monthDates(anchors, observations[0] - 2, observations.at(-1) + 2);
      if (expected.length === observations.length && expected.every((day, index) => Math.abs(day - observations[index]) <= 2)) {
        return { cadence: 'semimonthly', days: anchors };
      }
    }
  }
  if (gaps.every((gap) => Math.abs(gap - 14) <= 2)) return { cadence: 'biweekly', interval: 14 };
  return null;
}

function payrollEstimates(history, start, end) {
  const groups = Map.groupBy(history, ({ source }) => source);
  return [...groups.values()].flatMap((records) => {
    const samples = records.filter(({ date }) => dayNumberOf(date) <= start).slice(-8);
    const observed = samples.map(({ date }) => dayNumberOf(date));
    if (observed.length < 3 || new Set(observed).size !== observed.length) return [];
    const cadence = inferCadence(observed);
    if (!cadence) return [];
    const last = observed.at(-1);
    const dates = cadence.interval
      ? Array.from({ length: Math.max(0, Math.floor((end - last) / cadence.interval)) }, (_, index) => last + (index + 1) * cadence.interval)
      : monthDates(cadence.days, last + 3, end);
    if (!dates.length || dates[0] < start - 2) return [];
    const projected = dates.filter((date) => date >= start);
    if (!projected.length) return [];
    return [{ cadence: cadence.cadence, amountCents: median(samples.map(({ amountCents }) => amountCents)),
      observations: samples.length, dates: projected.map(dateOf) }];
  });
}

function financeForecast(profile, now = new Date(), days = 30, { includeEstimates = true } = {}) {
  const start = dayNumberOf(localParts(now, profile.timeZone).date);
  const end = start + days - 1;
  const bank = profile.bankCashflow;
  const plans = profile.socialObligations;
  const { outflows, reconciliation, postedBillOutflows, variablePurchases } = reconcileOutflows(profile, start, end);
  const expenses = Map.groupBy(outflows, (row) => Math.max(start, row.day));
  const sumAmounts = (rows) => rows.reduce((total, row) => total + row.amountCents, 0);
  const startingBalanceCents = Number.isSafeInteger(profile.balanceCents) && profile.accountType !== 'credit card' ? profile.balanceCents : null;
  const reserveCents = amountKnown(profile.confirmedReserveCents) ? profile.confirmedReserveCents : 0;
  const unresolvedSchedules = bank?.unresolvedSchedules ?? 0;
  const missingSources = bank ? Object.entries(bank.coverage).filter(([, count]) => count === null).map(([source]) => source) : ['bank_cashflow'];
  const legacyNeedsRefresh = !bank && ['billRecords', 'loanRecords'].some((key) => Object.hasOwn(profile.coverage ?? {}, key) && profile.coverage[key] !== 0);
  const pendingUnknownAmounts = plans?.unverifiedPendingCount ?? 0;
  const payroll = includeEstimates ? payrollEstimates(bank?.incomeHistory ?? [], start, end) : [];
  const variableHistory = variablePurchases.filter(({ date }) => date >= dateOf(start - BURN_WINDOW_DAYS) && date < dateOf(start));
  const historyStart = dayNumberOf(profile.historyStartDate);
  const burnCents = includeEstimates && historyStart !== null && historyStart <= start - BURN_WINDOW_DAYS
    && new Set(variableHistory.map(({ date }) => date)).size >= 4
    ? Math.round(sumAmounts(variableHistory) / BURN_WINDOW_DAYS) : null;
  let balance = startingBalanceCents;
  let scenarioBalance = startingBalanceCents;
  const projection = Array.from({ length: days }, (_, offset) => {
    const date = dateOf(start + offset);
    const due = expenses.get(start + offset) ?? [];
    const scheduledOutflowCents = sumAmounts(due.filter(({ source }) => source !== 'photon'));
    const photon = due.filter(({ source }) => source === 'photon');
    const photonOutflowCents = sumAmounts(photon);
    const outflowCents = scheduledOutflowCents + photonOutflowCents;
    if (balance !== null) balance -= outflowCents;
    const point = { date, outflowCents, scheduledOutflowCents, photonOutflowCents, photonObligationCount: photon.length, balanceAfterKnownPlansCents: balance };
    if (includeEstimates) {
      const estimatedPayrollCents = sumAmounts(payroll.filter(({ dates }) => dates.includes(date)));
      if (scenarioBalance !== null) scenarioBalance += estimatedPayrollCents - outflowCents - (burnCents ?? 0);
      Object.assign(point, { estimatedPayrollCents, estimatedDiscretionaryCents: burnCents,
        estimatedBalanceCents: payroll.length || burnCents !== null ? scenarioBalance : null });
    }
    return point;
  });
  const minimumProjectedBalanceCents = projection.at(-1)?.balanceAfterKnownPlansCents ?? null;
  const minimumBalanceDate = minimumProjectedBalanceCents === null ? null
    : projection.find(({ balanceAfterKnownPlansCents }) => balanceAfterKnownPlansCents === minimumProjectedBalanceCents)?.date ?? null;
  const safeSpendCents = minimumProjectedBalanceCents === null || pendingUnknownAmounts || unresolvedSchedules
    || legacyNeedsRefresh || missingSources.some((source) => source === 'bills' || source === 'loans') || profile.refreshStatus === 'cached'
    ? null : Math.max(0, minimumProjectedBalanceCents - reserveCents);
  return {
    status: profile.refreshStatus === 'cached' ? 'cached' : 'partial',
    coverage: ['posted_balance', ...(plans ? ['photon_outflows'] : []),
      ...(bank?.coverage?.bills != null ? ['nessie_bills'] : []), ...(bank?.coverage?.loans != null ? ['nessie_loans'] : [])],
    missingSources, unresolvedSchedules, reconciliation, postedBillOutflows,
    asOf: profile.asOf, days, currency: profile.currency ?? 'USD', timeZone: profile.timeZone,
    pendingUnknownAmounts, expectedInflowCents: plans?.expectedInflowCents ?? 0,
    profileVersion: profile.profileVersion ?? null, obligationsVersion: plans?.version ?? null,
    startingBalanceCents, minimumProjectedBalanceCents, minimumBalanceDate, reserveCents, safeSpendCents,
    estimatedEndingBalanceCents: projection.at(-1)?.estimatedBalanceCents ?? null,
    estimates: { payroll, dailyDiscretionaryCents: burnCents, discretionaryWindowDays: BURN_WINDOW_DAYS },
    projection,
  };
}

module.exports = { financeForecast, uniqueMatches };
