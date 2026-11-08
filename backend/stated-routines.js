const { BRANDS } = require("./brands");
const { fail } = require("./pipeline-utils");
const minute = (s) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
    ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3))
    : null;
function validateEntries(text, entries) {
  const accepted = [],
    notUnderstood = [];
  for (const e of entries.slice(0, 8)) {
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
