const { createHash } = require('node:crypto');
const { dayNumberOf } = require('./text-obligations');

const POSTED = new Set(['completed', 'executed']);
const CLOSED_LOANS = new Set(['cancelled', 'canceled', 'completed', 'paid', 'paid_off', 'closed', 'rejected', 'denied']);
const PAYROLL = /\b(?:payroll|paycheck|salary|pay check)\b/;
const NON_PAYROLL = /\b(?:transfer|refund|reimbursement|reversal|bonus|advance)\b/;
function bankDate(value) {
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  if (dayNumberOf(date) === null) return null;
  return value === date || (value[10] === 'T' && Number.isFinite(Date.parse(value))) ? date : null;
}

function normalizeName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
}

function toCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function scopedRecords(records, accountId) {
  return records?.filter((record) => record && typeof record._id === 'string' && record._id.trim()
    && (record.account_id == null || record.account_id === accountId)) ?? [];
}

function normalizeBankCashflow({ accountId, bills, loans, deposits, today, depositDate }) {
  const schedules = [];
  const postedBills = [];
  let unresolvedSchedules = 0;
  const billsById = Map.groupBy(scopedRecords(bills, accountId), ({ _id }) => _id);
  for (const copies of billsById.values()) {
    const [bill] = copies;
    const fields = ['status', 'payment_amount', 'payee', 'creation_date', 'payment_date', 'recurring_date', 'upcoming_payment_date'];
    if (copies.some((copy) => fields.some((field) => copy[field] !== bill[field]))) {
      unresolvedSchedules += 1;
      continue;
    }
    const amountCents = toCents(bill.payment_amount);
    const payee = normalizeName(bill.payee);
    const paymentDate = bankDate(bill.payment_date);
    if (bill.status === 'completed' && amountCents > 0 && paymentDate && paymentDate <= today) {
      postedBills.push({ payee, amountCents, date: paymentDate });
    }
    if (['completed', 'cancelled'].includes(bill.status)) continue;
    if (!['pending', 'recurring'].includes(bill.status)) {
      unresolvedSchedules += 1;
      continue;
    }
    const nextDate = bankDate(bill.upcoming_payment_date) ?? (bill.status === 'pending' ? paymentDate : null);
    const recurringDay = bill.status === 'recurring' && Number.isInteger(bill.recurring_date)
      && bill.recurring_date >= 1 && bill.recurring_date <= 31 ? bill.recurring_date : null;
    if (amountCents === 0) continue;
    if (!(amountCents > 0) || (bill.status === 'recurring' ? recurringDay === null : nextDate === null)) {
      unresolvedSchedules += 1;
    }
    if (amountCents > 0 && (nextDate || recurringDay)) schedules.push({
      source: 'nessie_bill', payee, amountCents, nextDate, recurringDay, creationDate: bankDate(bill.creation_date),
    });
  }
  // The Nessie loan schema includes a monthly amount but does not supply a repayment date.
  const activeLoans = scopedRecords(loans, accountId).filter((loan) => !CLOSED_LOANS.has(loan.status)
    && loan.status !== 'pending' && toCents(loan.monthly_payment) !== 0);
  unresolvedSchedules += new Set(activeLoans.map(({ _id }) => _id)).size;
  // An active row with missing identity or an unfamiliar response shape cannot
  // silently disappear. Ignore rows explicitly scoped to another account.
  for (const record of [...(bills ?? []), ...(loans ?? [])]) {
    if (record?.account_id != null && record.account_id !== accountId) continue;
    if (!record || typeof record._id !== 'string' || !record._id.trim()) unresolvedSchedules += 1;
  }

  const seenDeposits = new Set();
  const incomeHistory = [];
  for (const deposit of scopedRecords(deposits, accountId)) {
    const descriptor = normalizeName(deposit.description);
    const amountCents = toCents(deposit.amount);
    const date = depositDate(deposit.transaction_date);
    if (seenDeposits.has(deposit._id) || !POSTED.has(deposit.status) || !(amountCents > 0)
      || !date || date > today || dayNumberOf(today) - dayNumberOf(date) > 120
      || !PAYROLL.test(descriptor) || NON_PAYROLL.test(descriptor) || !descriptor.replace(PAYROLL, '').trim()) continue;
    seenDeposits.add(deposit._id);
    incomeHistory.push({ source: createHash('sha256').update(`${accountId}:${descriptor}`).digest('hex'), date, amountCents });
  }
  return {
    coverage: { bills: bills?.length ?? null, loans: loans?.length ?? null, deposits: deposits?.length ?? null },
    schedules: schedules.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    postedBills: postedBills.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    incomeHistory: incomeHistory.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.amountCents - b.amountCents),
    unresolvedSchedules,
  };
}

module.exports = { normalizeBankCashflow, normalizeName, toCents, POSTED };
