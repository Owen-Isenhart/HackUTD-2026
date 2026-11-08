const { BRANDS } = require("./brands");
const { fail } = require("./pipeline-utils");
const minute = (s) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
    ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3))
    : null;
// Models often answer "8:00", "8 AM" or "8:00am"; normalize to HH:MM before validating.
function clock(value) {
  const s = String(value ?? "");
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?\s*$/i.exec(s) || /^\s*(\d{1,2}):(\d{2})\s*$/.exec(s);
  if (!m) return value;
  let hour = Number(m[1]);
  const ampm = m[3]?.toLowerCase();
  if (ampm === "p" && hour < 12) hour += 12;
  if (ampm === "a" && hour === 12) hour = 0;
  if (hour > 23 || Number(m[2] || 0) > 59) return value;
  return String(hour).padStart(2, "0") + ":" + (m[2] || "00");
}
const squash = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const brandKey = (value) =>
  BRANDS.find((b) => [b[0], b[1], b[3]].filter(Boolean).some((n) => squash(n) === squash(value)))?.[0] ?? value;
function validateEntries(text, entries) {
  const accepted = [],
    notUnderstood = [];
  for (const raw of entries.slice(0, 8)) {
    const e = {
      ...raw,
      // Small models often answer "unknown" for a listed brand; resolve it from
      // the user's own quoted words instead of trusting the label alone.
      brand: BRANDS.some((b) => b[0] === brandKey(raw.brand))
        ? brandKey(raw.brand)
        : BRANDS.find((b) => [b[1], b[3]].filter(Boolean).some((n) => squash(raw.quote).includes(squash(n))))?.[0] ?? raw.brand,
      days: Array.isArray(raw.days) ? raw.days.map((d) => String(d).toLowerCase().slice(0, 3)) : raw.days,
      start: clock(raw.start),
      end: clock(raw.end),
    };
    if (
      !e.quote ||
      !text.includes(e.quote) ||
      !BRANDS.some((b) => b[0] === e.brand) ||
      !["purchase", "commute"].includes(e.purpose) ||
      !Array.isArray(e.days) ||
      !e.days.length ||
      e.days.some(
        (d) => !["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(d),
      ) ||
      minute(e.start) === null ||
      minute(e.end) === null
    ) {
      notUnderstood.push(e.quote || "Unrecognized stop");
      continue;
    }
    const explicit =
      /\b(?:around|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(e.quote);
    if (e.start === e.end) {
      // A zero-length window means the model had no time. Keep a stated time
      // as a 30-minute window; otherwise ask the user for one.
      if (!explicit) {
        accepted.push({ ...e, start: "", end: "", needsTime: true });
        continue;
      }
      const m = (minute(e.start) + 30) % 1440;
      e.end = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    }
    if (explicit) {
      let hour = Number(explicit[1]);
      if (explicit[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (
        Math.abs(minute(e.start) - (hour * 60 + Number(explicit[2] || 0))) > 30
      ) {
        accepted.push({ ...e, start: "", end: "", needsTime: true });
        continue;
      }
    }
    accepted.push(e);
  }
  return { accepted, notUnderstood };
}
async function extractStops(text, request) {
  if (typeof text !== "string" || !text.trim() || text.length > 2000)
    throw fail("invalid_stops");
  try {
    return validateEntries(text, await request(text));
  } catch {
    return {
      accepted: [],
      notUnderstood: [text],
      reason: "extraction_unavailable",
    };
  }
}
function workRoutines(value) {
  if (
    !Array.isArray(value.days) ||
    !value.days.length ||
    value.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7) ||
    minute(value.start) === null ||
    minute(value.end) === null
  )
    throw fail("invalid_work_schedule");
  const base = {
    kind: "stated",
    brand_key: null,
    branch_merchant_id: null,
    weekdays: [...new Set(value.days)].sort(),
    typical_low_cents: null,
    typical_mid_cents: null,
    typical_high_cents: null,
    confidence: null,
    support: { quote: "User-entered work schedule" },
    provenance: ["user_stated"],
    evidence: "Work hours entered by you",
  };
  return [
    {
      ...base,
      purpose: "work",
      window_start_minute: minute(value.start),
      window_end_minute: minute(value.end),
    },
    {
      ...base,
      purpose: "commute",
      window_start_minute: (minute(value.start) + 1395) % 1440,
      window_end_minute: minute(value.start),
    },
    {
      ...base,
      purpose: "commute",
      window_start_minute: minute(value.end),
      window_end_minute: (minute(value.end) + 45) % 1440,
    },
  ];
}
module.exports = { minute, validateEntries, extractStops, workRoutines };
