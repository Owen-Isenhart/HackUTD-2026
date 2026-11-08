const { quantile, localParts } = require("./pipeline-utils");
const CARD_TEST_MAX = 200,
  CARD_TEST_COUNT = 3,
  CARD_TEST_WINDOW_MS = 600000,
  GEO_KM = 150;
function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dlat = rad(b.lat - a.lat),
    dlon = rad(b.lon - a.lon);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function screenTransactions(
  input,
  merchants = [],
  now = new Date(),
  timeZone = "America/Chicago",
) {
  const rows = input
    .map((r) => ({ ...r, screen_flags: [] }))
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const ms = new Map(merchants.map((m) => [m.id, m]));
  const recent = rows.filter(
    (r) =>
      Date.parse(r.occurred_at) >= +now - 180 * 86400000 &&
      Date.parse(r.occurred_at) <= +now,
  );
  const coords = recent
    .filter((r) => r.kind === "purchase" && ms.get(r.merchant_id)?.lat != null)
    .map((r) => ms.get(r.merchant_id));
  const home = {
    lat: quantile(
      coords.map((m) => m.lat),
      0.5,
    ),
    lon: quantile(
      coords.map((m) => m.lon),
      0.5,
    ),
  };
  const days = new Map();
  for (const r of recent.filter((r) => r.kind === "purchase")) {
    const k = localParts(r.occurred_at, timeZone).date;
    days.set(k, (days.get(k) || 0) + 1);
  }
  const counts = [...days.values()];
  const cutoff = quantile(counts, 0.99);
  const transfers = recent.filter(
    (r) => r.kind === "transfer" && r.direction === "outflow",
  );
  const transferMax = quantile(
    transfers.map((r) => r.amount_cents),
    0.99,
  );
  const payees = new Set();
  for (const r of rows) {
    const flag = (x) => {
      if (!r.screen_flags.includes(x)) r.screen_flags.push(x);
    };
    const t = Date.parse(r.occurred_at);
    if (r.reversed_cents >= r.amount_cents && r.amount_cents > 0)
      flag("reversed");
    if (r.kind === "purchase") {
      const cluster = rows.filter(
        (x) =>
          x.account_id === r.account_id &&
          x.kind === "purchase" &&
          x.amount_cents < CARD_TEST_MAX &&
          Math.abs(Date.parse(x.occurred_at) - t) <= CARD_TEST_WINDOW_MS,
      );
      if (r.amount_cents < CARD_TEST_MAX && cluster.length >= CARD_TEST_COUNT)
        flag("card_testing");
      if (
        counts.length >= 30 &&
        (days.get(localParts(r.occurred_at, timeZone).date) || 0) > cutoff
      )
        flag("velocity_spike");
      const m = ms.get(r.merchant_id);
      if (
        coords.length >= 3 &&
        m?.lat != null &&
        !["uber_eats", "booking_com"].includes(r.brand_key) &&
        distanceKm(home, m) > GEO_KM
      )
        flag("geo_distant");
    }
    if (["transfer", "withdrawal"].includes(r.kind))
      for (const round of [100000, 500000, 1000000])
        if (
          r.amount_cents >= round * 0.9 &&
          r.amount_cents <= round &&
          rows.filter(
            (x) =>
              x.account_id === r.account_id &&
              ["transfer", "withdrawal"].includes(x.kind) &&
              x.amount_cents >= round * 0.9 &&
              x.amount_cents <= round &&
              Math.abs(Date.parse(x.occurred_at) - t) <= 7 * 86400000,
          ).length >= 3
        )
          flag("structuring");
    if (r.kind === "transfer" && r.direction === "outflow") {
      if (
        transfers.length >= 10 &&
        !payees.has(r.payee_id) &&
        r.amount_cents > transferMax
      )
        flag("large_transfer_new_payee");
      payees.add(r.payee_id);
    }
    if (
      r.kind === "withdrawal" &&
      rows.filter(
        (x) =>
          x.kind === "withdrawal" &&
          x.account_id === r.account_id &&
          Math.abs(Date.parse(x.occurred_at) - t) <= 3600000 &&
          rows.some(
            (f) =>
              f.kind === "fee" &&
              f.account_id === x.account_id &&
              f.parent_id === x.id,
          ),
      ).length >= 2
    )
      flag("foreign_atm_cashout");
  }
  return rows;
}
module.exports = {
  screenTransactions,
  distanceKm,
  CARD_TEST_MAX,
  CARD_TEST_COUNT,
  CARD_TEST_WINDOW_MS,
  GEO_KM,
};
