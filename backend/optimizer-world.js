const {
  hash,
  quantile,
  baseline,
  net,
  localParts,
} = require("./pipeline-utils");
const { matchBrand, BRANDS } = require("./brands");
const { distanceKm } = require("./anomaly-screen");
const { spentInPeriod } = require("./budget-derive");
const cardTerms = require("../data/card-terms.json");
const money = (minor) => ({ minor, currency: "USD" });
const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const hhmm = (n) =>
  String(Math.floor(n / 60)).padStart(2, "0") +
  ":" +
  String(n % 60).padStart(2, "0");
function validFix(request, now) {
  const f = request?.fix,
    c = f?.coords;
  if (
    !["live", "demo"].includes(request?.source) ||
    !c ||
    !Number.isFinite(c.latitude) ||
    Math.abs(c.latitude) > 90 ||
    !Number.isFinite(c.longitude) ||
    Math.abs(c.longitude) > 180 ||
    !Number.isFinite(c.accuracy) ||
    c.accuracy < 0 ||
    c.accuracy >= 300 ||
    !Number.isFinite(f.timestamp) ||
    +now - f.timestamp > 20000 ||
    f.timestamp > +now + 3000
  )
    return null;
  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracy_m: c.accuracy,
    timestamp: new Date(f.timestamp).toISOString(),
    source: request.source,
  };
}
function buildWorld({
  owner,
  ledger,
  bank,
  routines,
  budgets,
  selections,
  forecast,
  request,
  offers = [],
  loyalty = [],
  inferredIntent = null,
  now = new Date(),
  allowFixtures = false,
}) {
  const fix = validFix(request, now);
  if (!fix) return { reason: "invalid_location" };
  if (!forecast || Date.parse(forecast.validUntil) <= +now)
    return { reason: "refresh_required" };
  if (forecast.safeToSpendCents === null)
    return { reason: "forecast_incomplete" };
  const branches = selections
    .filter((s) => s.selected)
    .flatMap((s) => s.branches.map((m) => ({ ...m, brand_key: s.brand_key })));
  for (const raw of (request.nearbyStores || []).slice(0, 100)) {
    const b = matchBrand(raw.brand || raw.name);
    if (
      !b.key ||
      !Number.isFinite(raw.latitude) ||
      Math.abs(raw.latitude) > 90 ||
      !Number.isFinite(raw.longitude) ||
      Math.abs(raw.longitude) > 180 ||
      !/^(node|way|relation)-[0-9]+$/.test(raw.id)
    )
      continue;
    branches.push({
      id: "osm:" + raw.id,
      name: raw.name,
      lat: raw.latitude,
      lon: raw.longitude,
      brand_key: b.key,
    });
  }
  const places = [
    ...new Map(
      branches
        .filter(
          (m) => m.lat != null && m.lon != null && distanceKm(fix, m) <= 1,
        )
        .map((m) => [
          m.id,
          {
            id: m.id,
            name: m.name || m.brand_key,
            merchant_id: m.brand_key,
            lat: Number(m.lat),
            lon: Number(m.lon),
            categories: [
              BRANDS.find((b) => b[0] === m.brand_key)?.[2] || "other",
            ],
          },
        ]),
    ).values(),
  ].slice(0, 100);
  const items = [];
  for (const p of places) {
    const r = routines.find(
        (r) =>
          r.brand_key === p.merchant_id &&
          r.purpose === "purchase" &&
          r.typical_mid_cents != null,
      ),
      history = ledger.filter(
        (t) =>
          baseline(t) &&
          t.brand_key === p.merchant_id &&
          Date.parse(t.occurred_at) <= +now,
      );
    if (!r && history.length < 3) continue;
    const category = ["walmart", "target"].includes(p.merchant_id)
      ? "groceries_superstore"
      : p.categories[0];
    items.push({
      id: "typical:" + p.id,
      place_id: p.id,
      name: "Typical purchase (estimated)",
      category,
      price: money(
        Number(r?.typical_mid_cents ?? quantile(history.map(net), 0.5)),
      ),
      price_observed_at: forecast.asOf,
      price_source: r ? "routine_estimate" : "visit_history_median",
    });
  }
  const clock =
    request.source === "demo"
      ? { weekday: 5, minute: 11 * 60 + 12 }
      : localParts(now, owner.time_zone);
  const commuting = routines.some(
    (r) =>
      r.purpose === "commute" &&
      r.weekdays.includes(clock.weekday) &&
      (clock.minute - r.window_start_minute + 1440) % 1440 <=
        (r.window_end_minute - r.window_start_minute + 1440) % 1440 &&
      (!r.brand_key ||
        places.some(
          (p) =>
            p.merchant_id === r.brand_key &&
            distanceKm(fix, p) * 1000 + fix.accuracy_m < 300,
        )),
  );
  if (commuting) return { reason: "commute_window" };
  let anchor = routines.find(
    (r) =>
      r.purpose === "purchase" &&
      r.weekdays.includes(clock.weekday) &&
      (clock.minute - r.window_start_minute + 1440) % 1440 <=
        (r.window_end_minute - r.window_start_minute + 1440) % 1440 &&
      places.some(
        (p) =>
          p.merchant_id === r.brand_key &&
          distanceKm(fix, p) * 1000 + fix.accuracy_m < 300,
      ),
  );
  if (!anchor && inferredIntent) {
    const item = items.find((i) => i.id === inferredIntent.itemId);
    const place = item && places.find((p) => p.id === item.place_id);
    if (place && distanceKm(fix, place) * 1000 + fix.accuracy_m < 300)
      anchor = {
        brand_key: place.merchant_id,
        purpose: "purchase",
        evidence: inferredIntent.evidence,
        support: { n: 0 },
        inferredIntent: true,
      };
  }
  if (!anchor)
    return { reason: "no_matching_routine", candidates: { items, places } };
  const category = BRANDS.find((b) => b[0] === anchor.brand_key)?.[2];
  const matching = items.filter(
    (i) =>
      i.category === category ||
      (category === "groceries" && i.category === "groceries_superstore"),
  );
  const anchorItem = matching.find(
    (i) =>
      places.find((p) => p.id === i.place_id)?.merchant_id === anchor.brand_key,
  );
  if (!anchorItem) return { reason: "no_verified_price" };
  const realOffers = offers
    .filter((o) => o.provenance !== "synthetic_fixture" || allowFixtures)
    .map((o) => ({
      ...o,
      verified:
        o.verified && (o.provenance !== "synthetic_fixture" || allowFixtures),
    }));
  const sanitized = realOffers.map(({ provenance, ...o }) => o);
  for (const l of loyalty) {
    if (!l.enrolled || !l.earn_terms?.pointsPerDollar) continue;
    const cash = l.earn_terms.cashValue;
    const valued = !!(
      cash?.url &&
      cash.quote &&
      cash.verifiedOn &&
      Number.isFinite(cash.minorPerPoint) &&
      cash.minorPerPoint >= 0
    );
    sanitized.push({
      id: "earn:" + l.id,
      merchant_id: l.merchant_id,
      source:
        (l.simulated ? "store_loyalty_simulated:" : "store_loyalty:") + l.id,
      terms_text: valued
        ? "Loyalty earn modeled from published conversion"
        : "Qualifying estimated purchase; points are not cash",
      kind: valued ? "cashback_percent" : "points_per_dollar",
      value: valued
        ? Math.floor(cash.minorPerPoint * l.earn_terms.pointsPerDollar * 100)
        : l.earn_terms.pointsPerDollar,
      points_program: valued ? null : l.earn_terms.pointsProgram,
      cashback_delay_days: valued ? (l.earn_terms.cashbackDelayDays ?? 30) : 0,
      expires_at: forecast.validUntil,
      stack_group: "loyalty:" + l.id,
      verified: true,
    });
  }
  const activeBudgets = budgets.map((b) => ({
    id: b.category,
    all_spending: b.category === "all",
    scope_categories:
      b.category === "all"
        ? []
        : b.category === "groceries"
          ? ["groceries", "groceries_superstore"]
          : [b.category],
    period: b.period,
    amount: money(Number(b.limit_cents)),
    version: b.version,
    evidence: b.source + " budget version " + b.version,
  }));
  const txns = ledger.filter(
    (r) =>
      r.direction === "outflow" &&
      r.status === "completed" &&
      r.kind !== "bill_payment" &&
      localParts(r.occurred_at, owner.time_zone).date >=
        require("./pipeline-utils").addDays(
          localParts(now, owner.time_zone).month + "-01",
          -7,
        ) &&
      Date.parse(r.occurred_at) <= +now,
  );
  if (txns.length > 4000) return { reason: "transaction_coverage_exceeded" };
  return {
    world: {
      constraints: {
        version: hash([
          budgets.map((b) => [b.category, b.version]),
          routines.map((r) => [r.id, r.version]),
        ]),
        timezone: owner.time_zone,
        bubble_m: 300 - fix.accuracy_m,
        budgets: activeBudgets,
        routine: routines
          .filter((r) => r.purpose !== "work")
          .map((r) => ({
            id: r.id,
            place_name: r.brand_key || "Commute",
            merchant_id: r.brand_key,
            days: r.weekdays.map((d) => weekdays[d - 1]),
            start: hhmm(r.window_start_minute),
            end: hhmm(r.window_end_minute),
            category: BRANDS.find((b) => b[0] === r.brand_key)?.[2] || "other",
            typical_item: "Typical purchase",
            typical_spend_low:
              r.typical_low_cents == null
                ? null
                : money(Number(r.typical_low_cents)),
            typical_spend_high:
              r.typical_high_cents == null
                ? null
                : money(Number(r.typical_high_cents)),
            purpose: r.purpose,
            evidence: r.evidence,
          })),
      },
      forecast: {
        version: String(forecast.version),
        as_of: forecast.asOf,
        valid_until: forecast.validUntil,
        horizon_days: 30,
        available_now: money(forecast.startingBalanceCents),
        min_projected_balance_lower: money(forecast.minimumBalanceLowCents),
        reserve: money(forecast.reserveCents || 0),
      },
      fix,
      places,
      items: matching,
      offers: sanitized.slice(0, 100),
      payment_methods: [
        {
          id: "card",
          name: cardTerms.label,
          kind: "credit",
          is_default: true,
          base_cashback_bps: cardTerms.baseCashbackBps,
          category_cashback_bps: cardTerms.categoryCashbackBps,
        },
        { id: "checking", name: "Checking", kind: "debit" },
      ],
      transactions: txns.map((r) => ({
        id: r.id,
        amount: money(net(r)),
        occurred_at: r.occurred_at,
        category: ["walmart", "target"].includes(r.brand_key)
          ? "groceries_superstore"
          : r.category,
        merchant_id: r.brand_key,
      })),
      intent: {
        categories: category==='groceries' ? ['groceries','groceries_superstore'] : [category],
        description: "Typical " + category + " purchase",
        anchor_item_id: anchorItem.id,
        source: anchor.inferredIntent ? "nemotron" : "routine",
        confidence: anchor.inferredIntent ? (inferredIntent.confidence==='medium'?'medium':'low') : "high",
        evidence: anchor.evidence,
      },
      judgements: matching
        .filter((i) => i.id === anchorItem.id && !anchor.inferredIntent)
        .map((i) => ({
          item_id: i.id,
          verdict: "suitable",
          reasons: [anchor.evidence],
        })),
    },
    meta: { offers: realOffers, loyalty, anchor, ledger, budgets, owner },
  };
}
function checkOptimizerAgainstGuards(result, world, meta, now) {
  if (
    !Array.isArray(result.ranked) ||
    !["recommend", "skip", "insufficient_data"].includes(result.decision)
  )
    return false;
  for (const r of result.ranked) {
    const item = world.items.find((i) => i.id === r.item_id),
      place = world.places.find((p) => p.id === r.place_id),
      amount = r.payable_now?.minor;
    if (
      !item ||
      !place ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > item.price.minor ||
      !Number.isSafeInteger(r.verified_cashback?.minor) ||
      r.effective_cost?.minor !== amount - r.verified_cashback.minor ||
      amount > world.forecast.available_now.minor ||
      amount >
        world.forecast.min_projected_balance_lower.minor -
          world.forecast.reserve.minor
    )
      return false;
    const pm = world.payment_methods.find((p) => p.id === r.payment_method_id);
    if (
      !pm ||
      !Array.isArray(r.applied_offer_ids) ||
      new Set(r.applied_offer_ids).size !== r.applied_offer_ids.length
    )
      return false;
    const applied = r.applied_offer_ids.map((id) =>
      world.offers.find((o) => o.id === id),
    );
    if (
      applied.some(
        (o) =>
          !o ||
          !o.verified ||
          o.merchant_id !== place.merchant_id ||
          (o.required_payment_method_ids?.length &&
            !o.required_payment_method_ids.includes(pm.id)) ||
          (o.eligible_item_ids?.length &&
            !o.eligible_item_ids.includes(item.id)) ||
          (o.min_spend && item.price.minor < o.min_spend.minor) ||
          Date.parse(o.expires_at) <= +now,
      )
    )
      return false;
    const groups = applied.map((o) => o.stack_group).filter(Boolean);
    if (
      new Set(groups).size !== groups.length ||
      (applied.length > 1 && applied.some((o) => o.stackable === false))
    )
      return false;
    const cap = (v, o) => Math.min(v, o.max_benefit?.minor ?? Infinity);
    const discount = applied.reduce(
      (sum, o) =>
        sum +
        (o.kind === "amount_off"
          ? cap(Math.min(o.value, item.price.minor), o)
          : o.kind === "percent_off"
            ? cap(Math.floor((item.price.minor * o.value) / 10000), o)
            : 0),
      0,
    );
    if (amount !== Math.max(0, item.price.minor - discount)) return false;
    const cashback =
      Math.floor(
        (amount *
          (pm.category_cashback_bps?.[item.category] ??
            pm.base_cashback_bps ??
            0)) /
          10000,
      ) +
      applied.reduce(
        (sum, o) =>
          sum +
          (o.kind === "cashback_amount"
            ? cap(o.value, o)
            : o.kind === "cashback_percent"
              ? cap(Math.floor((amount * o.value) / 10000), o)
              : 0),
        0,
      );
    if (r.verified_cashback.minor !== cashback) return false;
    const points = {};
    for (const offer of applied) {
      const key = offer.points_program || offer.source;
      if (offer.kind === "points_per_dollar")
        points[key] =
          (points[key] || 0) + offer.value * Math.floor(amount / 100);
      else if (offer.kind === "points_flat")
        points[key] = (points[key] || 0) + offer.value;
    }
    const ordered = (value) =>
      JSON.stringify(
        Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)),
      );
    if (ordered(points) !== ordered(r.points)) return false;
    for (const b of meta.budgets)
      if (
        (b.category === "all" || b.category === place.categories[0]) &&
        amount >
          Number(b.limit_cents) -
            spentInPeriod(meta.ledger, b, now, meta.owner.time_zone)
      )
        return false;
  }
  return true;
}
module.exports = { buildWorld, validFix, checkOptimizerAgainstGuards };
