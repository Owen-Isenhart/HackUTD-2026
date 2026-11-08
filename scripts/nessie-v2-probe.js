const fs = require("node:fs");
const { createNessieV2 } = require("../backend/nessie-v2");
const { quantile, localParts } = require("../backend/pipeline-utils");
async function probe(nessie) {
  const customers = await nessie.listCustomers(),
    accounts = [];
  for (const c of customers)
    for (const a of await nessie.customerAccounts(c.id)) {
      const rows = await nessie.accountTransactions(a.id),
        times = rows.map((r) => Date.parse(r.created_at)).sort((a, b) => a - b),
        gaps = times.slice(1).map((n, i) => (n - times[i]) / 1000);
      const counts = (key) =>
        rows.reduce(
          (s, r) => (
            (s[r[key] || "unknown"] = (s[r[key] || "unknown"] || 0) + 1),
            s
          ),
          {},
        );
      accounts.push({
        type: a.type,
        rows: rows.length,
        truncated: rows.length === 5000,
        kinds: counts("kind"),
        statuses: counts("status"),
        dateRange: times.length
          ? [
              new Date(times[0]).toISOString(),
              new Date(times.at(-1)).toISOString(),
            ]
          : null,
        gapSeconds: {
          min: gaps.length ? Math.min(...gaps) : null,
          median: quantile(gaps, 0.5),
          max: gaps.length ? Math.max(...gaps) : null,
        },
        purchaseHours: rows
          .filter((r) => r.kind === "purchase")
          .reduce((s, r) => {
            const h = Math.floor(localParts(r.created_at).minute / 60);
            s[h] = (s[h] || 0) + 1;
            return s;
          }, {}),
        purchasesPerMerchant: rows
          .filter((r) => r.kind === "purchase")
          .reduce(
            (s, r) => ((s[r.merchant_id] = (s[r.merchant_id] || 0) + 1), s),
            {},
          ),
        payrollDates: rows
          .filter(
            (r) => r.kind === "deposit" && /PAYROLL/i.test(r.description || ""),
          )
          .map((r) => r.created_at),
        linkedReversals: rows.filter(
          (r) =>
            ["refund", "chargeback"].includes(r.kind) &&
            r.parent_transaction_id,
        ).length,
        eventTypes: [
          ...new Set(
            nessie
              .rows(await nessie.events({ after: 0, accountId: a.id }))
              .map((e) => e.type),
          ),
        ],
      });
    }
  return {
    status: "measured",
    asOf: new Date().toISOString(),
    customers: customers.length,
    accounts,
    provenance: "nessie_sandbox",
  };
}
if (require.main === module) {
  (async () => {
    const output = process.env.NESSIE_V2_API_KEY
      ? await probe(
          createNessieV2({
            apiKey: process.env.NESSIE_V2_API_KEY,
            baseUrl: process.env.NESSIE_V2_BASE_URL,
          }),
        )
      : {
          status: "blocked",
          reason: "NESSIE_V2_API_KEY is not configured",
          measured: false,
        };
    fs.writeFileSync(
      "docs/nessie-v2-probe.json",
      JSON.stringify(output, null, 2) + "\n",
    );
    console.log(output.status);
  })().catch((e) => {
    console.error("Probe failed:", e.code || "unavailable");
    process.exitCode = 1;
  });
}
module.exports = { probe };
