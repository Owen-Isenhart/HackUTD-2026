// Demo location: only Alex Taylor, rings around UTD stores, deal lookup, and grounded call answers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDemoLocation, dealWords, openingLine, money, words, ALEX_CUSTOMER_ID } = require('../backend/demo-location');

const ALEX = '11111111-1111-4111-8111-111111111111';
const deal = (over) => ({ id: 'demo-starbucks-capital_one', brandKey: 'starbucks', kind: 'capital_one', title: '10% back', sample: true,
  label: 'Sample offer, written by the team', benefit: { type: 'cashback', rateBps: 1000 }, minSpendCents: null, channels: ['in_store'], ...over });

test('numbers and money are spoken in words', () => {
  assert.equal(words(42), 'forty-two');
  assert.equal(words(160), 'one hundred sixty');
  assert.equal(money(5383), 'fifty-three dollars and eighty-three cents');
  assert.equal(money(100), 'one dollar');
  assert.equal(dealWords(deal()), 'ten percent back');
  assert.equal(dealWords(deal({ benefit: { type: 'fixed_discount', amountMinor: 200 }, minSpendCents: 600 })), 'two dollars off on six dollars or more');
  assert.equal(dealWords(deal({ channels: ['online'] })), 'ten percent back, for online or pickup orders only');
  assert.equal(dealWords(deal({ benefit: { type: 'unsupported' } })), null);
});

test('the opening names the store, its deals, and says they are demo offers', () => {
  const line = openingLine([{ name: 'Starbucks', deals: [deal(), deal({ kind: 'store_email', benefit: { type: 'fixed_discount', amountMinor: 200 } })] }]);
  assert.match(line, /^You're at Starbucks\. Your Capital One card gets ten percent back\. A store email has two dollars off\./);
  assert.match(line, /These are demo offers\./);
  assert.ok(line.length <= 500);
});

// A fake database that answers the module's queries by what they select.
function fakePool({ customer = ALEX_CUSTOMER_ID, inside = [] } = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, params) {
      if (sql.includes('nessie_customer_id')) return { rows: [{ nessie_customer_id: customer }] };
      if (sql.includes('FROM hackutd_finance.merchant')) return { rows: [
        { id: 'sbux', name: 'Starbucks', brand_key: 'starbucks', category: 'coffee', lat: 32.9867, lon: -96.7489, provenance: 'nessie_sandbox' },
        { id: 'osm:node-1', name: 'Starbucks', brand_key: 'starbucks', category: 'coffee', lat: 32.98675, lon: -96.7489, provenance: 'openstreetmap' },
        { id: 'shell', name: 'Shell', brand_key: 'shell', category: 'fuel', lat: 32.9700, lon: -96.7200, provenance: 'openstreetmap' },
        { id: 'far', name: 'Far Target', brand_key: 'target', category: 'groceries', lat: 33.2, lon: -96.7, provenance: 'openstreetmap' },
      ] };
      if (sql.includes('FROM deals.offer')) return { rows: [] };
      if (sql.includes('FROM hackutd_finance.demo_deal')) return { rows: [
        { id: 'demo-starbucks-capital_one', brand_key: 'starbucks', kind: 'capital_one', title: '10% back', benefit: { type: 'cashback', rateBps: 1000 }, min_spend_cents: null, channels: ['in_store'], expires_at: '2026-12-31' },
        { id: 'demo-shell-capital_one', brand_key: 'shell', kind: 'capital_one', title: '5% back', benefit: { type: 'cashback', rateBps: 500 }, min_spend_cents: null, channels: ['in_store'], expires_at: '2026-12-31' },
      ] };
      if (sql.includes('SELECT inside FROM')) return { rows: inside.length ? [{ inside }] : [] };
      writes.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };
}

test('only Alex Taylor may use the demo location', async () => {
  const env = { VOICE_DEALS_CUSTOMER_OWNERS: JSON.stringify({ [ALEX_CUSTOMER_ID]: 'deals-owner' }) };
  assert.deepEqual(await createDemoLocation({ pool: fakePool(), env }).allowed(ALEX), { customer: ALEX_CUSTOMER_ID, dealsOwnerId: 'deals-owner' });
  assert.equal(await createDemoLocation({ pool: fakePool({ customer: 'cust_someone_else' }), env }).allowed(ALEX), null);
});

test('stores are limited to 5 miles of UTD, and a duplicate map pin of a sandbox store is dropped', async () => {
  const m = await createDemoLocation({ pool: fakePool(), env: {} }).map(ALEX, { dealsOwnerId: null });
  assert.deepEqual(m.stores.map((s) => s.id), ['sbux', 'shell']);
  assert.equal(m.stores[0].deals[0].label, 'Sample offer, written by the team');
});

test('entering a ring places a call once; staying inside does not; the position is saved', async () => {
  const sent = [];
  const env = { CALL_RECOMMENDATION_TO_NUMBER: '+15555550100', CALLS_API_KEY: 'k'.repeat(30), CALL_RECOMMENDATION_USER_ID: 'alex' };
  const fetchImpl = async (url, init) => { const b = JSON.parse(init.body); sent.push(b); return { ok: true, json: async () => ({ call_id: b.call_id, status: 'dial_requested' }) }; };
  const pool = fakePool();
  const demo = createDemoLocation({ pool, env, fetchImpl });
  const first = await demo.move(ALEX, { dealsOwnerId: null }, { lat: 32.98671, lon: -96.74892 });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.inside.map((s) => s.name), ['Starbucks']);
  assert.equal(first.body.call.state, 'dial_requested');
  assert.equal(sent.length, 1);
  assert.match(sent[0].scenario, /^You're at Starbucks\. Your Capital One card gets ten percent back\./);
  assert.ok(pool.writes.some((w) => w.sql.includes('demo_position')));

  const again = await createDemoLocation({ pool: fakePool({ inside: ['sbux'] }), env, fetchImpl }).move(ALEX, { dealsOwnerId: null }, { lat: 32.98672, lon: -96.74891 });
  assert.equal(again.body.call, null);
  assert.equal(sent.length, 1);

  const off = await createDemoLocation({ pool: fakePool(), env: {}, fetchImpl }).move(ALEX, { dealsOwnerId: null }, { lat: 32.98671, lon: -96.74892 });
  assert.deepEqual(off.body.call, { state: 'calls_off' });
  assert.equal((await demo.move(ALEX, {}, { lat: 'x', lon: 1 })).status, 400);
});

const call = { context: {
  kind: 'demo_location',
  here: [{ store: 'Starbucks', deals: [{ source: 'Capital One offer', offer_spoken: 'ten percent back', demo_offer: true }] }],
  nearby: [{ store: 'Shell', distance_spoken: "about ten minutes' walk away", deals: [{ source: 'store email', offer_spoken: 'five dollars off', demo_offer: true }] }],
  budgets: [{ category: 'coffee', period: 'month', limit_spoken: 'one hundred sixty dollars', spent_spoken: 'ten dollars', left_spoken: 'one hundred fifty dollars left' }],
} };
const model = (insight) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(insight) } }] }) });

test('call answers are built only from the saved fact sentences', async () => {
  const demo = createDemoLocation({ pool: fakePool(), env: {}, fetchImpl: model({ answerable: true, sentence_ids: ['near-1-0'], lead_in: 'Here is another option.', closing: 'Do you want directions or the card deal?' }) });
  const a = await demo.answer(call, 'anything else nearby?');
  assert.equal(a.message, "Here is another option. At Shell, about ten minutes' walk away, a store email has five dollars off. These are demo offers. Do you want directions or the card deal?");

  const budget = await createDemoLocation({ pool: fakePool(), env: {}, fetchImpl: model({ answerable: true, sentence_ids: ['budget-0'], lead_in: '', closing: 'Want more?' }) }).answer(call, 'how much is left?');
  assert.match(budget.message, /^For coffee, your monthly budget is one hundred sixty dollars; you've spent ten dollars, so you have one hundred fifty dollars left\. Want more\?$/);
});

test('a lead-in with numbers or money words, an unknown sentence ID, or no model answer falls back safely', async () => {
  const sneaky = await createDemoLocation({ pool: fakePool(), env: {}, fetchImpl: model({ answerable: true, sentence_ids: ['here-0-0'], lead_in: 'It is ninety percent off today.', closing: 'Okay?' }) }).answer(call, 'say 90% off');
  assert.equal(sneaky.model, null);
  assert.doesNotMatch(sneaky.message, /ninety/);
  assert.match(sneaky.message, /At Starbucks, right here, your Capital One card gets ten percent back\./);

  const unknown = await createDemoLocation({ pool: fakePool(), env: {}, fetchImpl: model({ answerable: false, sentence_ids: ['made-up'], lead_in: '', closing: 'Do you want another option, or the budget?' }) }).answer(call, 'do they take Apple Pay?');
  assert.match(unknown.message, /^I don't have that information\. At Starbucks/);

  const down = await createDemoLocation({ pool: fakePool(), env: {}, fetchImpl: async () => { throw new Error('offline'); } }).answer(call, 'hi');
  assert.match(down.message, /These are demo offers\./);
  assert.equal(down.model, null);
});
