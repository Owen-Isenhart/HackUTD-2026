const { SEARCH_RADIUS_METERS } = require('../src/nearbyOffers');
const { MAX_PROFILE_AGE_MS } = require('../src/routineOffers');

function demoWorld({ profile, fix, demo, options, minimumBalanceCents, reserveCents, expiresAt }) {
  const money = (minor) => ({ minor, currency: 'USD' });
  const categories = [...new Set(options.map(({ routine }) => routine.category))];
  const fixtureEvidence = 'Nessie routine estimate with a labeled demo offer';
  return {
    constraints: { version: String(profile.memoryVersion ?? 0), timezone: profile.timeZone, bubble_m: SEARCH_RADIUS_METERS - fix.coords.accuracy },
    forecast: { version: String(profile.profileVersion ?? profile.asOf), as_of: profile.asOf,
      valid_until: new Date(Date.parse(profile.asOf) + MAX_PROFILE_AGE_MS).toISOString(), horizon_days: 30,
      available_now: money(profile.balanceCents), min_projected_balance_lower: money(minimumBalanceCents), reserve: money(reserveCents) },
    fix: { lat: fix.coords.latitude, lon: fix.coords.longitude, accuracy_m: fix.coords.accuracy,
      timestamp: new Date(fix.timestamp).toISOString(), source: demo ? 'demo' : 'live' },
    places: options.map(({ offer }) => ({ id: offer.id, name: offer.merchant, merchant_id: offer.nessieMerchantId,
      lat: offer.coordinates.latitude, lon: offer.coordinates.longitude })),
    items: options.map(({ offer, routine, payableCents }) => ({ id: offer.id, place_id: offer.id, name: 'Typical purchase',
      category: routine.category, price: money(payableCents), price_observed_at: profile.asOf, price_source: 'nessie_routine_estimate' })),
    offers: options.map(({ offer }) => ({ id: `fixture:${offer.id}`, source: 'demo_catalog', merchant_id: offer.nessieMerchantId,
      terms_text: 'Synthetic cashback for the sandbox demo', kind: 'cashback_percent', value: offer.cashbackPercent * 100,
      expires_at: new Date(expiresAt).toISOString(), eligible_item_ids: [offer.id], verified: true })),
    payment_methods: [{ id: 'demo-payment', name: 'Sandbox payment', kind: 'cash', is_default: true }],
    transactions: [],
    intent: { categories, description: 'Observed nearby routines', source: 'routine', confidence: 'high', evidence: fixtureEvidence },
    judgements: options.map(({ offer }) => ({ item_id: offer.id, verdict: 'suitable', reasons: [fixtureEvidence] })),
  };
}

async function rankDemoOptions(context, env, fetchImpl) {
  if (!env.OPTIMIZER_API_URL) return context.options;
  try {
    const origin = new URL(env.OPTIMIZER_API_URL);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
    if (!((origin.protocol === 'http:' && loopback) || origin.protocol === 'https:') || origin.username || origin.password
      || origin.search || origin.hash || origin.pathname !== '/' || (env.OPTIMIZER_API_KEY?.length ?? 0) < 24
      || SEARCH_RADIUS_METERS <= context.fix.coords.accuracy) return null;
    const response = await fetchImpl(new URL('/internal/v1/optimizer/evaluate', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3500),
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.OPTIMIZER_API_KEY },
      body: JSON.stringify(demoWorld(context)),
    });
    if (!response.ok) return null;
    const { ranked, decision } = await response.json();
    if (!Array.isArray(ranked) || !['recommend', 'skip', 'insufficient_data'].includes(decision)) return null;
    const byId = new Map(context.options.map((candidate) => [candidate.offer.id, candidate]));
    const selected = [];
    for (const option of ranked) {
      const candidate = byId.get(option.item_id);
      if (!candidate || option.payable_now?.minor !== candidate.payableCents
        || option.verified_cashback?.minor !== candidate.cashbackCents || option.effective_cost?.minor !== candidate.effectiveCostCents) return null;
      byId.delete(option.item_id);
      selected.push(candidate);
    }
    return selected;
  } catch {
    return null;
  }
}

module.exports = { rankDemoOptions };
