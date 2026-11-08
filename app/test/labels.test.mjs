// Tests for src/finance/labels.ts (display helpers) and the client's handling of operator-only 401s.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { usd, sourceWords, labelsLine, isCurrentOffer, callWords, callFinished, categoryTotals } = await import('../src/finance/labels.ts');

test('money is shown from cents, and a missing amount is never shown as zero', () => {
  assert.equal(usd(123456), '$1,234.56');
  assert.equal(usd(-500), '-$5.00');
  assert.equal(usd(null), 'Unavailable');
  assert.equal(usd(undefined), 'Unavailable');
});

test('every non-real source gets its fixed label', () => {
  assert.equal(sourceWords('nessie_sandbox'), 'Sandbox bank data');
  assert.equal(sourceWords('synthetic_persona'), 'Synthetic demo history');
  assert.equal(sourceWords('sample_offer'), 'Sample offer, written by the team, not from Capital One');
  assert.equal(labelsLine(['sample_offer', 'simulated_signup']), 'Includes a sample offer and a simulated signup.');
  assert.equal(labelsLine([]), null);
});

test('an offer is current only while active, unexpired and not stale', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const base = { id: 'o', program_id: 'p', merchant_name: 'M', message_id: 'm', terms: {}, status: 'active', expires_at: null, stale_at: '2026-11-09T00:00:00Z' };
  assert.equal(isCurrentOffer(base, now), true);
  assert.equal(isCurrentOffer({ ...base, status: 'needs_review' }, now), false);
  assert.equal(isCurrentOffer({ ...base, expires_at: '2026-11-08T11:00:00Z' }, now), false);
  assert.equal(isCurrentOffer({ ...base, stale_at: '2026-11-08T11:00:00Z' }, now), false);
});

test('call states have words, and polling stops once a call is finished', () => {
  assert.match(callWords('dial_requested'), /Photon accepted/);
  assert.equal(callFinished('dialing'), false);
  assert.equal(callFinished('ended'), true);
});

test('category totals cover one month only and are largest first', () => {
  const rows = [
    { date: '2026-11-02', amountCents: 1200, category: 'dining' },
    { date: '2026-11-03', amountCents: 300, category: 'coffee' },
    { date: '2026-11-05', amountCents: 800, category: 'dining' },
    { date: '2026-10-30', amountCents: 9999, category: 'retail' },
    { date: '2026-11-06', amountCents: 500, category: null },
  ];
  // November total is 2800 cents; October's retail purchase is left out.
  assert.deepEqual(categoryTotals(rows, '2026-11'), [
    { category: 'dining', cents: 2000, pct: 71 },
    { category: 'other', cents: 500, pct: 18 },
    { category: 'coffee', cents: 300, pct: 11 },
  ]);
});

test('a 401 from an operator-only route does not sign the user out; a 401 elsewhere does', async () => {
  process.env.EXPO_PUBLIC_FINANCE_API_URL = 'https://finance.test';
  const { setSessionStore, getSession, saveSession } = await import('../src/finance/session.ts');
  const memory = new Map();
  setSessionStore({
    getItemAsync: async (k) => memory.get(k) ?? null,
    setItemAsync: async (k, v) => { memory.set(k, v); },
    deleteItemAsync: async (k) => { memory.delete(k); },
  });
  await saveSession('owner-session-token');
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const { api, FinanceApiError } = await import('../src/finance/financeApi.ts');

  await assert.rejects(api('/api/text-obligations'), (e) => e instanceof FinanceApiError && e.status === 401);
  assert.equal(await getSession(), 'owner-session-token');

  await assert.rejects(api('/api/v1/budgets'), FinanceApiError);
  assert.equal(await getSession(), null);
});
