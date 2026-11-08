import { config, required } from "../src/config.js";
import { poolFor, tenant } from "../src/db.js";
import { seedCapitalOneOffers } from "../src/capital_one.js";

async function main() {
  const dbUrl =
    process.env.SEED_DATABASE_URL ||
    config.WORKER_DATABASE_URL ||
    config.DATABASE_URL;
  const pool = poolFor(required(dbUrl, "DATABASE_URL"));

  try {
    const explicitOwner = process.argv[2];
    let ownerIds: string[] = [];

    if (explicitOwner) {
      ownerIds = [explicitOwner];
    } else {
      const ownersRes = await pool.query("SELECT deals.active_owners() AS id");
      ownerIds = ownersRes.rows.map((r: any) => r.id).filter(Boolean);
    }

    console.log(`Found ${ownerIds.length} active consented owner(s).`);

    for (const id of ownerIds) {
      await tenant(pool, id, async (tx) => {
        const count = await seedCapitalOneOffers(tx, id);
        console.log(`Owner ${id}: seeded ${count} Capital One offers.`);
      });
    }

    console.log("Capital One offers successfully aggregated and seeded.");
  } catch (err) {
    console.error("Failed to seed Capital One offers:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
