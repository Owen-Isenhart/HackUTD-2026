const { readNessie } = require('./nessie');
const { interpretRoutines } = require('./nemotron');
const { daypart } = require('../src/routineTime');

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 90;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const POSTED_STATUSES = new Set(['completed', 'executed']);
const CATEGORIES = new Map([
  ['restaurant', 'dining'],
  ['coffee shop', 'coffee'],
  ['groceries', 'groceries'],
  ['gas station', 'fuel'],
]);

function toCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function dayNumber(date) {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
  return timestamp / DAY_MS;
}

function localDateTime(formatter, instant) {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function purchaseDateTime(value, formatter, now) {
  if (typeof value !== 'string' || dayNumber(value.slice(0, 10)) === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value, hour: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && instant <= now.getTime() ? localDateTime(formatter, instant) : null;
}

function medianCents(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return sorted[middle - 1] + Math.round((sorted[middle] - sorted[middle - 1]) / 2);
}

function postedPurchases(records, accountId, formatter, now) {
  const unique = new Map();
  for (const record of records) {
    if (record?.payer_id !== accountId || typeof record._id !== 'string' || !record._id
      || !POSTED_STATUSES.has(record.status)) continue;
    const cents = toCents(record.amount);
    const when = purchaseDateTime(record.purchase_date, formatter, now);
    if (cents === null || cents < 0 || !when) continue;
    const merchantId = typeof record.merchant_id === 'string' && record.merchant_id ? record.merchant_id : null;
    const purchase = { ...when, id: record._id, merchantId, cents };
    if (!unique.has(purchase.id)) unique.set(purchase.id, purchase);
  }
  return [...unique.values()];
}

function calculateRoutines(history, merchants, timeZone) {
  const patterns = new Map();
  for (const purchase of history) {
    const merchant = merchants.get(purchase.merchantId);
    if (!merchant) continue;
    const weekday = WEEKDAYS[new Date(`${purchase.date}T00:00:00Z`).getUTCDay()];
    const window = daypart(purchase.hour);
    const key = JSON.stringify([purchase.merchantId, weekday, window]);
    if (!patterns.has(key)) patterns.set(key, { merchant, weekday, window, purchases: [] });
    patterns.get(key).purchases.push(purchase);
  }

  const routines = [];
  for (const { merchant, weekday, window, purchases } of patterns.values()) {
    const dates = [...new Set(purchases.map(({ date }) => date))].sort();
    if (dates.length < 2) continue;
    routines.push({
      merchant: merchant.name,
      category: CATEGORIES.get(String(merchant.category).trim().toLowerCase()) ?? 'other',
      weekday,
      daypart: window,
      timeZone,
      observedDays: dates.length,
      purchaseCount: purchases.length,
      typicalPurchaseCents: medianCents(purchases.map(({ cents }) => cents)),
      confidence: dates.length >= 4 ? 'higher' : 'tentative',
      provenance: {
        source: 'nessie_purchase_history',
        merchantSourceId: purchases[0].merchantId,
        firstSeen: dates[0],
        lastSeen: dates.at(-1),
      },
    });
  }
  return routines.sort((a, b) => b.observedDays - a.observedDays
    || b.provenance.lastSeen.localeCompare(a.provenance.lastSeen)
    || a.merchant.localeCompare(b.merchant) || a.weekday.localeCompare(b.weekday)
    || (a.daypart ?? '').localeCompare(b.daypart ?? ''));
}

function summarizePurchases(purchases) {
  return { count: purchases.length, totalCents: purchases.reduce((sum, purchase) => sum + purchase.cents, 0) };
}

async function buildFinanceProfile({ env = process.env, fetchImpl = fetch, now = new Date() } = {}) {
  const timeZone = env.FINANCE_TIME_ZONE || 'America/Chicago';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const { date: today } = localDateTime(formatter, now);
  const todayNumber = dayNumber(today);
  const historyStart = todayNumber - HISTORY_DAYS + 1;
  const daysSinceMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const weekStart = todayNumber - daysSinceMonday;
  const monthStart = today.slice(0, 7);

  const { account, purchases, billCount, depositCount, getMerchants } = await readNessie({
    accountId: env.NESSIE_ACCOUNT_ID, apiKey: env.NESSIE_API_KEY, fetchImpl,
  });
  const history = postedPurchases(purchases, account._id, formatter, now)
    .filter(({ date }) => dayNumber(date) >= historyStart && date <= today);
  const merchantIds = [...new Set(history.map(({ merchantId }) => merchantId).filter(Boolean))];
  const merchants = await getMerchants(merchantIds);
  const routines = calculateRoutines(history, merchants, timeZone);
  const routineInsight = await interpretRoutines(routines, { env, fetchImpl });

  return {
    schemaVersion: 1,
    asOf: now.toISOString(),
    currency: 'USD',
    timeZone,
    source: 'nessie_sandbox',
    historyStartDate: new Date(historyStart * DAY_MS).toISOString().slice(0, 10),
    balanceCents: toCents(account.balance),
    spend: {
      weekToDate: summarizePurchases(history.filter(({ date }) => dayNumber(date) >= weekStart)),
      monthToDate: summarizePurchases(history.filter(({ date }) => date.startsWith(monthStart))),
      last90Days: summarizePurchases(history),
    },
    coverage: {
      billRecords: billCount,
      depositRecords: depositCount,
      purchasesWithoutResolvedMerchant: history.filter(({ merchantId }) => !merchants.has(merchantId)).length,
    },
    confirmedBudget: null,
    confirmedGoals: null,
    routines,
    routineInsight,
  };
}

module.exports = { buildFinanceProfile };
