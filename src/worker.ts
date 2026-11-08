import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import type pg from "pg";
import { config, required, type Config } from "./config.js";
import { DomainError, emit, enqueue, poolFor, tenant } from "./db.js";
import { ProviderError, reconcileOwner, PhotonClient } from "./photon.js";
import {
  deleteContent,
  enrollmentHandoff,
  maintenance,
  processMessage,
  unsubscribeHandoff,
} from "./service.js";

export async function schedule(pool: pg.Pool, cfg: Config, now = new Date()) {
  const owners = (await pool.query("SELECT deals.active_owners() AS id")).rows;
  for (const { id } of owners)
    await tenant(pool, id, async (tx) => {
      await enqueue(
        tx,
        id,
        "maintenance",
        String(Math.floor(now.getTime() / 60_000)),
      );
      const source = (
        await tx.query(
          "SELECT * FROM deals.source WHERE owner_id=$1 AND product='photon_email'",
          [id],
        )
      ).rows[0];
      if (
        source &&
        cfg.PHOTON_API_KEY &&
        cfg.PHOTON_EMAIL_ENTITLEMENT_CONFIRMED &&
        !/^photon_http_(400|401|403|404|422)$/.test(source.reason ?? "")
      )
        await enqueue(
          tx,
          id,
          "reconcile",
          String(
            Math.floor(
              now.getTime() / (cfg.PHOTON_RECONCILE_INTERVAL_SECONDS * 1000),
            ),
          ),
        );
    });
}
export async function runOne(
  pool: pg.Pool,
  cfg: Config,
  client?: PhotonClient,
): Promise<boolean> {
  const token = randomUUID();
  const job = (await pool.query("SELECT * FROM deals.claim_job($1)", [token]))
    .rows[0];
  if (!job) return false;
  try {
    if (job.kind === "reconcile") {
      if (!cfg.PHOTON_EMAIL_ENTITLEMENT_CONFIRMED)
        throw new ProviderError("email_entitlement_unconfirmed", false);
      // A checkpoint makes reconciliation safe if a lease is lost during pagination.
      await reconcileOwner(pool, cfg, job.owner_id, client);
    }
    await tenant(pool, job.owner_id, async (tx) => {
      // Every lifecycle mutation locks owner first, including revocation and purchase updates.
      await tx.query("SELECT id FROM deals.owner WHERE id=$1 FOR UPDATE", [
        job.owner_id,
      ]);
      const held = (
        await tx.query(
          "SELECT * FROM deals.job WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND state='running' FOR UPDATE",
          [job.owner_id, job.id, token],
        )
      ).rows[0];
      if (!held) return;
      const p = job.payload;
      switch (job.kind) {
        case "extract":
          await processMessage(tx, job.owner_id, p.messageId, cfg);
          break;
        case "enroll":
          await enrollmentHandoff(tx, job.owner_id, p.enrollmentId);
          break;
        case "unsubscribe":
          await unsubscribeHandoff(tx, job.owner_id, p.enrollmentId, p.version);
          break;
        case "maintenance":
          await maintenance(tx, job.owner_id);
          break;
        case "delete_content":
          await deleteContent(tx, job.owner_id);
          break;
      }
      await tx.query(
        "UPDATE deals.job SET state='completed',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE owner_id=$1 AND id=$2 AND lease_token=$3",
        [job.owner_id, job.id, token],
      );
    });
  } catch (error) {
    const retryable =
      error instanceof ProviderError
        ? error.retryable
        : !(error instanceof DomainError);
    const code =
      error instanceof ProviderError || error instanceof DomainError
        ? error.code
        : "job_processing_failed";
    const retry = retryable && job.attempts < job.max_attempts;
    const delay = Math.max(
      error instanceof ProviderError ? error.retryAfterSeconds : 0,
      Math.min(3600, 2 ** job.attempts * 10) + Math.floor(Math.random() * 5),
    );
    await tenant(pool, job.owner_id, async (tx) => {
      const updated = await tx.query(
        `UPDATE deals.job SET state=$4,last_error=$5,available_at=now()+$6*interval '1 second',lease_token=NULL,lease_until=NULL,updated_at=now()
        WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND state='running' RETURNING id`,
        [job.owner_id, job.id, token, retry ? "queued" : "dead", code, delay],
      );
      if (updated.rowCount && job.kind === "reconcile") {
        await tx.query(
          "UPDATE deals.source SET status='degraded',reason=$2,updated_at=now() WHERE owner_id=$1 AND product='photon_email' AND status<>'revoked'",
          [job.owner_id, code],
        );
        await emit(
          tx,
          job.owner_id,
          "deal_source.degraded",
          "photon_email",
          job.attempts,
          code,
        );
      }
    });
  }
  return true;
}
async function main() {
  const pool = poolFor(
    required(config.WORKER_DATABASE_URL, "WORKER_DATABASE_URL"),
  );
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      stopping = true;
    });
  let scheduled = 0;
  try {
    while (!stopping) {
      try {
        if (Date.now() - scheduled > 60_000) {
          await schedule(pool, config);
          scheduled = Date.now();
        }
        if (!(await runOne(pool, config))) await pause(1000);
      } catch {
        console.error("Worker unavailable; retrying in 5 seconds");
        await pause(5000);
      }
    }
  } finally {
    await pool.end();
  }
}
if (
  process.argv[1]?.endsWith("/worker.ts") ||
  process.argv[1]?.endsWith("/worker.js")
)
  main().catch(() => {
    console.error("Worker startup failed");
    process.exitCode = 1;
  });
