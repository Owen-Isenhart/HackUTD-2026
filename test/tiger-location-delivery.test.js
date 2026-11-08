const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const { createLocationAlerts } = require('../backend/location-alerts');
const { createCallContexts } = require('../backend/recommendation-calls');
const { createTigerMemory, createTigerPool, migrateTiger } = require('../backend/tiger-memory');
const { serveProfile } = require('../scripts/finance-profile');
const { DEMO_LOCATION } = require('../src/nearbyOffers');

test('Tiger persists location consent, device scope and exactly one queued Photon delivery', {
  skip: process.env.TEST_TIGER_LOCATION !== '1', timeout: 30_000,
}, async () => {
  const pool = createTigerPool();
  const client = await pool.connect();
  let server;
  // Run the real migrations and store SQL against a disposable schema in a single
  // transaction. The outer rollback removes the schema and all its test records.
  const schema = `hackutd_smoke_${randomUUID().replaceAll('-', '')}`;
  const query = (sql, params) => client.query(sql.replaceAll('hackutd_finance', schema).replace('72839901', '72839903'), params);
  const scopedPool = { query, connect: async () => ({
    query: (sql, params) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) ? Promise.resolve() : query(sql, params),
    release() {},
  }) };
  try {
    await client.query('BEGIN');
    await migrateTiger(scopedPool);
    await migrateTiger(scopedPool);
    const owner = 'integration-owner';
    const memory = createTigerMemory(scopedPool, owner);
    const calls = createCallContexts(scopedPool, owner);
    const locations = createLocationAlerts(scopedPool, owner);
    const now = new Date();
    const delta = 12 - now.getUTCHours();
    const timeZone = delta === 0 ? 'UTC' : `Etc/GMT${delta > 0 ? '-' : '+'}${Math.abs(delta)}`;
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now);
    await memory.saveProfile({
      asOf: now.toISOString(), timeZone, balanceCents: 3000,
      spend: { weekToDate: { totalCents: 100 }, monthToDate: { totalCents: 100 } },
      routines: [{ merchant: 'Chipotle', category: 'dining',
        weekday, daypart: 'midday', observedDays: 4, typicalPurchaseCents: 1400,
        provenance: { merchantSourceId: 'bca89d21-e020-444d-b8a8-57abf780294c' } }],
    });
    const sent = [];
    const env = {
      FINANCE_PORT: '0', FINANCE_DEMO_TOKEN: 'test-mobile-token-abcdefghi', ALERT_ALLOW_DEMO_CATALOG: '1',
      PHOTON_PROJECT_ID: 'test-project', PHOTON_API_KEY: 'test-key', PHOTON_AGENT_USER_ID: 'sender', PHOTON_RECIPIENT: 'test-recipient',
    };
    server = serveProfile({ env, memory, calls, locations, fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      if (path === '/v1/chat/completions') return Response.json({ choices: [{ message: { content: '{"reason":"routine_fit"}' } }] });
      const resource = path.split('/').at(-1);
      if (resource === 'messages') sent.push({ id: options.headers['Idempotency-Key'], body: JSON.parse(options.body) });
      return Response.json({ id: `test-${resource}` }, { status: resource === 'messages' ? 202 : 200 });
    } });
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = (path, method = 'GET', body, token = env.FINANCE_DEMO_TOKEN) => fetch(origin + path, {
      method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const settings = '/api/v1/settings';
    const budget = { period: 'week', limitCents: 2200 };
    assert.equal((await request('/api/finance-memory', 'PUT', { confirmed: true, version: 0, budget, goals: ['Save for travel'], reserveCents: 250 })).status, 200);
    assert.equal((await request('/api/finance-memory', 'PUT', { confirmed: true, version: 0, budget, goals: [] })).status, 409);
    const reloaded = await createTigerMemory(scopedPool, owner).loadProfile();
    assert.deepEqual(reloaded.confirmedBudget, budget);
    assert.equal(reloaded.confirmedReserveCents, 250);
    assert.equal((await request('/api/finance-memory', 'PUT', { confirmed: true, version: 1, budget, goals: [] })).status, 200);
    assert.equal((await (await request('/api/v1/finance/memory')).json()).reserveCents, 250);
    const forecast = await (await request('/api/v1/finance/forecast?days=3')).json();
    assert.equal(forecast.status, 'partial');
    assert.equal(forecast.projection.length, 3);
    assert.equal(forecast.projection[0].balanceAfterKnownPlansCents, 3000);
    assert.equal(forecast.safeSpendCents, 2750);
    assert.equal((await (await request('/api/v1/finance/forecast?days=90')).json()).projection.length, 90);
    assert.equal((await request('/api/finance-memory', 'PUT', { confirmed: true, version: 2, budget, goals: [], reserveCents: null })).status, 200);
    assert.equal((await (await request('/api/v1/finance/memory')).json()).reserveCents, null);
    assert.equal((await (await request(settings)).json()).channel, 'off');
    const device = await (await request('/api/v1/devices', 'POST')).json();
    assert.equal((await request(settings, 'PUT', { version: 0, channel: 'imessage', confirmed: true })).status, 200);
    assert.equal((await request(settings, 'PUT', { version: 0, channel: 'off', confirmed: true })).status, 409);
    assert.equal((await (await request('/api/v1/location/regions')).json()).regions[0].identifier, 'chipotle-campbell');
    const event = {
      eventId: randomUUID(), deviceId: device.id, source: 'live', type: 'fix',
      fix: { timestamp: Date.now(), coords: { ...DEMO_LOCATION, accuracy: 10 } },
    };
    const location = (body, token = device.token) => request('/api/v1/location/events', 'POST', body, token);
    assert.equal((await location(event, env.FINANCE_DEMO_TOKEN)).status, 401);
    assert.equal((await location({ ...event, source: 'demo' })).status, 400);
    const stale = { ...event, eventId: randomUUID(), fix: { ...event.fix, timestamp: Date.now() - 21_000 } };
    assert.equal((await (await location(stale)).json()).state, 'invalid_location');
    assert.equal(await calls.load(stale.eventId), undefined);
    const queued = await Promise.all([location(event), location(event)]);
    assert.deepEqual(queued.map(({ status }) => status), [202, 202]);
    const reload = createCallContexts(scopedPool, owner);
    const waitFor = async (id, state) => {
      for (let retry = 0; retry < 60; retry++) {
        if ((await reload.load(id))?.state === state) return;
        await delay(40);
      }
      assert.fail(`Expected ${state}; last state: ${(await reload.load(id))?.state}`);
    };
    await waitFor(event.eventId, 'message_accepted');
    assert.deepEqual(sent.map(({ id }) => id), [event.eventId]);
    assert.match(sent[0].body.content.text, /demo offer/);

    const repeat = { ...event, eventId: randomUUID() };
    assert.equal((await location(repeat)).status, 202);
    await waitFor(repeat.eventId, 'failed');
    assert.equal(sent.length, 1);
    assert.equal(await createCallContexts(scopedPool, 'other-owner').load(event.eventId), undefined);
    assert.equal((await request(`/api/v1/devices/${device.id}`, 'DELETE')).status, 200);
    assert.equal((await location({ ...event, eventId: randomUUID() })).status, 401);
    assert.equal((await request(settings, 'PUT', { version: 1, channel: 'off', confirmed: true })).status, 200);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
