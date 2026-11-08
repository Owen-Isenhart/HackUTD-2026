const { visitsFromLedger } = require("./routines-v2");
const { baseline, net, hash } = require("./pipeline-utils");
const MIN_VISITS_180D = 2,
  MAX_SELECTED = 10;
function selectStores({
  ledger,
  routines = [],
  programs = [],
  previous = [],
  merchants = [],
  now = new Date(),
  timeZone,
}) {
  const visits = visitsFromLedger(ledger, now, timeZone).filter(
    (v) => Date.parse(v.occurred_at) >= +now - 180 * 86400000,
  );
  const brands = new Set(
    [
      ...visits.map((v) => v.brand_key),
      ...routines.map((r) => r.brand_key),
      ...previous.map((s) => s.brand_key),
    ].filter(Boolean),
  );
  const total = visits.reduce((s, v) => s + v.amount_cents, 0);
  const selections = [...brands]
    .map((brand) => {
      const rows = visits.filter((v) => v.brand_key === brand),
        catalog = programs.filter((p) => p.merchant_id === brand),
        routine = routines.some(
          (r) => r.brand_key === brand && r.purpose === "purchase",
        ),
        count90 = rows.filter(
          (v) => Date.parse(v.occurred_at) >= +now - 90 * 86400000,
        ).length,
        last = rows
          .map((v) => Date.parse(v.occurred_at))
          .sort((a, b) => b - a)[0];
      let reasons = [],
        selected = false;
      if (!catalog.length) reasons = ["no_program"];
      else if (catalog.every((p) => p.paid_membership))
        reasons = ["paid_membership"];
      else if (routine || rows.length >= 2) {
        selected = true;
        reasons = [
          ...(routine ? ["routine_member"] : []),
          ...(rows.length >= 2 ? ["visits_180d_ge_2"] : []),
        ];
      } else reasons = ["seen_once"];
      const branches = merchants
        .filter(
          (m) =>
            m.brand_key === brand && rows.some((r) => r.merchant_id === m.id),
        )
        .map((m) => ({
          id:m.id,name:m.name,category:m.category,lat:m.lat,lon:m.lon,brand_key:m.brand_key,
          visits: rows.filter((r) => r.merchant_id === m.id).length,
        }))
        .sort((a, b) => b.visits - a.visits || a.id.localeCompare(b.id));
      return {
        brand_key: brand,
        selected,
        decided_by: "rule",
        reasons,
        stats: {
          visits90: count90,
          visits180: rows.length,
          daysSince: last ? Math.floor((+now - last) / 86400000) : null,
          share: total
            ? rows.reduce((s, v) => s + v.amount_cents, 0) / total
            : 0,
          sources: rows.reduce(
            (s, v) => ((s[v.provenance] = (s[v.provenance] || 0) + 1), s),
            {},
          ),
        },
        branches,
      };
    })
    .sort(
      (a, b) =>
        Number(b.reasons.includes("routine_member")) -
          Number(a.reasons.includes("routine_member")) ||
        b.stats.visits90 - a.stats.visits90 ||
        (a.stats.daysSince ?? Infinity) - (b.stats.daysSince ?? Infinity) ||
        a.brand_key.localeCompare(b.brand_key),
    );
  let count = 0;
  for (const s of selections) {
    const old = previous.find((p) => p.brand_key === s.brand_key);
    if (old?.decided_by === "user") {
      s.selected = old.selected;
      s.decided_by = "user";
      s.reasons = ["user_choice"];
    } else if (s.selected && ++count > MAX_SELECTED) {
      s.selected = false;
      s.reasons.push("over_max_selected");
    }
  }
  return selections;
}
module.exports = { selectStores, MIN_VISITS_180D, MAX_SELECTED };
