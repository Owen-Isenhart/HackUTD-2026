const assert = require('node:assert/strict');
const { test } = require('node:test');
const { financeForecast } = require('../backend/finance-forecast');
const { normalizeBankCashflow } = require('../backend/nessie-cashflow');

const now = new Date('2027-02-25T16:00:00Z');
const bill = (id, payee, amount, fields) => ({ _id: id, payee, payment_amount: amount, ...fields });
const normalize = (inputs) => normalizeBankCashflow({ accountId: 'owner', bills: [], deposits: [], loans: [],
  today: '2027-02-25', depositDate: (date) => date, ...inputs });
const profile = (fields) => ({ asOf: now.toISOString(), timeZone: 'America/Chicago', balanceCents: 10_000, ...fields });
const purchase = (date, merchant, amountCents) => ({ type: 'purchase', date, merchant, amountCents, category: 'dining' });

test('uses provider due dates, clamps recurring months and leaves an undated loan unresolved', () => {
  const bankCashflow = normalize({ bills: [
    bill('recurring', 'Rent office', 15, { status: 'recurring', recurring_date: 31, upcoming_payment_date: '2027-02-27' }),
    bill('pending', 'Power company', 8, { status: 'pending', payment_date: '2027-02-28T00:00:00Z' }),
    bill('foreign', 'Other account', 500, { status: 'pending', payment_date: '2027-02-25', account_id: 'other' }),
    bill('cancelled', 'Cancelled bill', 500, { status: 'cancelled', payment_date: '2027-02-25' }),
  ], loans: [{ _id: 'loan-1', status: 'in_repayment', monthly_payment: 900 }] });
  const result = financeForecast(profile({ bankCashflow }), now, 90);
  assert.deepEqual(result.projection.filter(({ outflowCents }) => outflowCents).map(({ date, outflowCents }) => [date, outflowCents]),
    [['2027-02-27', 1500], ['2027-02-28', 800], ['2027-03-31', 1500], ['2027-04-30', 1500]]);
  assert.equal(result.minimumProjectedBalanceCents, 4700);
  assert.equal(result.minimumBalanceDate, '2027-04-30');
  assert.equal(result.unresolvedSchedules, 1);
  assert.equal(result.safeSpendCents, null);
});

test('matches a plan, scheduled bill and posted payment once and preserves ambiguous or unrelated plans', () => {
  const today = '2027-02-25';
  const bankCashflow = normalize({ bills: [
    bill('upcoming', 'ACME Internet', 30, { status: 'recurring', recurring_date: 25 }),
    bill('paid', 'ACME Internet', 30, { status: 'completed', payment_date: today }),
  ] });
  const same = { amountCents: 3000, dueDate: today, evidence: 'ACME Internet payment due today' };
  const unrelated = { amountCents: 3000, dueDate: today, evidence: 'Trip deposit for hotel' };
  const transactions = [purchase(today, 'Acme Internet', 3000)];
  const base = profile({ bankCashflow, transactions });
  const result = financeForecast({ ...base, socialObligations: { upcoming: [same, unrelated] } }, now, 7);
  assert.deepEqual(result.reconciliation, { linkedPlans: 1, matchedPostedPayments: 1 });
  assert.equal(result.projection[0].outflowCents, 3000);
  assert.deepEqual(result.postedBillOutflows, []);

  const ambiguous = financeForecast({ ...base, socialObligations: { upcoming: [same, { ...same }] } }, now, 7);
  assert.deepEqual(ambiguous.reconciliation, { linkedPlans: 0, matchedPostedPayments: 0 });
  assert.equal(ambiguous.projection[0].outflowCents, 9000);
});

test('derives payroll and discretionary estimates separately from known headroom', () => {
  const deposit = (id, transaction_date, amount, description = 'Acme Payroll', status = 'completed') =>
    ({ _id: id, transaction_date, amount, description, status });
  const bankCashflow = normalize({ deposits: [
    deposit('p1', '2027-02-01', 100), deposit('p2', '2027-02-08', 120), deposit('p3', '2027-02-15', 110), deposit('p4', '2027-02-22', 120),
    deposit('p4', '2027-02-22', 120), deposit('pending', '2027-02-24', 1000, 'Acme Payroll', 'pending'),
    deposit('other', '2027-02-23', 1500, 'Side Job Payroll'), deposit('transfer', '2027-02-23', 3000, 'Payroll transfer'),
  ], bills: [bill('paid', 'Fixed', 60, { status: 'completed', payment_date: '2027-02-01' }),
    bill('due', 'Utilities', 20, { status: 'pending', payment_date: '2027-03-04' })] });
  const transactions = ['2027-01-01', '2027-01-08', '2027-01-15', '2027-01-22'].map((date) => purchase(date, 'Cafe', 1500));
  transactions.push(purchase('2027-02-01', 'Fixed', 6000), purchase('2027-02-25', 'Cafe', 7000));
  const base = profile({ bankCashflow, historyStartDate: '2026-12-01', confirmedReserveCents: 1000, transactions });
  const result = financeForecast(base, now, 14);
  assert.deepEqual(result.estimates.payroll, [{ cadence: 'weekly', amountCents: 11500, observations: 4, dates: ['2027-03-01', '2027-03-08'] }]);
  assert.equal(result.estimates.dailyDiscretionaryCents, 100);
  assert.equal(result.minimumProjectedBalanceCents, 8000);
  assert.equal(result.safeSpendCents, 7000);
  assert.equal(result.estimatedEndingBalanceCents, 29600);
  assert.equal(financeForecast(base, now, 14, { includeEstimates: false }).safeSpendCents, 7000);
});

test('distinguishes empty feeds from missing data, blocks unbounded obligations and excludes card credit', () => {
  const bankCashflow = normalize({ deposits: null, loans: null });
  const unavailable = financeForecast(profile({ bankCashflow }), now, 7);
  assert.deepEqual(unavailable.missingSources, ['loans', 'deposits']);
  assert.equal(unavailable.safeSpendCents, null);
  assert.equal(financeForecast(profile({ bankCashflow: normalize({ deposits: null }) }), now, 7).safeSpendCents, 10_000);
  assert.equal(financeForecast(profile({ socialObligations: { unverifiedPendingCount: 1 } }), now, 7).safeSpendCents, null);
  assert.equal(financeForecast(profile({ accountType: 'credit card' }), now, 7).startingBalanceCents, null);
  assert.equal(financeForecast(profile({ refreshStatus: 'cached' }), now, 7).safeSpendCents, null);
});

test('distinguishes semimonthly payroll from a two-week interval across short months', () => {
  const deposits = ['2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31']
    .map((transaction_date) => ({ _id: transaction_date, transaction_date, amount: 25, description: 'Acme payroll', status: 'completed' }));
  const bankCashflow = normalize({ today: '2027-04-01', deposits });
  const result = financeForecast(profile({ bankCashflow }), new Date('2027-04-01T16:00:00Z'), 45);
  assert.deepEqual(result.estimates.payroll[0], {
    cadence: 'semimonthly', amountCents: 2500, observations: 6, dates: ['2027-04-15', '2027-04-30', '2027-05-15'],
  });
});
