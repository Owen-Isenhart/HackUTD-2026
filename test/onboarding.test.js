const test = require('node:test');
const assert = require('node:assert/strict');
const { createOnboarding, extractIdentity, createNessieLookup } = require('../backend/onboarding');

const text = 'My name is Maya Lopez and the last four digits of my card are zero one two three.';
const identity = { first_name: 'Maya', last_name: 'Lopez', last4: 'zero one two three' };
const body = { user_id: 'maya', session_id: 'room-1', profile: 'onboarding', phone_number: '+19725550100', user_text: text };
function fixture(overrides = {}) {
  const saved = [];
  const store = { attempt: async () => ({ allowed: true }), verify: async (...args) => saved.push(args), fail: async () => {} };
  const nessie = {
    customers: async () => [{ _id: 'c1', first_name: 'Maya', last_name: 'Lopez' }],
    accounts: async () => [{ _id: 'a1', account_number: '9999888877770123' }],
    purchases: async () => [{ _id: 'p1', amount: 12, merchant_id: 'm1', purchase_date: '2026-10-01' }],
    merchants: async () => [{ _id: 'm1', name: 'Target' }],
  };
  return { saved, store, nessie, run: createOnboarding({ store, nessie, extract: async () => identity, ...overrides }) };
}

test('extracts name and last4 from spoken digits using a schema', async () => {
  const fetchImpl = async (_, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.response_format.type, 'json_schema');
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(identity) } }] }) };
  };
  assert.deepEqual(await extractIdentity(text, { env: {}, fetchImpl }), { ...identity, last4: '0123' });
});

test('rejects non-four-digit last4 and names absent from speech', async () => {
  for (const value of ['123', '12345', 'one two three four five', '0123456789012345']) {
    const { run } = fixture({ extract: async () => ({ ...identity, last4: value }) });
    assert.deepEqual(await run(body), { status: 'unavailable' });
  }
  const { run } = fixture({ extract: async () => ({ ...identity, first_name: 'Someone' }) });
  assert.deepEqual(await run(body), { status: 'unavailable' });
});

test('verified returns counts without persisting transactions or account numbers', async () => {
  const { run, saved } = fixture();
  const result = await run(body);
  assert.equal(result.status, 'verified');
  assert.equal(result.transaction_count, 1);
  assert.equal(result.transaction_count_spoken, 'one');
  assert.deepEqual(result.top_merchants, ['Target']);
  assert.equal(result.date_range.from, '2026-10-01');
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0][1], { customerId: 'c1', accountId: 'a1' });
  assert.ok(!JSON.stringify(saved).includes('Target'));
  assert.ok(!JSON.stringify(saved).includes('2026-10-01'));
  assert.equal(saved[0][0].user_text, undefined);
  assert.ok(!JSON.stringify([result, saved]).includes('9999888877770123'));
});

test('wrong digits and wrong name return identical not_found bodies', async () => {
  const a = fixture(); a.nessie.accounts = async () => [{ _id: 'a1', account_number: '9999888877779999' }];
  const b = fixture(); b.nessie.customers = async () => [];
  assert.deepEqual(await a.run(body), { status: 'not_found' });
  assert.deepEqual(await a.run(body), await b.run(body));
});

test('Nessie timeout returns unavailable without sensitive errors', async () => {
  const f = fixture(); f.nessie.customers = async () => { throw Error('secret in request'); };
  assert.deepEqual(await f.run(body), { status: 'unavailable' });
});

test('attempt limit returns unavailable before parsing or fetching', async () => {
  const f = fixture(); f.store.attempt = async () => ({ allowed: false });
  f.nessie.customers = async () => assert.fail('Must not fetch');
  assert.deepEqual(await f.run(body), { status: 'unavailable' });
});

test('uses HTTPS and server-side key; refuses redirects and unsafe origins', async () => {
  assert.throws(() => createNessieLookup({ env: { NESSIE_API_BASE_URL: 'http://bad', NESSIE_API_KEY: 'server-secret' } }));
  const client = createNessieLookup({ env: { NESSIE_API_BASE_URL: 'https://api.nessieisreal.com', NESSIE_API_KEY: 'server-secret' }, fetchImpl: async (url, options) => {
    assert.equal(url.protocol, 'https:'); assert.equal(url.searchParams.get('key'), 'server-secret');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => [] };
  } });
  assert.deepEqual(await client.customers(), []);
});

test('full card input is rejected before extraction', async () => {
  const f = fixture({ extract: async () => assert.fail('Must not parse full card') });
  assert.deepEqual(await f.run({ ...body, user_text: 'My card is 1234 5678 9012 3456' }), { status: 'unavailable' });
});

test('unbound and malformed requests cannot look up accounts', async () => {
  const f = fixture();
  for (const field of ['user_id', 'session_id', 'phone_number']) {
    assert.deepEqual(await f.run({ ...body, [field]: null }), { status: 'unavailable' });
  }
});

test('HTTP endpoint authenticates before parsing and keeps errors generic', async () => {
  const { createOnboardingServer } = require('../scripts/onboarding');
  const { once } = require('node:events');
  let calls = 0;
  const key = 'test-key-that-is-long-enough';
  const server = createOnboardingServer({ apiKey: key, evaluate: async () => { calls++; return { status: 'not_found' }; } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/recommendations/evaluate`;
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    assert.equal(calls, 0);
    const headers = { 'x-api-key': key, 'content-type': 'application/json' };
    assert.deepEqual(await (await fetch(url, { method: 'POST', headers, body: '{' })).json(), { status: 'unavailable' });
    assert.equal(calls, 0);
    assert.deepEqual(await (await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })).json(), { status: 'not_found' });
    assert.equal(calls, 1);
    assert.equal((await fetch(url, { method: 'POST', headers, body: 'x'.repeat(9000) })).status, 413);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});


test('accepts LiveKit inbound room names containing a plus sign', async () => {
  const { run } = fixture();
  const result = await run({ ...body, session_id: 'nessi-_+19725550100_live' });
  assert.equal(result.status, 'verified');
});
