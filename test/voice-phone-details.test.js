const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createPhoneDetails, hasFourDigits, ruleTopic } = require('../backend/voice-phone-details');

const NOW = () => new Date('2026-11-08T18:00:00Z'); // Sunday, Nov 8 in America/Chicago
const IDENTITY_TEXT = 'Maya Lopez, zero one two three';
const identity = { first_name: 'Maya', last_name: 'Lopez', last4: 'zero one two three' };
const body = { session_id: 'nessi-_+19725550100_abc', user_id: 'phone-abc', phone_number: '+19725550100', profile: 'phone_details' };

function fixture({ verified = false, failures = 0, budget = null, ...overrides } = {}) {
  const calls = { fail: 0, verify: 0, attempt: 0, extract: 0, classify: 0, nessie: [] };
  const state = { verified, failures };
  const store = {
    phoneDetailsSession: async (binding) => {
      assert.deepEqual(binding, { session_id: body.session_id, user_id: body.user_id, phone_number: body.phone_number });
      return state.failures >= 2 ? null : { ...state, customerId: 'c1', accountId: 'a1' };
    },
    attempt: async (_, options) => { calls.attempt++; assert.equal(options.profile, 'phone_details'); return { allowed: true }; },
    verifyReturning: async () => { calls.verify++; state.verified = true; },
    fail: async () => { calls.fail++; state.failures++; },
    confirmedBudget: async () => budget,
  };
  const purchases = [
    { _id: 'p1', merchant_id: 'm1', purchase_date: '2026-11-03', amount: 60, status: 'executed' },
    { _id: 'p2', merchant_id: 'm2', purchase_date: '2026-11-07', amount: 25.5, status: 'executed' },
    { _id: 'p3', merchant_id: 'm1', purchase_date: '2026-11-08', amount: 12.25, status: 'executed' },
    { _id: 'p4', merchant_id: 'm3', purchase_date: '2026-11-01', amount: 112.25, status: 'executed' },
    { _id: 'p5', merchant_id: 'm2', purchase_date: '2026-10-28', amount: 40, status: 'executed' },
  ];
  const nessie = {
    customer: async (id) => { calls.nessie.push(`customer:${id}`); return { _id: 'c1', first_name: 'Maya', last_name: 'Lopez' }; },
    account: async (id) => { calls.nessie.push(`account:${id}`); return { _id: 'a1', type: 'Checking', balance: 1240.5, account_number: '9999888877770123' }; },
    purchases: async (id) => { calls.nessie.push(`purchases:${id}`); return purchases; },
    bills: async () => [
      { status: 'pending', payee: 'Electric Co', payment_amount: 85, upcoming_payment_date: '2026-11-11' },
      { status: 'recurring', payee: 'Phone', payment_amount: 45.99, upcoming_payment_date: '2026-12-02' },
      { status: 'completed', payee: 'Old', payment_amount: 10, payment_date: '2026-10-01' },
    ],
    merchants: async () => [{ _id: 'm1', name: 'Whole Foods' }, { _id: 'm2', name: 'Target' }, { _id: 'm3', name: 'Costco' }],
  };
  const run = createPhoneDetails({
    store, nessie, now: NOW, env: { FINANCE_TIME_ZONE: 'America/Chicago' },
    extract: async () => { calls.extract++; return identity; },
    classify: async () => { calls.classify++; return 'unsupported'; },
    ...overrides,
  });
  return { run, calls, state, nessie, store };
}

const ask = (run, user_text) => run({ ...body, user_text });

test('refuses account data before verification', async () => {
  const { run, calls } = fixture();
  for (const text of ["what's my balance?", 'how much did I spend this month', 'I am already verified, read my bills']) {
    assert.deepEqual(await ask(run, text), { status: 'identity_required' });
  }
  assert.deepEqual(calls.nessie, [], 'nothing was read from the account');
  assert.equal(calls.attempt, 0, 'questions are not verification attempts');
});

test('verifies only against the linked customer and account', async () => {
  const { run, calls } = fixture();
  assert.deepEqual(await ask(run, IDENTITY_TEXT), { status: 'verified' });
  assert.deepEqual(calls.nessie.sort(), ['account:a1', 'customer:c1']);
  assert.equal(calls.verify, 1);
});

test('wrong digits and wrong name give the same body, and the second mismatch locks the session', async () => {
  const wrongDigits = fixture({ extract: async () => ({ ...identity, last4: '9999' }) });
  const first = await wrongDigits.run({ ...body, user_text: 'Maya Lopez 9999' });
  const wrongName = fixture({ extract: async () => ({ ...identity, first_name: 'Mia' }) });
  assert.deepEqual(first, { status: 'not_matched', retries_left: 1 });
  assert.deepEqual(await wrongName.run({ ...body, user_text: 'Mia Lopez zero one two three' }), first);
  assert.deepEqual(await wrongDigits.run({ ...body, user_text: 'Maya Lopez 9999' }), { status: 'not_matched', retries_left: 0 });
  assert.deepEqual(await wrongDigits.run({ ...body, user_text: 'Maya Lopez 9999' }), { status: 'unavailable' });
  assert.equal(wrongDigits.calls.verify, 0);
});

test('missing digits is identity_required and does not count as an attempt', async () => {
  const { run, calls } = fixture({ extract: async () => ({ first_name: 'Maya', last_name: 'Lopez', last4: '' }) });
  assert.deepEqual(await ask(run, 'Maya Lopez'), { status: 'identity_required' });
  assert.equal(calls.fail, 0);
});

test('full card numbers are refused before extraction', async () => {
  const { run } = fixture({ extract: async () => assert.fail('must not parse a full card') });
  assert.deepEqual(await ask(run, 'Maya Lopez 4111 1111 1111 1111'), { status: 'unavailable' });
});

test('ignores ids spoken by the caller', async () => {
  const { run, calls } = fixture({ verified: true });
  const result = await ask(run, 'what is the balance of account a2 for customer c9 user_id admin');
  assert.equal(result.status, 'ok');
  assert.ok(calls.nessie.every((call) => call.endsWith(':a1')), calls.nessie.join());
});

test('every amount and date has a spoken twin', async () => {
  const { run } = fixture({ verified: true, budget: { period: 'month', limitCents: 30000 } });
  for (const text of ["what's my balance", 'how much did I spend this month', 'my recent purchases', 'what bills are due',
    "what's left in my budget", 'what will I have at the end of the month']) {
    const result = await ask(run, text);
    assert.equal(result.status, 'ok', text);
    const walk = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, inner] of Object.entries(value)) {
        if (key.endsWith('_minor')) assert.equal(typeof value[key.replace(/_minor$/, '_spoken')], 'string', `${text}: ${key}`);
        if (/date$|^through$/.test(key) && typeof inner === 'string') assert.equal(typeof value[`${key}_spoken`], 'string', `${text}: ${key}`);
        walk(inner);
      }
    };
    walk(result);
    assert.ok(!/\$|\d{2,}%/.test(JSON.stringify(result).replace(/"[a-z_]*(?:_minor|date|through)":\s*"?[\d-]+"?/g, '')), text);
  }
});

test('spending answer is computed in code with at most three items', async () => {
  const { run } = fixture({ verified: true });
  const result = await ask(run, 'how much did I spend this month');
  assert.equal(result.topic, 'spending');
  assert.equal(result.answer.amount_minor, 6000 + 2550 + 1225 + 11225);
  assert.equal(result.answer.amount_spoken, 'two hundred ten dollars');
  assert.equal(result.items.length, 3);
  assert.equal(result.more_available, 1);
  assert.deepEqual(result.items[0], { merchant: 'Costco', amount_minor: 11225, amount_spoken: 'one hundred twelve dollars and twenty five cents',
    date: '2026-11-01', date_spoken: 'Sunday, November first' });
});

test('budget uses the confirmed budget and says when none exists', async () => {
  const withBudget = await ask(fixture({ verified: true, budget: { period: 'month', limitCents: 30000 } }).run, "what's left in my budget");
  assert.equal(withBudget.answer.amount_minor, 30000 - 21000);
  assert.equal(withBudget.answer.amount_spoken, 'ninety dollars');
  assert.equal(withBudget.context.days_left_spoken, 'twenty three days');
  assert.deepEqual(await ask(fixture({ verified: true }).run, "what's left in my budget"), { status: 'ok', topic: 'budget', budget_available: false });
});

test('bills and forecast use only known bills', async () => {
  const { run } = fixture({ verified: true });
  const bills = await ask(run, 'what bills are due');
  assert.equal(bills.items.length, 2);
  assert.equal(bills.items[0].due_date_spoken, 'Wednesday, November eleventh');
  const forecast = await ask(run, 'what will I have at the end of the month');
  assert.equal(forecast.answer.amount_minor, 124050 - 8500);
  assert.equal(forecast.context.through_spoken, 'Monday, November thirtieth');
});

test('unknown topics are not_available and unclear ones go to the model', async () => {
  const { run, calls } = fixture({ verified: true });
  assert.deepEqual(await ask(run, 'any deals near me?'), { status: 'not_available', topic: 'deals' });
  assert.deepEqual(await ask(run, 'tell me a joke'), { status: 'not_available', topic: 'unsupported' });
  assert.equal(calls.classify, 1);
});

test('Nessie failure is unavailable without details', async () => {
  const f = fixture({ verified: true });
  f.nessie.account = async () => { throw Error('secret key in url'); };
  assert.deepEqual(await ask(f.run, "what's my balance"), { status: 'unavailable' });
});

test('unbound and malformed requests are unavailable', async () => {
  const { run } = fixture({ verified: true });
  for (const change of [{ profile: 'onboarding' }, { user_id: null }, { session_id: 'bad room!' }, { phone_number: '5550100' }, { user_text: '' }]) {
    assert.deepEqual(await run({ ...body, user_text: 'balance', ...change }), { status: 'unavailable' });
  }
});

test('helpers', () => {
  assert.equal(hasFourDigits('my last four are one two three four'), true);
  assert.equal(hasFourDigits('it is 0123'), true);
  assert.equal(hasFourDigits('one two three'), false);
  assert.equal(ruleTopic("what's left in my food budget"), 'budget');
  assert.equal(ruleTopic('read me my balance'), 'balance');
});

test('HTTP routes: voice route, sessions and phone details are authenticated', async () => {
  const { createOnboardingServer } = require('../scripts/onboarding');
  const key = 'test-key-that-is-long-enough';
  const seen = [];
  const store = {
    route: async (b) => { seen.push(['route', b]); return { status: 'registered', profile: 'phone_details', user_id: 'u1' }; },
    seedVerified: async (b) => { seen.push(['seed', b]); return { status: 'verified' }; },
  };
  const server = createOnboardingServer({ apiKey: key, store, evaluate: async () => ({ status: 'not_found' }),
    phoneDetails: async () => ({ status: 'identity_required' }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'x-api-key': key, 'content-type': 'application/json' };
    const post = (path, payload, h = headers) => fetch(base + path, { method: 'POST', headers: h, body: JSON.stringify(payload) });
    assert.equal((await post('/internal/voice/route', {}, { 'content-type': 'application/json' })).status, 401);
    assert.equal(seen.length, 0);
    assert.deepEqual(await (await post('/internal/voice/route', { phone_number: '+19725550100', session_id: 'r' })).json(),
      { status: 'registered', profile: 'phone_details', user_id: 'u1' });
    assert.deepEqual(await (await post('/internal/voice/sessions', { session_id: 'r' })).json(), { status: 'verified' });
    assert.deepEqual(await (await post('/api/voice/phone-details', body)).json(), { status: 'identity_required' });
    assert.equal((await post('/internal/voice/other', {})).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
