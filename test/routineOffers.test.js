const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEMO_LOCATION, offerSummary } = require('../src/nearbyOffers');
const { DEMO_ROUTINE_TIME, evaluateRoutineVisit, sendRoutineAlertOnce } = require('../src/routineOffers');

const now = DEMO_ROUTINE_TIME;
const chipotle = {
  merchant: 'HackUTD Demo Chipotle - Campbell',
  weekday: 'Friday',
  daypart: 'midday',
  observedDays: 4,
  typicalPurchaseCents: 1400,
  provenance: { merchantSourceId: 'bca89d21-e020-444d-b8a8-57abf780294c' },
};
const profile = {
  asOf: new Date(now).toISOString(),
  timeZone: 'America/Chicago',
  routines: [chipotle],
  routineInsight: { status: 'interpreted', routineIndex: 0 },
};
const fix = { timestamp: now, coords: { ...DEMO_LOCATION, accuracy: 10 } };

test('matches the exact nearby branch and the weekday/daypart in the profile timezone', () => {
  const { recommendation } = evaluateRoutineVisit(profile, fix, { now });
  assert.equal(recommendation.offer.id, 'chipotle-campbell');
  assert.equal(recommendation.highlighted, true);
  assert.match(offerSummary(recommendation.offer, recommendation.routine.typicalPurchaseCents), /\$0\.70 on a \$14\.00 purchase/);

  for (const routineAt of [now - 2 * 60 * 60_000, now + 24 * 60 * 60_000]) {
    assert.equal(evaluateRoutineVisit(profile, fix, { now, routineAt }).recommendation, null);
  }
  const differentBranch = { ...chipotle, provenance: { merchantSourceId: 'other-chipotle' } };
  const wrongProfile = { ...profile, routines: [differentBranch] };
  assert.equal(evaluateRoutineVisit(wrongProfile, fix, { now }).recommendation, null);
});

test('suppresses alerts from stale data, uncertain distance, or insufficient timed evidence', () => {
  assert.equal(evaluateRoutineVisit(profile, { ...fix, timestamp: now - 21_000 }, { now }), null);
  const uncertainFix = { ...fix, coords: { ...fix.coords, accuracy: 125 } };
  const uncertainVisit = evaluateRoutineVisit(profile, uncertainFix, { now });
  assert.equal(uncertainVisit.offers.length, 1);
  assert.equal(uncertainVisit.recommendation, null);

  const expired = { ...profile, asOf: new Date(now - 31 * 60_000).toISOString() };
  assert.equal(evaluateRoutineVisit(expired, fix, { now }).profileExpired, true);
  assert.equal(evaluateRoutineVisit(expired, fix, { now }).recommendation, null);
  for (const routine of [{ ...chipotle, observedDays: 1 }, { ...chipotle, daypart: null }]) {
    assert.equal(evaluateRoutineVisit({ ...profile, routines: [routine] }, fix, { now }).recommendation, null);
  }
});

test('offers a valid match when Nemotron is down or its highlight is elsewhere', () => {
  for (const routineInsight of [{ status: 'unavailable' }, { status: 'interpreted', routineIndex: 1 }]) {
    const { recommendation } = evaluateRoutineVisit({ ...profile, routineInsight }, fix, { now });
    assert.equal(recommendation.offer.id, 'chipotle-campbell');
    assert.equal(recommendation.highlighted, false);
  }
});

test('schedules a live alert once per branch and releases failed or canceled attempts', async () => {
  const alerted = new Set();
  let finish;
  const first = sendRoutineAlertOnce(alerted, 'chipotle', () => new Promise((resolve) => { finish = resolve; }));
  const duplicate = () => assert.fail('Duplicate alert attempted');
  assert.equal(await sendRoutineAlertOnce(alerted, 'chipotle', duplicate), false);
  finish(true);
  assert.equal(await first, true);
  assert.equal(await sendRoutineAlertOnce(alerted, 'chipotle', duplicate), false);

  assert.equal(await sendRoutineAlertOnce(alerted, 'starbucks', async () => false), false);
  await assert.rejects(sendRoutineAlertOnce(alerted, 'starbucks', async () => { throw new Error('Failed'); }), /Failed/);
  assert.equal(await sendRoutineAlertOnce(alerted, 'starbucks', async () => true), true);
});
