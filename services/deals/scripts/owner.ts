import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { config, required } from "../src/config.js";
import { poolFor } from "../src/db.js";
import { bootstrapOwner } from "../src/service.js";
import { issueToken } from "../src/auth.js";
const owner = process.argv[2] ?? randomUUID();
const timezone = process.argv[3] ?? "America/Chicago";
const pool = poolFor(required(config.DATABASE_URL, "DATABASE_URL"));
try {
  await bootstrapOwner(pool, owner, timezone);
  const token = await issueToken(owner, config);
  await mkdir(".local", { recursive: true, mode: 0o700 });
  const path = `.local/owner-${owner}.json`;
  await writeFile(
    path,
    JSON.stringify({ owner, timezone, token, expiresIn: "1 hour" }, null, 2) +
      "\n",
    { mode: 0o600 },
  );
  console.log(
    `Owner ready. Token saved to ${path} (0600); not printed. Consent is granted in the app.`,
  );
} catch {
  console.error("Owner creation failed. Verify configuration and owner UUID.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
