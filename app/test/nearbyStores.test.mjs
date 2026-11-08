// Unit tests for src/location/nearbyStores.ts. No network: fetch is replaced with fakes.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNearbyStoresQuery,
  findNearbyStores,
  MAX_RADIUS_M,
  toNearbyStore,
  toNearbyStores,
} from '../src/location/nearbyStores.ts';

const HERE = { latitude: 32.97666, longitude: -96.72106 };
// A point `m` metres due north of HERE (1 degree of latitude is about 111,195 m).
const north = (m) => ({ lat: HERE.latitude + m / 111195, lon: HERE.longitude });
const shop = (id, m, tags = {}) => ({ type: 'node', id, ...north(m), tags: { name: `Shop ${id}`, shop: 'convenience', ...tags } });
const event = { ...HERE, accuracyM: 0, timestamp: 1_700_000_000_000, source: 'demo' };

test('query asks for named shops and store amenities around the point', () => {
  const q = buildNearbyStoresQuery(HERE.latitude, HERE.longitude, 500);
  assert.match(q, /nwr\["shop"\]\["name"\]\(around:500,32\.97666,-96\.72106\);/);
  assert.match(q, /nwr\["amenity"~"\^\(restaurant\|cafe\|fast_food\|bar\|pub\|ice_cream\|food_court\|fuel\|pharmacy\)\$"\]\["name"\]\(around:500,/);
  assert.match(q, /out tags center \d+;/);
});

test('a node with a name and shop tag becomes a store with brand fields', () => {
  const s = toNearbyStore(shop(1, 100, { brand: 'Starbucks', 'brand:wikidata': 'Q37158', 'addr:housenumber': '800', 'addr:street': 'W Campbell Rd' }), HERE);
  assert.equal(s.id, 'node-1');
  assert.equal(s.brand, 'Starbucks');
  assert.equal(s.brandWikidata, 'Q37158');
  assert.deepEqual(s.category, { key: 'shop', value: 'convenience' });
  assert.equal(s.address, '800 W Campbell Rd');
  assert.ok(Math.abs(s.distanceM - 100) < 0.5, `distance ${s.distanceM}`);
});

test('a building outline uses its centre point', () => {
  const c = north(200);
  const s = toNearbyStore({ type: 'way', id: 7, center: c, tags: { name: 'Market', shop: 'supermarket' } }, HERE);
  assert.equal(s.id, 'way-7');
  assert.equal(s.latitude, c.lat);
});

test('unnamed places, places with no position and non-store amenities are skipped', () => {
  assert.equal(toNearbyStore({ type: 'node', id: 1, ...north(10), tags: { shop: 'bakery' } }, HERE), null);
  assert.equal(toNearbyStore({ type: 'way', id: 2, tags: { name: 'X', shop: 'bakery' } }, HERE), null);
  assert.equal(toNearbyStore({ type: 'node', id: 3, ...north(10), tags: { name: 'School', amenity: 'school' } }, HERE), null);
  assert.deepEqual(toNearbyStore({ type: 'node', id: 4, ...north(10), tags: { name: 'Shell', amenity: 'fuel' } }, HERE).category, { key: 'amenity', value: 'fuel' });
});

test('results are inside the radius, nearest first, ties broken by id, no duplicates', () => {
  const stores = toNearbyStores(
    [shop(3, 300), shop(1, 50), shop(9, 501), shop(2, 300), shop(1, 50), shop(5, 499)],
    HERE,
    500,
  );
  assert.deepEqual(stores.map((s) => s.id), ['node-1', 'node-2', 'node-3', 'node-5']);
});

function fakeFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return {
      ok: r.status === 200,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body ?? ''),
    };
  };
  return calls;
}

test('a busy server is skipped and the next one answers; the result records the source', async () => {
  const calls = fakeFetch([{ status: 429, body: 'busy' }, { status: 200, body: { elements: [shop(1, 120)] } }]);
  const r = await findNearbyStores(event, 500);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].url, calls[1].url);
  assert.match(decodeURIComponent(calls[1].init.body), /around:500,32\.97666,-96\.72106/);
  assert.equal(r.provider, 'openstreetmap-overpass');
  assert.deepEqual(r.query, { latitude: HERE.latitude, longitude: HERE.longitude, radiusM: 500, locationSource: 'demo', locationTimestamp: event.timestamp });
  assert.deepEqual(r.stores.map((s) => s.id), ['node-1']);
});

test('a full queue (502) counts as busy and moves on to the next server', async () => {
  const calls = fakeFetch([{ status: 502, body: 'at capacity' }, { status: 200, body: { elements: [] } }]);
  const r = await findNearbyStores(event, 500);
  assert.equal(calls.length, 2);
  assert.deepEqual(r.stores, []);
});

test('when every server fails, all are retried in 3 rounds, then one clear error', async () => {
  const calls = fakeFetch(Array.from({ length: 9 }, () => new Error('offline')));
  const started = Date.now();
  await assert.rejects(findNearbyStores(event, 500), /No Overpass server answered.*offline/);
  assert.equal(calls.length, 9); // 3 servers x 3 rounds
  assert.ok(Date.now() - started >= 2_900, 'waits 1 s then 2 s between rounds');
});

test('a later round succeeds after every server was busy in the first', async () => {
  const busy = { status: 504, body: 'busy' };
  const calls = fakeFetch([busy, busy, busy, { status: 200, body: { elements: [shop(1, 10)] } }]);
  const r = await findNearbyStores(event, 500);
  assert.equal(calls.length, 4);
  assert.equal(r.stores.length, 1);
});

test('a bad query (400) is not retried on other servers', async () => {
  const calls = fakeFetch([{ status: 400, body: 'syntax error' }]);
  await assert.rejects(findNearbyStores(event, 500), /Overpass rejected the search \(400\)/);
  assert.equal(calls.length, 1);
});

test('radius must be positive and at most the maximum', async () => {
  await assert.rejects(findNearbyStores(event, 0), /Radius/);
  await assert.rejects(findNearbyStores(event, MAX_RADIUS_M + 1), /Radius/);
});

test('a cancelled search stops without trying other servers', async () => {
  const controller = new AbortController();
  controller.abort();
  const calls = fakeFetch([]);
  await assert.rejects(findNearbyStores(event, 500, controller.signal), /cancelled/);
  assert.equal(calls.length, 0);
});
