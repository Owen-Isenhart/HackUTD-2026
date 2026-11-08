const { matchBrand } = require("./brands");
const { validFix } = require("./optimizer-world");
const { distanceKm } = require("./anomaly-screen");
const { fail } = require("./pipeline-utils");
async function cacheNearbyMerchants(db, request, now = new Date()) {
  if (
    request.nearbyStores !== undefined &&
    !Array.isArray(request.nearbyStores)
  )
    throw fail("invalid_nearby_stores");
  const fix = validFix(request, now);
  if (!fix) return;
  const rows = [];
  for (const store of (request.nearbyStores || []).slice(0, 100)) {
    const brand = matchBrand(store.brand || store.name);
    if (
      !brand.key ||
      typeof store.name !== "string" ||
      store.name.length > 200 ||
      !/^(node|way|relation)-[0-9]+$/.test(store.id) ||
      !Number.isFinite(store.latitude) ||
      Math.abs(store.latitude) > 90 ||
      !Number.isFinite(store.longitude) ||
      Math.abs(store.longitude) > 180
    )
      continue;
    const row = {
      id: "osm:" + store.id,
      name: store.name,
      lat: store.latitude,
      lon: store.longitude,
      category: brand.category,
      brand_key: brand.key,
    };
    if (distanceKm(fix, row) <= 1) rows.push(row);
  }
  if (rows.length)
    await db.query(
      `INSERT INTO hackutd_finance.merchant(id,name,category,lat,lon,brand_key,brand_match,provenance,fetched_at) SELECT x.id,x.name,x.category,x.lat,x.lon,x.brand_key,'alias','openstreetmap',$2 FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,category text,lat double precision,lon double precision,brand_key text) ON CONFLICT(id) DO NOTHING`,
      [JSON.stringify(rows), now],
    );
}
module.exports = { cacheNearbyMerchants };
