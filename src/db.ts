import pg from "pg";
import { z } from "zod";
export type Tx = pg.PoolClient;
export function poolFor(connectionString: string): pg.Pool {
  // pg honors sslmode/sslrootcert in the CLI-generated URI. Never disable TLS verification.
  const url = new URL(connectionString);
  if (
    url.searchParams.has("sslmode") &&
    url.searchParams.get("sslmode") !== "disable"
  )
    url.searchParams.set("sslmode", "verify-full");
  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: 8,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 20_000,
    application_name: "nessiessential-deals",
  });
  pool.on("error", () => {
    process.stderr.write("Database connection unavailable\n");
  });
  return pool;
}
export async function tenant<T>(
  pool: pg.Pool,
  owner: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  z.uuid().parse(owner);
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT set_config('deals.owner_id',$1,true)", [owner]);
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
}
export async function enqueue(
  tx: Tx,
  owner: string,
  kind: string,
  key: string,
  payload: unknown = {},
) {
  await tx.query(
    `INSERT INTO deals.job(owner_id,kind,operation_key,payload) VALUES($1,$2,$3,$4)
    ON CONFLICT(owner_id,kind,operation_key) DO NOTHING`,
    [owner, kind, key, JSON.stringify(payload)],
  );
}
export async function emit(
  tx: Tx,
  owner: string,
  type: string,
  entity: string,
  revision: number,
  reason: string,
) {
  await tx.query(
    `INSERT INTO deals.event(owner_id,type,entity_id,revision,reason) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT DO NOTHING`,
    [owner, type, entity, revision, reason],
  );
}
export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
