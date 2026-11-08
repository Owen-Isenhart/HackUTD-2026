const SEARCH_RADIUS_METERS = 300;
const SAMPLE_PURCHASE_CENTS = 1500;
const DEMO_LOCATION = { latitude: 32.97666, longitude: -96.72106 };
const studentUnion = { latitude: 32.98666, longitude: -96.74888 };

const offers = [
  {
    id: 'chipotle-campbell', merchant: 'Chipotle', address: '283 W Campbell Rd, Richardson',
    nessieMerchantId: 'bca89d21-e020-444d-b8a8-57abf780294c',
    coordinates: { latitude: 32.97504, longitude: -96.72106 }, cashbackPercent: 5,
  },
  {
    id: 'starbucks-utd', merchant: 'Starbucks', address: 'UT Dallas Student Union',
    nessieMerchantId: '4e207154-b759-472f-9cdf-127a333906ea',
    coordinates: studentUnion, cashbackPercent: 4,
  },
  {
    id: 'chickfila-utd', merchant: 'Chick-fil-A', address: 'UT Dallas Student Union',
    nessieMerchantId: 'bc8d00a9-301b-40d6-ae31-3469149a639b',
    coordinates: studentUnion, cashbackPercent: 3,
  },
];

function distanceInMeters(from, to) {
  const radians = Math.PI / 180;
  const halfLatitude = (to.latitude - from.latitude) * radians / 2;
  const halfLongitude = (to.longitude - from.longitude) * radians / 2;
  const haversine = Math.sin(halfLatitude) ** 2
    + Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians) * Math.sin(halfLongitude) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function findNearbyOffers(coordinates) {
  return offers
    .map((offer) => ({ ...offer, distance: distanceInMeters(coordinates, offer.coordinates) }))
    .filter(({ distance }) => distance <= SEARCH_RADIUS_METERS)
    .sort((left, right) => left.distance - right.distance);
}

function formatDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function offerSummary({ cashbackPercent }, purchaseCents = SAMPLE_PURCHASE_CENTS) {
  const savingsCents = Math.round(purchaseCents * cashbackPercent / 100);
  return `${cashbackPercent}% demo cashback would earn ${formatDollars(savingsCents)} on a ${formatDollars(purchaseCents)} purchase.`;
}

module.exports = { DEMO_LOCATION, SEARCH_RADIUS_METERS, findNearbyOffers, offerSummary };
