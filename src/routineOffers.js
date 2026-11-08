const { SEARCH_RADIUS_METERS, findNearbyOffers } = require('./nearbyOffers');
const { daypart } = require('./routineTime');

const MAX_FIX_AGE_MS = 20_000;
const MAX_PROFILE_AGE_MS = 30 * 60_000;
const DEMO_ROUTINE_TIME = Date.UTC(2026, 10, 6, 18);

function evaluateRoutineVisit(profile, fix, { now = Date.now(), routineAt = fix.timestamp } = {}) {
  const { latitude, longitude, accuracy } = fix.coords;
  const fixAge = now - fix.timestamp;
  if (!Number.isFinite(fixAge) || fixAge < 0 || fixAge > MAX_FIX_AGE_MS
    || !Number.isFinite(latitude) || Math.abs(latitude) > 90
    || !Number.isFinite(longitude) || Math.abs(longitude) > 180
    || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > SEARCH_RADIUS_METERS) return null;

  const offers = findNearbyOffers(fix.coords);
  const profileAge = now - Date.parse(profile.asOf);
  const profileExpired = !Number.isFinite(profileAge) || Math.abs(profileAge) > MAX_PROFILE_AGE_MS;
  if (profileExpired || offers.length === 0) return { offers, profileExpired, recommendation: null };

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: profile.timeZone, weekday: 'long', hour: 'numeric', hourCycle: 'h23',
  });
  const { weekday, hour } = Object.fromEntries(formatter.formatToParts(routineAt).map(({ type, value }) => [type, value]));
  const window = daypart(Number(hour));
  const insight = profile.routineInsight;
  const candidates = [];
  for (const [index, routine] of profile.routines.entries()) {
    if (routine.weekday !== weekday || routine.daypart !== window || routine.observedDays < 2
      || !Number.isSafeInteger(routine.typicalPurchaseCents) || routine.typicalPurchaseCents <= 0) continue;
    const offer = offers.find(({ nessieMerchantId, distance }) => nessieMerchantId === routine.provenance.merchantSourceId
      && distance + accuracy <= SEARCH_RADIUS_METERS);
    if (offer) candidates.push({ offer, routine, highlighted: insight?.status === 'interpreted' && insight.routineIndex === index });
  }
  candidates.sort((a, b) => Number(b.highlighted) - Number(a.highlighted)
    || b.routine.observedDays - a.routine.observedDays || a.offer.distance - b.offer.distance
    || a.offer.id.localeCompare(b.offer.id));
  return { offers, profileExpired, recommendation: candidates[0] ?? null };
}

async function sendRoutineAlertOnce(alerted, key, schedule) {
  if (alerted.has(key)) return false;
  alerted.add(key);
  try {
    if (await schedule()) return true;
  } catch (error) {
    alerted.delete(key);
    throw error;
  }
  alerted.delete(key);
  return false;
}

module.exports = { DEMO_ROUTINE_TIME, evaluateRoutineVisit, sendRoutineAlertOnce };
