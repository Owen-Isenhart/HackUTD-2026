// Prepares the UT Dallas demo-location data. Safe to run more than once.
//   node --env-file=.env.onboarding.local scripts/seed-utd-demo.js
// 1. Applies the migrations (adds demo_deal and demo_position).
// 2. Saves the real locations of known-brand stores within 5 miles of UTD from OpenStreetMap.
// 3. For every brand in that area with no active Capital One offer, or no active store-email deal,
//    adds one synthetic deal of that kind. Synthetic deals are labeled as written by the team.
const { createTigerPool, migrateTiger } = require('../backend/tiger-memory');
const { matchBrand } = require('../backend/brands');
const { UTD, AREA_M, ALEX_CUSTOMER_ID, loadStores, loadDeals } = require('../backend/demo-location');

const EXPIRES = '2026-12-31T23:59:59Z';
const cash = (pct) => ({ type: 'cashback', rateBps: pct * 100, amountMinor: null });
const off = (cents) => ({ type: 'fixed_discount', rateBps: null, amountMinor: cents });
const pctOff = (pct) => ({ type: 'percent', rateBps: pct * 100, amountMinor: null });
// [Capital One offer, store-email deal] per brand: [title, benefit, minimum spend in cents, channels].
const TEMPLATES = {
  starbucks: [['10% back at Starbucks', cash(10), null], ['$2 off any drink of $6 or more', off(200), 600]],
  bluebird_coffee: [['10% back at Bluebird Coffee', cash(10), null], ['$1 off any latte of $5 or more', off(100), 500]],
  chick_fil_a: [['8% back at Chick-fil-A', cash(8), null], ['$3 off a meal of $12 or more', off(300), 1200]],
  chipotle: [['6% back at Chipotle', cash(6), null], ['$4 off an order of $20 or more', off(400), 2000]],
  panera: [['8% back at Panera Bread', cash(8), null], ['15% off any warm bowl', pctOff(15), null]],
  taco_bell: [['10% back at Taco Bell', cash(10), null], ['$2 off an order of $10 or more', off(200), 1000]],
  shell: [['5% back on fuel at Shell', cash(5), null], ['$5 off a fill-up of $40 or more', off(500), 4000]],
  chevron: [['4% back on fuel at Chevron', cash(4), null], ['$4 off a fill-up of $40 or more', off(400), 4000]],
  walmart: [['2% back at Walmart', cash(2), null], ['$10 off an in-store purchase of $75 or more', off(1000), 7500]],
  target: [['2% back at Target', cash(2), null], ['$5 off an in-store purchase of $40 or more', off(500), 4000]],
  homedepot: [['4% back at The Home Depot', cash(4), null], ['$10 off an in-store purchase of $100 or more', off(1000), 10000]],
  bestbuy: [['3% back at Best Buy', cash(3), null], ['$15 off an in-store purchase of $150 or more', off(1500), 15000]],
  sephora: [['4% back at Sephora', cash(4), null], ['$10 off an in-store purchase of $50 or more', off(1000), 5000]],
};
const BY_CATEGORY = {
  dining: [['5% back on dining', cash(5), null], ['$2 off an order of $10 or more', off(200), 1000]],
  coffee: [['8% back on coffee', cash(8), null], ['$1 off any drink of $5 or more', off(100), 500]],
  fuel: [['4% back on fuel', cash(4), null], ['$4 off a fill-up of $40 or more', off(400), 4000]],
};
const DEFAULT = [['3% back in store', cash(3), null], ['$5 off an in-store purchase of $50 or more', off(500), 5000]];

async function osmStores() {
  const q = `[out:json][timeout:25];nwr(around:${AREA_M},${UTD.lat},${UTD.lon})[name][~"^(amenity|shop)$"~"^(restaurant|fast_food|cafe|fuel|supermarket|department_store|electronics|doityourself|hardware|cosmetics|clothes|shoes|sports|variety_store|general|wholesale)$"];out center tags;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(40_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'nessential-hackutd-demo' },
  });
  if (!res.ok) throw new Error(`OpenStreetMap search failed: HTTP ${res.status}`);
  return (await res.json()).elements.map((e) => {
    const brand = matchBrand(e.tags.brand || e.tags.name);
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    return brand.key && Number.isFinite(lat) && Number.isFinite(lon)
      ? { id: `osm:${e.type}-${e.id}`, name: e.tags.name, lat, lon, category: brand.category, brand_key: brand.key } : null;
  }).filter(Boolean);
}

async function main() {
  const pool = createTigerPool();
  try {
    await migrateTiger(pool);
    const found = await osmStores();
    await pool.query(`
      INSERT INTO hackutd_finance.merchant (id, name, category, lat, lon, brand_key, brand_match, provenance, fetched_at)
      SELECT x.id, x.name, x.category, x.lat, x.lon, x.brand_key, 'alias', 'openstreetmap', now()
      FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, category text, lat double precision, lon double precision, brand_key text)
      ON CONFLICT (id) DO NOTHING`, [JSON.stringify(found)]);
    const stores = await loadStores(pool);
    const dealsOwner = JSON.parse(process.env.VOICE_DEALS_CUSTOMER_OWNERS || '{}')[ALEX_CUSTOMER_ID] ?? null;
    if (!dealsOwner) console.warn('VOICE_DEALS_CUSTOMER_OWNERS has no deals owner for Alex Taylor; only synthetic deals will be used.');
    // Only real deals count as coverage here: earlier synthetic rows are rewritten below.
    const real = (await loadDeals(pool, dealsOwner)).filter((d) => !d.id.startsWith('demo-'));
    const rows = [];
    for (const [brand, category] of new Map(stores.map((s) => [s.brand_key, s.category]))) {
      const templates = TEMPLATES[brand] ?? BY_CATEGORY[category] ?? DEFAULT;
      ['capital_one', 'store_email'].forEach((kind, i) => {
        const hasReal = real.some((d) => d.brandKey === brand && d.kind === kind);
        if (hasReal) return;
        const [title, benefit, minSpend] = templates[i];
        rows.push({ id: `demo-${brand}-${kind}`, brand_key: brand, kind, title, benefit, min_spend_cents: minSpend,
          channels: ['in_store', 'online'], expires_at: EXPIRES });
      });
    }
    await pool.query('DELETE FROM hackutd_finance.demo_deal');
    await pool.query(`
      INSERT INTO hackutd_finance.demo_deal (id, brand_key, kind, title, benefit, min_spend_cents, channels, expires_at)
      SELECT x.id, x.brand_key, x.kind, x.title, x.benefit, x.min_spend_cents, x.channels, x.expires_at
      FROM jsonb_to_recordset($1::jsonb) AS x(id text, brand_key text, kind text, title text, benefit jsonb,
        min_spend_cents integer, channels text[], expires_at timestamptz)`, [JSON.stringify(rows)]);
    const brands = new Set(stores.map((s) => s.brand_key));
    console.log(JSON.stringify({
      storesWithin5Miles: stores.length, fromOpenStreetMap: stores.filter((s) => s.provenance === 'openstreetmap').length,
      brands: [...brands].sort(), realDealsUsed: real.filter((d) => brands.has(d.brandKey)).length, syntheticDeals: rows.length,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
