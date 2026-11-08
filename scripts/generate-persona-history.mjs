import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const {
  random,
  hash,
  localParts,
  localToUTC,
  addDays,
} = require("../backend/pipeline-utils");
export const HABITS = [
  ["chipotle", [1, 2, 3, 4, 5], 660, 685, 0.8, 1150, 1600, "dining"],
  ["starbucks", [1, 3, 5], 485, 510, 0.85, 525, 745, "coffee"],
  ["chick_fil_a", [2, 4], 730, 760, 0.5, 850, 1250, "dining"],
  ["taco_bell", [5], 1260, 1350, 0.6, 800, 1400, "dining"],
  ["panera", [6], 630, 720, 0.25, 1200, 1800, "dining"],
  ["jcpenney", [6], 780, 960, 0.9, 3500, 9000, "retail"],
  ["macys", [6], 840, 1020, 0.8, 4000, 12000, "retail"],
];
export function campusBreak(date) {
  return /-(12-(1[5-9]|2[0-8])|01-0[1-7]|05-(1[8-9]|2[0-9]|31))$/.test(date);
}
export function generatePersona() {
  const rng = random(2026),
    records = [];
  let saturday = 0;
  const monthly = new Set();
  for (let date = "2024-11-09"; date <= "2026-11-07"; date = addDays(date, 1)) {
    const { weekday } = localParts(date + "T12:00:00Z", "UTC");
    if (weekday === 6) saturday++;
    for (const [
      brand,
      days,
      start,
      end,
      chance,
      low,
      high,
      category,
    ] of HABITS) {
      if (!days.includes(weekday)) continue;
      if (
        ["chipotle", "starbucks", "chick_fil_a"].includes(brand) &&
        campusBreak(date)
      )
        continue;
      if (brand === "jcpenney") {
        if (monthly.has(date.slice(0, 7))) continue;
        monthly.add(date.slice(0, 7));
      }
      if (brand === "macys" && saturday % 6) continue;
      if (rng() > chance) continue;
      const normal =
        Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-10))) *
        Math.cos(2 * Math.PI * rng());
      const minute = Math.round(
        Math.max(
          start,
          Math.min(end, (start + end) / 2 + (normal * (end - start)) / 6),
        ),
      );
      const occurredAt = localToUTC(date, minute, "America/Chicago");
      records.push({
        id: "persona_" + hash([2026, brand, date, minute]).slice(0, 12),
        brand,
        merchantId: null,
        occurredAt,
        amountCents: low + Math.floor(rng() * (high - low + 1)),
        category,
      });
    }
  }
  return {
    provenance: "synthetic_persona",
    generator: "generate-persona-history.mjs",
    generatorVersion: 1,
    seed: 2026,
    nessieCustomerId: "cust_01m6x5w635z27trg3dfbhjxjvx",
    timeZone: "America/Chicago",
    from: "2024-11-09",
    to: "2026-11-07",
    notice:
      "Generated demo habits. Not real purchases. Merchant IDs resolved from the imported catalog; no invented branch IDs.",
    records: records.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync("data/persona", { recursive: true });
  fs.writeFileSync(
    "data/persona/alex-taylor.v1.json",
    JSON.stringify(generatePersona(), null, 2) + "\n",
  );
}
