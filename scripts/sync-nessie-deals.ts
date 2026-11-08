import { config, required } from "../src/config.js";
import { poolFor, tenant } from "../src/db.js";
import { observePurchase } from "../src/service.js";
import { Purchase } from "../src/contracts.js";

const NESSIE_BASE = process.env.NESSIE_API_BASE_URL || "https://v2-prod-api.nessieisreal.com";
const NESSIE_KEY = process.env.NESSIE_API_KEY;

if (!NESSIE_KEY) {
  console.error("Missing NESSIE_API_KEY");
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || config.WORKER_DATABASE_URL || config.DATABASE_URL;
const pool = poolFor(required(dbUrl, "DATABASE_URL"));

const MERCHANT_SLUG_MAP: Record<string, string> = {
  "Chipotle Mexican Grill": "chipotle",
  "Panera Bread": "panera",
  "Nike Store": "nike",
  "Walmart Supercenter": "walmart",
  "Target": "target",
  "Best Buy": "bestbuy",
  "The Home Depot": "homedepot",
  "Sephora": "sephora",
  "Uber Eats": "uber_eats",
  "Booking.com Travel": "booking_com",
  "Lululemon": "lululemon",
  "Macy's": "macys",
};

async function main() {
  const owner = process.argv[2] ?? "64b0ef0f-cd28-4af3-b192-8243ccc8e1ce";
  console.log(`=== SYNCING NESSIE TRANSACTIONS WITH DEALS PLATFORM FOR OWNER ${owner} ===\n`);

  try {
    await tenant(pool, owner, async (tx) => {
      // Step 1: Read existing supported programs from TigerData
      console.log("[1/3] Reading supported merchant programs from TigerData deals.program...");
      const programsRes = await tx.query("SELECT id, merchant_id, name, signup_url FROM deals.program ORDER BY name");
      console.log(`Found ${programsRes.rows.length} supported merchant programs in TigerData:`);
      for (const p of programsRes.rows) {
        console.log(`  - [${p.merchant_id}] ${p.name} -> ${p.signup_url}`);
      }

      // Step 2: Fetch merchants and transactions from Nessie API
      console.log("\n[2/3] Fetching live merchants and transactions from Nessie v2...");
      const headers = { Authorization: `Bearer ${NESSIE_KEY}` };
      const merchantsRes = await fetch(`${NESSIE_BASE}/merchants`, { headers }).then((r) => r.json());
      const merchantMap = new Map((merchantsRes.items || []).map((m: any) => [m.id, m]));

      let allTxns: any[] = [];
      let url = `${NESSIE_BASE}/transactions?limit=100`;
      while (url && allTxns.length < 500) {
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (data.items) allTxns.push(...data.items);
        if (data.next_cursor) {
          url = `${NESSIE_BASE}/transactions?limit=100&cursor=${data.next_cursor}`;
        } else {
          break;
        }
      }
      console.log(`  Fetched ${allTxns.length} transactions from Nessie.`);

      // Step 3: Ingest transactions into TigerData purchase_observation
      console.log("\n[3/3] Recording purchases into TigerData deals.purchase_observation...");
      let imported = 0;
      let mappedCount = 0;

      for (const t of allTxns) {
        if (t.kind !== "purchase" || t.status !== "completed") continue;
        const merchantObj: any = t.merchant_id ? merchantMap.get(t.merchant_id) : null;
        const merchantName = merchantObj?.name || "";
        const slug = MERCHANT_SLUG_MAP[merchantName];

        if (!slug) continue;
        mappedCount++;

        const purchase: Purchase = {
          transactionId: t.id,
          merchantId: slug,
          occurredAt: t.created_at,
          status: "posted",
          provenance: "verified_import",
          sourceVersion: 1,
        };

        const res = await observePurchase(tx, owner, purchase, new Date());
        if (!res.duplicate) imported++;
      }

      console.log(`  Processed ${mappedCount} merchant purchases (${imported} newly recorded in TigerData).`);

      // Verify discoveries & active offers inside tenant scope
      const discoveries = await tx.query(
        `SELECT t.merchant_id, max(t.occurred_at) as last_seen, p.name,
                CASE WHEN p.id IS NULL THEN 'unsupported' ELSE 'supported' END as support_status
         FROM deals.purchase_observation t
         LEFT JOIN deals.program p ON p.merchant_id = t.merchant_id
         WHERE t.owner_id = $1
         GROUP BY t.merchant_id, p.name, p.id
         ORDER BY p.name NULLS LAST`,
        [owner]
      );

      console.log("\n=== Verified Merchant Discoveries in TigerData ===");
      console.table(discoveries.rows);

      const activeOffers = await tx.query(
        `SELECT o.id, p.name as merchant_name, o.terms->>'title' as title, o.status
         FROM deals.offer o
         JOIN deals.program p ON p.id = o.program_id
         WHERE o.owner_id = $1 AND o.status = 'active'
         ORDER BY p.name`,
        [owner]
      );

      console.log("\n=== Active Rewards in TigerData for Owner ===");
      console.table(activeOffers.rows);

      const enrollments = await tx.query(
        `SELECT e.id, p.name as merchant_name, e.state, e.signup_status, e.loyalty_status
         FROM deals.enrollment e
         JOIN deals.program p ON p.id = e.program_id
         WHERE e.owner_id = $1
         ORDER BY p.name`,
        [owner]
      );

      console.log("\n=== Merchant Enrollments in TigerData ===");
      console.table(enrollments.rows);

      console.log(`\nSUCCESS: ${discoveries.rows.length} merchant programs discovered from transaction history, and ${activeOffers.rows.length} active offers verified!`);
    });
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exitCode = 1;
});
