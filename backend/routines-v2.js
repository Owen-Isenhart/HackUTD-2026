const {
  baseline,
  net,
  quantile,
  localParts,
  addDays,
} = require("./pipeline-utils");
const MIN_WEEKS = 6,
  MIN_RECENT_WEEKS = 2,
  MAX_WINDOW_MINUTES = 90;
function visitsFromLedger(
  ledger,
  now = new Date(),
  timeZone = "America/Chicago",
) {
  const last = new Map(),
    visits = [];
  for (const r of ledger
    .filter(
      (r) =>
        baseline(r) &&
        r.brand_key &&
        Date.parse(r.occurred_at) >= +now - 182 * 86400000 &&
        Date.parse(r.occurred_at) <= +now,
    )
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))) {
    const prior = last.get(r.brand_key);
    if (
      prior &&
      Date.parse(r.occurred_at) - Date.parse(prior.occurred_at) <= 1800000
    ) {
      prior.amount_cents += net(r);
      continue;
    }
    const local = localParts(r.occurred_at, timeZone);
    const v = {
      ...r,
      ...local,
      amount_cents: net(r),
      week: addDays(local.date, 1 - local.weekday),
    };
    visits.push(v);
    last.set(r.brand_key, v);
  }
  return visits;
}
function circularWindow(minutes) {
  if (!minutes.length) return { start: 0, end: 0, width: 0, k: 0 };
  let best;
  for (const origin of [...new Set(minutes)]) {
    const shifted = minutes.map((m) => (m - origin + 1440) % 1440);
    const lo = quantile(shifted, 0.1),
      hi = quantile(shifted, 0.9);
    const candidate = {
      start: (lo + origin) % 1440,
      end: (hi + origin) % 1440,
      width: hi - lo,
      k: shifted.filter((m) => m >= lo && m <= hi).length,
    };
    if (!best || candidate.width < best.width) best = candidate;
  }
  return best;
}
function binomialTail(n, k, p) {
  if (p === 0) return k > 0 ? 0 : 1;
  let term = (1 - p) ** n,
    sum = k === 0 ? term : 0;
  for (let i = 1; i <= n; i++) {
    term *= ((n - i + 1) / i) * (p / (1 - p));
    if (i >= k) sum += term;
  }
  return Math.min(1, sum);
}
const contains = (w, m) => (m - w.start + 1440) % 1440 <= w.width;
const overlap = (a, b) => {
  let count = 0;
  for (let m = 0; m < 1440; m++) if (contains(a, m) && contains(b, m)) count++;
  return count >= Math.min(a.width + 1, b.width + 1) / 2;
};
function detectRoutines(visits, now = new Date()) {
  const groups = new Map();
  for (const v of visits) {
    const k = v.brand_key + ":" + v.weekday;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  const accepted = [];
  for (const g of groups.values()) {
    const weeks = new Set(g.map((v) => v.week)).size;
    const recent = new Set(
      g
        .filter((v) => Date.parse(v.occurred_at) >= +now - 56 * 86400000)
        .map((v) => v.week),
    ).size;
    if (weeks < MIN_WEEKS || recent < MIN_RECENT_WEEKS) continue;
    const window = circularWindow(g.map((v) => v.minute));
    if (window.width > MAX_WINDOW_MINUTES) continue;
    const probability = binomialTail(
      g.length,
      window.k,
      Math.max(1, window.width) / 1440,
    );
    if (probability >= 0.01 / groups.size) continue;
    accepted.push({
      brand_key: g[0].brand_key,
      category: g[0].category,
      weekdays: [g[0].weekday],
      window,
      visits: g,
      probability,
      weeks,
    });
  }
  const merged = [];
  for (const a of accepted) {
    const old = merged.find(
      (b) => a.brand_key === b.brand_key && overlap(a.window, b.window),
    );
    if (old) {
      old.weekdays.push(...a.weekdays);
      old.visits.push(...a.visits);
      old.probability = Math.max(old.probability, a.probability);
      old.window = circularWindow(old.visits.map((v) => v.minute));
    } else
      merged.push({ ...a, weekdays: [...a.weekdays], visits: [...a.visits] });
  }
  return merged.map((a) => {
    const sources = {};
    const branches = {};
    for (const v of a.visits) {
      sources[v.provenance] = (sources[v.provenance] || 0) + 1;
      if (v.merchant_id)
        branches[v.merchant_id] = (branches[v.merchant_id] || 0) + 1;
    }
    return {
      kind: "inferred",
      purpose: "purchase",
      brand_key: a.brand_key,
      branch_merchant_id:
        Object.keys(branches).sort(
          (x, y) => branches[y] - branches[x] || x.localeCompare(y),
        )[0] || null,
      weekdays: a.weekdays.sort(),
      window_start_minute: a.window.start,
      window_end_minute: a.window.end,
      typical_low_cents: quantile(
        a.visits.map((v) => v.amount_cents),
        0.25,
      ),
      typical_mid_cents: quantile(
        a.visits.map((v) => v.amount_cents),
        0.5,
      ),
      typical_high_cents: quantile(
        a.visits.map((v) => v.amount_cents),
        0.75,
      ),
      confidence: Math.min(
        1,
        new Set(a.visits.map((v) => v.week + ":" + v.weekday)).size /
          (26 * a.weekdays.length),
      ),
      support: {
        n: a.visits.length,
        k: a.window.k,
        window: a.window,
        p: a.probability,
        sources,
      },
      provenance: Object.keys(sources).sort(),
      evidence:
        a.visits.length +
        " visits over 26 weeks; local window " +
        a.window.start +
        "–" +
        a.window.end +
        " minutes. " +
        (sources.synthetic_persona
          ? "Includes synthetic demo history."
          : "Sandbox bank data."),
    };
  });
}
module.exports = {
  detectRoutines,
  visitsFromLedger,
  circularWindow,
  binomialTail,
  MIN_WEEKS,
  MIN_RECENT_WEEKS,
  MAX_WINDOW_MINUTES,
};
