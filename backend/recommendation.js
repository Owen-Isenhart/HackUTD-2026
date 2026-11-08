const { DEMO_LOCATION, offerCosts, offerSummary } = require('../src/nearbyOffers');
const { DEMO_ROUTINE_TIME, MAX_FIX_AGE_MS, MAX_PROFILE_AGE_MS, evaluateRoutineVisit } = require('../src/routineOffers');
const { explainRecommendation } = require('./nemotron');

async function recommendVisit(profile, request, { env = process.env, fetchImpl = fetch, clock = Date.now } = {}) {
  const now = clock();
  const demo = request?.source === 'demo';
  const fix = demo ? { coords: { ...DEMO_LOCATION, accuracy: 10 }, timestamp: now } : request?.fix;
  const skip = (reason) => ({ recommendation: null, reason });
  if (!fix?.coords || !Number.isFinite(fix.timestamp) || (!demo && request.source !== 'live')) {
    return skip('invalid_location');
  }
  if (!profile) return skip('profile_required');

  const visit = evaluateRoutineVisit(profile, fix, { now, routineAt: demo ? DEMO_ROUTINE_TIME : fix.timestamp });
  if (!visit) return skip('invalid_location');
  if (visit.profileExpired || profile.refreshStatus === 'cached') return skip('refresh_required');
  if (!visit.recommendation) return skip('no_matching_routine');

  // The closest matching routine anchors the inferred visit. Other branches
  // require separate evidence that they fit the same purchase intent.
  const intendedBranch = visit.recommendation.offer.nessieMerchantId;
  const options = visit.candidates
    .filter(({ offer }) => offer.nessieMerchantId === intendedBranch)
    .map((candidate) => ({ ...candidate, ...offerCosts(candidate.offer, candidate.routine.typicalPurchaseCents) }))
    .sort((a, b) => a.effectiveCostCents - b.effectiveCostCents || a.offer.distance - b.offer.distance
      || a.offer.id.localeCompare(b.offer.id));

  if (!Number.isSafeInteger(profile.balanceCents)) return skip('balance_unavailable');
  const affordable = options.filter(({ payableCents }) => payableCents <= profile.balanceCents);
  if (affordable.length === 0) return skip('insufficient_balance');

  const budget = profile.confirmedBudget;
  let candidate = affordable[0];
  if (budget) {
    const localDate = (instant) => new Date(instant).toLocaleDateString('en-CA', { timeZone: profile.timeZone });
    if (localDate(now) !== localDate(profile.asOf)) return skip('refresh_required');
    const spent = profile.spend[budget.period === 'week' ? 'weekToDate' : 'monthToDate'].totalCents;
    candidate = affordable.find(({ payableCents }) => payableCents <= budget.limitCents - spent);
    if (!candidate) return skip('budget_limit');
  }

  const expiresAt = Math.min(fix.timestamp + MAX_FIX_AGE_MS, Date.parse(profile.asOf) + MAX_PROFILE_AGE_MS);
  const interpretation = await explainRecommendation(candidate, { env, fetchImpl });
  if (clock() >= expiresAt) return skip('location_expired');
  const { offer, routine, payableCents, cashbackCents, effectiveCostCents } = candidate;
  const timing = `This matches your ${routine.weekday} ${routine.daypart} routine, observed on ${routine.observedDays} days.`;
  const savings = offerSummary(offer, payableCents);
  return {
    recommendation: {
      offer, routine, payableCents, cashbackCents, effectiveCostCents,
      source: demo ? 'demo' : 'live',
      profileVersion: profile.profileVersion ?? null,
      memoryVersion: profile.memoryVersion ?? 0,
      expiresAt,
      explanation: {
        ...interpretation,
        text: interpretation.reason === 'estimated_cashback' ? `${savings} ${timing}` : `${timing} ${savings}`,
      },
    },
  };
}

module.exports = { recommendVisit };
