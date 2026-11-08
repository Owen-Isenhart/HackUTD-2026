import {setSessionStore,saveSession,getSession} from '../src/finance/session.ts';
const memory=new Map();setSessionStore({getItemAsync:async k=>memory.get(k)||null,setItemAsync:async(k,v)=>{memory.set(k,v);},deleteItemAsync:async k=>{memory.delete(k);}});
// Tests for src/finance/financeApi.ts: the app's location events reach the finance backend's
// recommendVisit() (backend/recommendation.js) in the shape it accepts. No network: fetch is
// replaced with a fake that runs the real backend function on the request body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.EXPO_PUBLIC_FINANCE_API_URL = 'https://finance.test/';
const { FINANCE_API_URL, recommendationRequest, requestRecommendation, loadFinanceProfile, describeSkip } =
  await import('../src/finance/financeApi.ts');

const require = createRequire(import.meta.url);
const { recommendVisit } = require('../../backend/recommendation.js');
const { DEMO_LOCATION } = require('../../src/nearbyOffers.js');
const { DEMO_ROUTINE_TIME } = require('../../src/routineOffers.js');

// Same profile as the backend's own test/recommendation.test.js: a Friday-midday Chipotle routine.
const now = DEMO_ROUTINE_TIME;
const profile = {
  asOf: new Date(now).toISOString(),
  timeZone: 'America/Chicago',
  profileVersion: 2,
  memoryVersion: 1,
  balanceCents: 2000,
  spend: { weekToDate: { totalCents: 200 }, monthToDate: { totalCents: 400 } },
  routines: [{
    merchant: 'Private branch name', category: 'dining', weekday: 'Friday', daypart: 'midday',
    observedDays: 4, typicalPurchaseCents: 1400,
    provenance: { merchantSourceId: 'bca89d21-e020-444d-b8a8-57abf780294c' },
  }],
};

// A fake finance backend: checks the token and runs the real recommendVisit on the posted body.
function fakeBackend(token = 'demo-token') {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (init.headers.Authorization !== `Bearer ${token}`) return { ok: false, status: 401, json: async () => ({}) };
    if (url.endsWith('/api/finance-profile')) return { ok: true, status: 200, json: async () => profile };
    const body = JSON.parse(init.body);
    const { callCandidates, ...result } = await recommendVisit(profile, body, {
      clock: () => now,
      env: {},
      // Nemotron is not reachable here, so the backend uses its fallback explanation.
      fetchImpl: async () => new Response('{}', { status: 503 }),
    });
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(result)) };
  };
  return calls;
}

const live = (p, accuracyM = 10) => ({ ...p, accuracyM, timestamp: now, source: 'live' });

test('the backend origin comes from EXPO_PUBLIC_FINANCE_API_URL without a trailing slash', () => {
  assert.equal(FINANCE_API_URL, 'https://finance.test');
});

test('a live event is sent as a fix; a demo event includes labeled marker coordinates', () => {
  assert.deepEqual(recommendationRequest(live({ latitude: 1, longitude: 2 }, 7)), {
    source: 'live', fix: { coords: { latitude: 1, longitude: 2, accuracy: 7 }, timestamp: now },
  });
  assert.deepEqual(recommendationRequest({ latitude: 1, longitude: 2, accuracyM: 0, timestamp: now, source: 'demo' }), { source: 'demo',fix:{coords:{latitude:1,longitude:2,accuracy:0},timestamp:now} });
  assert.equal(recommendationRequest(live({ latitude: 1, longitude: 2 }, null)), null);
});

test('a live position at the routine branch gets the backend recommendation', async () => {
  const calls = fakeBackend();
  assert.equal(await loadFinanceProfile('demo-token'), profile.asOf);
  const answer = await requestRecommendation('demo-token', live(DEMO_LOCATION));
  assert.equal(calls[1].url, 'https://finance.test/api/finance-recommendation');
  assert.equal(answer.kind, 'recommendation');
  assert.equal(answer.recommendation.offer.id, 'chipotle-campbell');
  assert.equal(answer.recommendation.source, 'live');
  assert.equal(answer.recommendation.effectiveCostCents, 1330);
});

test('a demo event gets the backend demo visit wherever the marker is', async () => {
  fakeBackend();
  const answer = await requestRecommendation('demo-token', { latitude: 32.99, longitude: -96.75, accuracyM: 0, timestamp: now, source: 'demo' });
  assert.equal(answer.kind, 'recommendation');
  assert.equal(answer.recommendation.source, 'demo');
});

test('a live position far from any routine branch returns the reason', async () => {
  fakeBackend();
  const answer = await requestRecommendation('demo-token', live({ latitude: 32.99, longitude: -96.75 }));
  assert.equal(answer.kind, 'skip');
  assert.equal(answer.reason, 'no_matching_routine');
  assert.match(describeSkip(answer.reason), /No purchase routine/);
});

test('a live event without accuracy is not sent', async () => {
  const calls = fakeBackend();
  const answer = await requestRecommendation('demo-token', live(DEMO_LOCATION, null));
  assert.deepEqual(answer, { kind: 'skip', reason: 'invalid_location' });
  assert.equal(calls.length, 0);
});

test('a wrong token gives a clear error', async () => {
  fakeBackend('right-token');
  await assert.rejects(loadFinanceProfile('wrong-token'), /token was not accepted/);
});

test('identify sends no token, later calls use stored session, and 401 clears it',async()=>{
 const {identifySandbox,api}=await import('../src/finance/financeApi.ts');const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return {ok:true,status:201,json:async()=>url.endsWith('/identify')?{session:{token:'sandbox-session'}}:{step:'done'}};};
 await identifySandbox({firstName:'Alex',lastName:'Taylor',last4:'6619'});assert.equal(calls[0].init.headers.Authorization,undefined);assert.equal(await getSession(),'sandbox-session');await api('/api/v1/onboarding');assert.equal(calls[1].init.headers.Authorization,'Bearer sandbox-session');globalThis.fetch=async()=>({ok:false,status:401});await assert.rejects(api('/api/v1/onboarding'),/session token/);assert.equal(await getSession(),null);
});
