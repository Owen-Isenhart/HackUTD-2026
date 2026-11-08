import { randomBytes } from "node:crypto";
import { writeFile, chmod } from "node:fs/promises";
import { config, required } from "../src/config.js";
import { poolFor } from "../src/db.js";
const admin = required(config.ADMIN_DATABASE_URL, "ADMIN_DATABASE_URL");
const pool = poolFor(admin);
const tx = await pool.connect();
try {
  await tx.query("BEGIN");
  const uris: Record<string, string> = {};
  for (const [role, key] of [
    ["deals_api", "DATABASE_URL"],
    ["deals_worker", "WORKER_DATABASE_URL"],
  ] as const) {
    const password = randomBytes(36).toString("base64url");
    // Fixed role names; generated password contains only base64url characters.
    const found = await tx.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
      role,
    ]);
    if (found.rowCount)
      throw new Error(
        "Runtime roles already exist. Reuse stored credentials; do not rotate implicitly.",
      );
    await tx.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
    await tx.query(`GRANT USAGE ON SCHEMA deals TO ${role}`);
    await tx.query(`GRANT SELECT ON deals.program TO ${role}`);
    for (const table of [
      "owner",
      "identity",
      "source",
      "enrollment",
      "purchase_observation",
      "message",
      "delivery",
      "offer",
      "eligibility",
      "job",
    ])
      await tx.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON deals.${table} TO ${role}`,
      );
    await tx.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON deals.offer_revision,deals.event TO ${role}`,
    );
    await tx.query(
      `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA deals TO ${role}`,
    );
    await tx.query(
      `GRANT EXECUTE ON FUNCTION deals.route_identity(text,text) TO ${role}`,
    );
    const url = new URL(admin);
    url.username = role;
    url.password = password;
    uris[key] = url.toString();
  }
  await tx.query(
    "GRANT EXECUTE ON FUNCTION deals.active_owners(),deals.claim_job(uuid) TO deals_worker",
  );
  const content =
    Object.entries({
      ...uris,
      DEALS_AUTH_SECRET: randomBytes(48).toString("base64url"),
    })
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join("\n") + "\n";
  // Refuse to overwrite existing runtime secrets; store before commit to avoid losing generated passwords.
  await writeFile(".env.deals.runtime.local", content, {
    mode: 0o600,
    flag: "wx",
  });
  await chmod(".env.deals.runtime.local", 0o600);
  await tx.query("COMMIT");
  console.log(
    "Created restricted API/worker roles. Saved runtime secrets to .env.deals.runtime.local (0600).",
  );
} catch (error) {
  await tx.query("ROLLBACK");
  console.error(
    error instanceof Error && error.message.startsWith("Runtime roles")
      ? error.message
      : "Provisioning failed. Existing runtime credentials were not overwritten.",
  );
  process.exitCode = 1;
} finally {
  tx.release();
  await pool.end();
}
