// Stores around the user's GPS fix for the Deals map: UT Dallas campus spots
// (OSM) plus the owner's Nessie v2 merchants with geocodes, each carrying its
// Tiger Data offers (deals.offer), the SavorOne cashback rate, the owner's
// recent Nessie visits and, for campus spots, labeled demo offers. Nemotron
// picks the best nearby choice; the server writes the sentence.
const campus = require("../data/utd-stores.json");
const terms = require("../data/card-terms.json");
const { requestInsight } = require("./nemotron");

const RADIUS_M = 8000;
const DAY = 86400000;
const CATEGORY = { restaurant: "dining", gas: "fuel", fuel: "fuel" };
const norm = (c) => CATEGORY[c] || c || "other";
function meters(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const bps = (category) => terms.categoryCashbackBps[category] ?? terms.baseCashbackBps;
const dealsOwnerFor = (owner, env) => {
  try {
    const map = JSON.parse(env.DEALS_CUSTOMER_OWNERS || "{}");
    return map[owner.nessie_customer_id] || owner.id;
  } catch {
    return owner.id;
  }
};

async function tigerOffers(pool, dealsOwner) {
  try {
    const { rows } = await pool.query(
      `SELECT p.merchant_id AS brand, p.name AS program, o.terms->>'title' AS title, o.expires_at, o.status
         FROM deals.offer o JOIN deals.program p ON p.id=o.program_id
        WHERE o.owner_id=$1 AND o.status IN ('active','pending_extraction')
          AND (o.expires_at IS NULL OR o.expires_at>now())`,
      [dealsOwner],
    );
    return rows.filter((r) => r.title && r.title.length > 8);
  } catch {
    return []; // the deals schema is optional
  }
}

async function nearbyStores(pool, data, position, { env, fetchImpl, now = new Date() }) {
  const owner = data.owner;
  const merchants = (await pool.query(
    "SELECT id,name,category,lat,lon,brand_key FROM hackutd_finance.merchant WHERE lat IS NOT NULL AND lon IS NOT NULL",
  )).rows;
  const visits = new Map();
  for (const r of data.ledger)
    if (r.kind === "purchase" && r.status === "completed" && r.merchant_id && Date.parse(r.occurred_at) >= +now - 90 * DAY)
      visits.set(r.merchant_id, (visits.get(r.merchant_id) || 0) + 1);

  const stores = campus.stores.map((s) => ({
    id: s.id, name: s.name, brand: s.brand, category: s.category, address: `${s.address}, UT Dallas`,
    latitude: s.latitude, longitude: s.longitude, merchantIds: [], demoOffers: s.demoOffers, source: "osm",
  }));
  for (const m of merchants) {
    const at = { latitude: Number(m.lat), longitude: Number(m.lon) };
    // Nessie's Student Union Starbucks and Chick-fil-A are the same places as the campus pins.
    const twin = stores.find((s) => s.brand && s.brand === m.brand_key && meters(s, at) < 250);
    if (twin) { twin.merchantIds.push(m.id); continue; }
    stores.push({
      id: m.id, name: m.name, brand: m.brand_key, category: norm(m.category), address: "Nessie merchant",
      ...at, merchantIds: [m.id], demoOffers: [], source: "nessie",
    });
  }
  const offers = await tigerOffers(pool, dealsOwnerFor(owner, env));
  const out = stores
    .map((s) => {
      const distanceM = meters(position, s);
      const list = [
        ...offers.filter((o) => s.brand && o.brand === s.brand).map((o) => ({
          title: o.title, detail: `${o.program}${o.status === "active" ? "" : " • awaiting confirmation"}`, source: "tiger",
        })),
        ...s.demoOffers.map((o) => ({ ...o, source: "demo" })),
        { title: `${bps(s.category) / 100}% back with SavorOne`, detail: terms.label, source: "card" },
      ];
      return {
        id: s.id, name: s.name, category: s.category, address: s.address, latitude: s.latitude, longitude: s.longitude,
        distanceM, offers: list, visits90d: s.merchantIds.reduce((n, id) => n + (visits.get(id) || 0), 0), source: s.source,
      };
    })
    .filter((s) => s.distanceM <= RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 30);

  const candidates = out.filter((s) => s.offers.some((o) => o.source !== "card")).slice(0, 10);
  let best = null, source = "distance";
  if (candidates.length && env.NEMOTRON_BASE_URL) {
    const budgets = data.budgets || [];
    const { insight } = await requestInsight({
      name: "nearby_best_choice",
      prompt: "Pick the single best nearby store for this person to use an offer at right now. Prefer stores they already visit, closer stores, and real offers over demo ones; avoid categories where they are over budget. Return only the store ID.",
      facts: {
        localHour: Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: owner.time_zone || "America/Chicago" }).format(now)),
        budgetCategories: budgets.map((b) => b.category),
        stores: candidates.map((s) => ({ id: s.id, category: s.category, distanceM: s.distanceM, visits90d: s.visits90d,
          offerSources: [...new Set(s.offers.map((o) => o.source))] })),
      },
      properties: { storeId: { type: "string", enum: candidates.map((s) => s.id) } },
      timeout: 5000,
      maxTokens: 48,
    }, { env, fetchImpl });
    best = candidates.find((s) => s.id === insight?.storeId) || null;
    if (best) source = "nemotron";
  }
  best ??= candidates[0] ?? null;
  const offer = best?.offers.find((o) => o.source === "tiger") ?? best?.offers.find((o) => o.source === "demo");
  const far = (m) => (m < 1000 ? `${m} m` : `${(m / 1609).toFixed(1)} mi`);
  return {
    center: campus.center,
    stores: out,
    best: best && {
      storeId: best.id,
      title: `${best.name}: ${offer.title}`,
      text: `${far(best.distanceM)} away${best.visits90d ? ` • you've been ${best.visits90d} time${best.visits90d === 1 ? "" : "s"} in 90 days` : ""}. ${offer.source === "demo" ? "Demo offer." : "Offer saved in Tiger Data."}`,
      source,
    },
  };
}

module.exports = { nearbyStores, meters };
