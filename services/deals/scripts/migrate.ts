import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { config, required } from "../src/config.js";
import { poolFor } from "../src/db.js";

export async function migrate(url: string) {
  const pool = poolFor(url);
  const tx = await pool.connect();
  try {
    await tx.query(
      "SELECT pg_advisory_lock(hashtext('nessiessential-deals-migrations'))",
    );
    await tx.query("CREATE SCHEMA IF NOT EXISTS deals");
    await tx.query("REVOKE ALL ON SCHEMA deals FROM PUBLIC");
    await tx.query(
      "CREATE TABLE IF NOT EXISTS deals.schema_migration(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(
        new URL(`../migrations/${name}`, import.meta.url),
        "utf8",
      );
      const checksum = createHash("sha256").update(sql).digest("hex");
      const { rows } = await tx.query(
        "SELECT checksum FROM deals.schema_migration WHERE name=$1",
        [name],
      );
      if (rows[0]) {
        if (rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await tx.query("BEGIN");
      try {
        await tx.query(sql);
        await tx.query(
          "INSERT INTO deals.schema_migration(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
        await tx.query("COMMIT");
        console.log(`Applied ${name}`);
      } catch (error) {
        await tx.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await tx
      .query(
        "SELECT pg_advisory_unlock(hashtext('nessiessential-deals-migrations'))",
      )
      .catch(() => {});
    tx.release();
    await pool.end();
  }
}
if (
  process.argv[1]?.endsWith("/migrate.ts") ||
  process.argv[1]?.endsWith("/migrate.js")
) {
  migrate(required(config.ADMIN_DATABASE_URL, "ADMIN_DATABASE_URL")).catch(
    () => {
      console.error(
        "Migration failed; inspect database and migration history. No credentials logged.",
      );
      process.exitCode = 1;
    },
  );
}
