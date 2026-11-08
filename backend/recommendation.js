const { DEMO_LOCATION, offerCosts, offerSummary } = require('../src/nearbyOffers');
const { DEMO_ROUTINE_TIME, MAX_FIX_AGE_MS, MAX_PROFILE_AGE_MS, evaluateRoutineVisit } = require('../src/routineOffers');
const { explainRecommendation } = require('./nemotron');
const { rankDemoOptions } = require('./optimizer');
const { financeForecast } = require('./finance-forecast');
const { dayNumberOf, localParts } = require('./text-obligations');

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

/** Last local date of the budget period containing `today` (weeks start on Monday). */
function periodEnd(today, period) {
  const day = dayNumberOf(today);
  if (period === 'week') {
    const weekday = new Date(day * 86_400_000).getUTCDay();
    return new Date((day + ((7 - weekday) % 7)) * 86_400_000).toISOString().slice(0, 10);
  }
  const [year, month] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

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
    .map((candidate) => ({ ...candidate, ...offerCosts(candidate.offer, candidate.routine.typicalPurchaseCents) }))
    .sort((a, b) => a.effectiveCostCents - b.effectiveCostCents || a.offer.distance - b.offer.distance
      || a.offer.id.localeCompare(b.offer.id));
  const plans = profile.socialObligations;
  const financial = recommendationFinances(profile, now);
  if (financial.reason) return skip(financial.reason);
  const reason = affordabilityReason(options.filter(({ offer }) => offer.nessieMerchantId === intendedBranch), financial);
  if (reason) return skip(reason);
  const { reservedCents, planCount, minimumBalanceCents, reserveCents, spendingLimitCents } = financial;
  const expiresAt = Math.min(fix.timestamp + MAX_FIX_AGE_MS, Date.parse(profile.asOf) + MAX_PROFILE_AGE_MS);
  const ranked = await rankDemoOptions({ profile, fix, demo, minimumBalanceCents, reserveCents, expiresAt,
    options: options.filter(({ payableCents }) => payableCents <= spendingLimitCents) }, env, fetchImpl);
  if (!ranked) return skip('optimizer_unavailable');
  const candidate = ranked.find(({ offer }) => offer.nessieMerchantId === intendedBranch);
  if (!candidate) return skip('no_eligible_offer');
  const interpretation = await explainRecommendation(candidate, { env, fetchImpl });
  if (clock() >= expiresAt) return skip('location_expired');
  const { offer, routine, payableCents, cashbackCents, effectiveCostCents } = candidate;
  const timing = `This matches your ${routine.weekday} ${routine.daypart} routine, observed on ${routine.observedDays} days.`;
  const savings = offerSummary(offer, payableCents);
  const planNote = reservedCents > 0
    ? ` ${dollars(reservedCents)} is set aside for ${planCount} upcoming ${planCount === 1 ? 'plan' : 'plans'} from your texts and email.`
    : '';
  return {
    recommendation: {
      offer, routine, payableCents, cashbackCents, effectiveCostCents,
      source: demo ? 'demo' : 'live',
      profileVersion: profile.profileVersion ?? null,
      memoryVersion: profile.memoryVersion ?? 0,
      obligationsVersion: plans?.version ?? null,
      reservedForPlansCents: reservedCents,
      expiresAt,
      explanation: {
        ...interpretation,
        text: (interpretation.reason === 'estimated_cashback' ? `${savings} ${timing}` : `${timing} ${savings}`) + planNote,
      },
    },
    // The API keeps this server-side. Explicit caller intent can qualify another
    // observed nearby routine, but it cannot override the same financial guards.
    callCandidates: ranked.map(({ offer, routine, payableCents, cashbackCents, effectiveCostCents }) => ({
      id: offer.id, merchant: offer.merchant, category: routine.category,
      payableCents, cashbackCents, effectiveCostCents,
    })),
  };
}

function recommendationFinances(profile, now) {
  if (!Number.isSafeInteger(profile.balanceCents)) return { reason: 'balance_unavailable' };
  const budget = profile.confirmedBudget;
  const today = localParts(now, profile.timeZone).date;
  const budgetDays = budget ? dayNumberOf(periodEnd(today, budget.period)) - dayNumberOf(today) + 1 : 0;
  const forecast = financeForecast(profile, new Date(now), Math.max(30, budgetDays), { includeEstimates: false });
  if (forecast.pendingUnknownAmounts) return { reason: 'clarification_required' };
  if (forecast.safeSpendCents === null) return { reason: 'forecast_incomplete' };
  const horizon = forecast.projection.slice(0, 30);
  const minimumBalanceCents = horizon.at(-1).balanceAfterKnownPlansCents;
  const reserveCents = forecast.reserveCents;
  const reservedCents = horizon.reduce((total, point) => total + point.photonOutflowCents, 0);
  const planCount = horizon.reduce((total, point) => total + point.photonObligationCount, 0);
  let budgetWithoutPlans = Infinity;
  let budgetWithPlans = Infinity;
  if (budget) {
    if (today !== localParts(profile.asOf, profile.timeZone).date) return { reason: 'refresh_required' };
    const todayNumber = dayNumberOf(today);
    const periodStart = budget.period === 'week' ? todayNumber + budgetDays - 7 : dayNumberOf(`${today.slice(0, 7)}-01`);
    const postedBillSpend = forecast.postedBillOutflows.filter(({ date }) => dayNumberOf(date) >= periodStart)
      .reduce((sum, { amountCents }) => sum + amountCents, 0);
    const spent = profile.spend[budget.period === 'week' ? 'weekToDate' : 'monthToDate'].totalCents + postedBillSpend;
    const periodReserved = forecast.projection.slice(0, budgetDays).reduce((total, point) => total + point.outflowCents, 0);
    budgetWithoutPlans = budget.limitCents - spent;
    budgetWithPlans = budgetWithoutPlans - periodReserved;
  }
  const spendingLimitCents = Math.min(profile.balanceCents, minimumBalanceCents - reserveCents, budgetWithPlans);
  return { balanceCents: profile.balanceCents, reservedCents, planCount, minimumBalanceCents, reserveCents,
    spendingLimitCents, budgetWithoutPlans };
}

function affordabilityReason(options, { balanceCents, reservedCents, minimumBalanceCents, reserveCents, spendingLimitCents, budgetWithoutPlans }) {
  const lowestPayable = Math.min(...options.map(({ payableCents }) => payableCents));
  if (lowestPayable > balanceCents) return 'insufficient_balance';
  if (lowestPayable > balanceCents - reservedCents) return 'reserved_for_plans';
  if (lowestPayable > minimumBalanceCents - reserveCents) return 'forecast_liquidity';
  if (lowestPayable > spendingLimitCents) return lowestPayable > budgetWithoutPlans ? 'budget_limit' : 'budget_reserved_for_plans';
  return null;
}

module.exports = { recommendVisit, periodEnd };
