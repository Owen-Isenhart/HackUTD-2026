// Read OSM branches first; --apply writes only missing brands into the sandbox tenant.
const fs = require("node:fs");
const { createNessieV2 } = require("../backend/nessie-v2");
const { matchBrand } = require("../backend/brands");
const { distanceKm } = require("../backend/anomaly-screen");
async function branches(fetchImpl = fetch) {
  const query =
    '[out:json][timeout:25];(nwr["brand"="Taco Bell"](around:20000,32.9857,-96.7502);nwr["brand"="JCPenney"](around:20000,32.9857,-96.7502););out center tags;';
  const u = new URL(
    process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter",
  );
  u.searchParams.set("data", query);
  const r = await fetchImpl(u, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Object.assign(new Error(), { code: "overpass_" + r.status });
  const { elements } = await r.json();
  const result = [];
  for (const key of ["taco_bell", "jcpenney"]) {
    const found = elements
      .filter(
        (e) => matchBrand(e.tags?.brand || e.tags?.name || "").key === key,
      )
      .map((e) => ({
        osmId: e.type + ":" + e.id,
        name: e.tags.name,
        brand: key,
        lat: e.lat ?? e.center?.lat,
        lon: e.lon ?? e.center?.lon,
        address: {
          street_number: e.tags["addr:housenumber"],
          street_name: e.tags["addr:street"],
          city: e.tags["addr:city"],
          state: e.tags["addr:state"],
          zip: e.tags["addr:postcode"],
        },
        source: "https://www.openstreetmap.org/" + e.type + "/" + e.id,
      }))
      .filter(
        (b) =>
          Object.values(b.address).every(Boolean) &&
          Number.isFinite(b.lat) &&
          Number.isFinite(b.lon),
      )
      .sort(
        (a, b) =>
          distanceKm({ lat: 32.9857, lon: -96.7502 }, a) -
          distanceKm({ lat: 32.9857, lon: -96.7502 }, b),
      );
    if (!found.length)
      throw Object.assign(new Error(), {
        code: "osm_branch_address_incomplete",
      });
    result.push(found[0]);
  }
  return result;
}
async function setup(nessie, catalog) {
  const merchants = await nessie.merchants(),
    ids = {};
  for (const branch of catalog) {
    const existing = merchants.find(
      (m) => matchBrand(m.name).key === branch.brand,
    );
    const m =
      existing ||
      (await nessie.createMerchant({
        name: branch.name,
        category: branch.brand === "taco_bell" ? "restaurant" : "retail",
        address: branch.address,
        geocode: { lat: branch.lat, lng: branch.lon },
      }));
    ids[branch.brand] = m.id;
  }
  return ids;
}
if (require.main === module) {
  (async () => {
    if (!process.env.NESSIE_V2_API_KEY) {
      console.log("Blocked: NESSIE_V2_API_KEY is not configured.");
      return;
    }
    const catalog = await branches();
    fs.writeFileSync(
      "data/branches.json",
      JSON.stringify(
        {
          provenance: "openstreetmap",
          verifiedOn: new Date().toISOString(),
          branches: catalog,
        },
        null,
        2,
      ) + "\n",
    );
    if (process.argv.includes("--apply")) {
      const ids = await setup(
        createNessieV2({ apiKey: process.env.NESSIE_V2_API_KEY }),
        catalog,
      );
      console.log(JSON.stringify(ids));
    } else
      console.log(
        "Branch catalog saved. Run with --apply to create missing sandbox merchants.",
      );
  })().catch((e) => {
    console.error("Merchant setup unavailable:", e.code || "setup_failed");
    process.exitCode = 1;
  });
}
module.exports = { branches, setup };
