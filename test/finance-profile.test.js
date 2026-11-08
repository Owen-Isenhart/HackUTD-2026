const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFinanceProfile } = require('../backend/finance-profile');

const now = new Date('2026-11-07T05:30:00Z');
const env = { NESSIE_ACCOUNT_ID: 'demo-account', NESSIE_API_KEY: 'secret-key' };
const purchase = (id, date, amount, overrides = {}) => ({
  _id: id, payer_id: 'demo-account', merchant_id: 'demo-merchant', status: 'completed',
  purchase_date: date, amount, description: 'private memo', ...overrides,
});

function fixture({
  modelResult = { routineIndex: 0, reason: 'repeat_timing' },
  purchases = [
    purchase('first', '2026-10-30T17:00:00Z', 13.51),
    purchase('second', '2026-11-06T18:00:00Z', 14.5),
    purchase('second', '2026-11-06T18:00:00Z', 14.5),
    purchase('same-day', '2026-11-06T18:15:00Z', 15.50),
    purchase('date-only', '2026-11-06', 3.25),
    purchase('time-not-known', '2026-10-30', 4),
    purchase('old', '2026-06-05T17:00:00Z', 20),
    purchase('future', '2026-11-07T16:00:00Z', 200),
    purchase('pending', '2026-11-06T18:00:00Z', 500, { status: 'pending' }),
    purchase('other-account', '2026-11-06T18:00:00Z', 900, { payer_id: 'other' }),
    purchase('unresolved', '2026-11-06T04:00:00Z', 5, { merchant_id: 'unresolved' }),
  ],
} = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.pathname.endsWith('/chat/completions')) {
      return modelResult === null
        ? new Response(null, { status: 503 })
        : Response.json({ choices: [{ message: { content: JSON.stringify(modelResult) } }] });
    }
    assert.equal(url.origin, 'https://prod-api.nessieisreal.com');
    assert.equal(url.searchParams.get('key'), 'secret-key');
    assert.equal(options.redirect, 'error');
    switch (url.pathname) {
      case '/accounts/demo-account': return Response.json({ _id: 'demo-account', balance: 1500, account_number: 'secret-account-number' });
      case '/accounts/demo-account/purchases': return Response.json(purchases);
      case '/accounts/demo-account/bills': return Response.json([]);
      case '/accounts/demo-account/deposits': return new Response(null, { status: 503 });
      case '/merchants/demo-merchant': return Response.json({ _id: 'demo-merchant', name: 'Private merchant name', category: 'restaurant' });
      default: return new Response(null, { status: 404 });
    }
  };
  return { requests, build: () => buildFinanceProfile({ env, now, fetchImpl }) };
}

test('uses posted, owner-scoped purchases and distinct local days to build the profile', async () => {
  const { build, requests } = fixture();
  const profile = await build();
  assert.equal(profile.balanceCents, 150000);
  assert.deepEqual(profile.spend, {
    weekToDate: { count: 4, totalCents: 3825 },
    monthToDate: { count: 4, totalCents: 3825 },
    last90Days: { count: 6, totalCents: 5576 },
  });
  assert.deepEqual(profile.coverage, { billRecords: 0, depositRecords: null, purchasesWithoutResolvedMerchant: 1 });
  const midday = profile.routines.find(({ daypart }) => daypart === 'midday');
  assert.equal(midday.weekday, 'Friday');
  assert.equal(midday.observedDays, 2);
  assert.equal(midday.purchaseCount, 3);
  assert.equal(midday.typicalPurchaseCents, 1450);
  assert.equal(midday.confidence, 'tentative');
  assert.equal(profile.routines.find(({ daypart }) => daypart === null).typicalPurchaseCents, 363);
  assert.equal(profile.confirmedBudget, null);
  assert.equal(requests.filter(({ url }) => url.pathname === '/merchants/demo-merchant').length, 1);
});

test('sends only aggregate routine facts and validates the Nemotron highlight', async () => {
  const { build, requests } = fixture({ modelResult: { routineIndex: 1, reason: 'repeat_timing' } });
  const profile = await build();
  assert.deepEqual(profile.routineInsight, { status: 'interpreted', model: 'nemotron-bolt', routineIndex: 1, reason: 'repeat_timing' });
  const request = requests.find(({ options }) => options.method === 'POST');
  assert.equal(request.url.href, 'http://127.0.0.1:8000/v1/chat/completions');
  const body = JSON.parse(request.options.body);
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(JSON.parse(body.messages[1].content)[1], {
    index: 1, category: 'dining', weekday: 'Friday', daypart: 'midday', observedDays: 2, typicalPurchaseCents: 1450,
  });
  for (const privateValue of ['secret-key', 'secret-account-number', 'demo-account', 'demo-merchant', 'Private merchant name', 'private memo']) {
    assert.equal(request.options.body.includes(privateValue), false);
    assert.equal(JSON.stringify(profile).includes('secret-account-number'), false);
  }
});

test('falls back on invalid model output, unsupported timing, or unavailable Nemotron', async () => {
  for (const [modelResult, error] of [
    [{ routineIndex: 9, reason: 'repeat_timing' }, 'invalid_response'],
    [{ routineIndex: 0, reason: 'repeat_timing' }, 'unsupported_interpretation'],
    [null, 'http_503'],
  ]) {
    const profile = await fixture({ modelResult }).build();
    assert.deepEqual(profile.routineInsight, { status: 'unavailable', routineIndex: 0, error });
    assert.equal(profile.routines.length, 2);
  }
});

test('skips inference when the history has no repeated visits', async () => {
  const { build, requests } = fixture({ purchases: [purchase('only', '2026-11-06', 5)] });
  assert.deepEqual((await build()).routineInsight, { status: 'no_routine' });
  assert.equal(requests.some(({ options }) => options.method === 'POST'), false);
});
