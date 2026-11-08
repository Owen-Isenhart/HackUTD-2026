const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommendVisit } = require('../backend/recommendation');
const { DEMO_LOCATION } = require('../src/nearbyOffers');
const { DEMO_ROUTINE_TIME } = require('../src/routineOffers');

const now = DEMO_ROUTINE_TIME;
const profile = {
  asOf: new Date(now).toISOString(),
  timeZone: 'America/Chicago',
  profileVersion: 2,
  memoryVersion: 1,
  balanceCents: 2000,
  spend: { weekToDate: { totalCents: 200 }, monthToDate: { totalCents: 400 } },
  routines: [{
    merchant: 'Private branch name',
    category: 'dining',
    weekday: 'Friday',
    daypart: 'midday',
    observedDays: 4,
    typicalPurchaseCents: 1400,
    provenance: { merchantSourceId: 'bca89d21-e020-444d-b8a8-57abf780294c' },
  }],
};
const visit = { source: 'live', fix: { timestamp: now, coords: { ...DEMO_LOCATION, accuracy: 10 } } };

test('explains a valid estimate from a saved routine without sending location or account context to Nemotron', async () => {
  let facts;
  const { recommendation } = await recommendVisit(profile, visit, {
    clock: () => now,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      facts = JSON.parse(body.messages[1].content);
      return Response.json({ choices: [{ message: { content: '{"reason":"estimated_cashback"}' } }] });
    },
  });
  assert.deepEqual(facts, { category: 'dining', weekday: 'Friday', daypart: 'midday', observedDays: 4, payableCents: 1400, cashbackCents: 70 });
  assert.equal(recommendation.payableCents, 1400);
  assert.equal(recommendation.effectiveCostCents, 1330);
  assert.equal(recommendation.profileVersion, 2);
  assert.equal(recommendation.explanation.status, 'interpreted');
  assert.match(recommendation.explanation.text, /\$0\.70 on a \$14\.00 purchase/);
});

test('checks the immediate payable amount and the confirmed budget before asking Nemotron', async () => {
  const options = { clock: () => now, fetchImpl: () => assert.fail('Blocked offer was sent to Nemotron') };
  assert.equal((await recommendVisit({ ...profile, balanceCents: 1350 }, visit, options)).reason, 'insufficient_balance');
  const confirmedBudget = { period: 'month', limitCents: 1700 };
  assert.equal((await recommendVisit({ ...profile, confirmedBudget }, visit, options)).reason, 'budget_limit');
  assert.equal((await recommendVisit({ ...profile, refreshStatus: 'cached' }, visit, options)).reason, 'refresh_required');
});

test('rejects fabricated explanations and ignores location supplied to the simulation', async () => {
  const result = await recommendVisit(profile, { source: 'demo', fix: { coords: { latitude: 0, longitude: 0 } } }, {
    clock: () => now,
    fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"reason":"routine_fit","price":0}' } }] }),
  });
  assert.equal(result.recommendation.offer.id, 'chipotle-campbell');
  assert.equal(result.recommendation.source, 'demo');
  assert.equal(result.recommendation.explanation.status, 'fallback');
});
