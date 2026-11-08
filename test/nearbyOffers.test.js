const assert = require('node:assert/strict');
const test = require('node:test');
const { DEMO_LOCATION, SEARCH_RADIUS_METERS, findNearbyOffers, offerSummary } = require('../src/nearbyOffers');

test('the sample location shows Chipotle and a 75-cent estimate on $15', () => {
  const [offer, ...others] = findNearbyOffers(DEMO_LOCATION);
  assert.equal(offer.merchant, 'Chipotle');
  assert.equal(Math.round(offer.distance), 180);
  assert.equal(others.length, 0);
  assert.equal(offerSummary(offer), '5% demo cashback would earn $0.75 on a $15.00 purchase.');
});

test('live locations only match offers inside the 300-meter radius', () => {
  assert.equal(SEARCH_RADIUS_METERS, 300);
  assert.deepEqual(findNearbyOffers({ latitude: 32.9777, longitude: -96.72106 }).map(({ merchant }) => merchant), ['Chipotle']);
  assert.deepEqual(findNearbyOffers({ latitude: 32.9778, longitude: -96.72106 }), []);
  assert.deepEqual(findNearbyOffers({ latitude: 32.98666, longitude: -96.74888 }).map(({ merchant }) => merchant), ['Starbucks', 'Chick-fil-A']);
});
