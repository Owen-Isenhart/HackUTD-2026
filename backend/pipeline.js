const { randomUUID } = require("node:crypto");
const { hash, transaction, localParts } = require("./pipeline-utils");
const STAGES = [
  "bank_pull",
  "persona_load",
  "forecast",
  "routines",
  "budget",
  "store_selection",
  "enrollment_sync",
];
async function queueRun(db, ownerId) {
  const runId = randomUUID();
  for (const kind of STAGES)
    await db.query(
      "INSERT INTO hackutd_finance.pipeline_job(id,owner_id,run_id,kind) VALUES($1,$2,$3,$4)",
      [randomUUID(), ownerId, runId, kind],
    );
  return runId;
}
async function runOne(pool, handlers) {
  const token = randomUUID();
  const job = (
    await pool.query(
      `WITH ready AS (SELECT j.id FROM hackutd_finance.pipeline_job j WHERE ((j.state IN ('queued','failed') AND j.available_at<=now()) OR (j.state='running' AND j.lease_until<now())) AND NOT EXISTS (SELECT 1 FROM hackutd_finance.pipeline_job p WHERE p.owner_id=j.owner_id AND p.run_id=j.run_id AND array_position($1::text[],p.kind)<array_position($1::text[],j.kind) AND p.state NOT IN ('completed','skipped')) ORDER BY j.created_at,array_position($1::text[],j.kind) FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE hackutd_finance.pipeline_job j SET state='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '10 minutes',updated_at=now() FROM ready WHERE j.id=ready.id RETURNING j.*`,
      [STAGES, token],
    )
  ).rows[0];
  if (!job) return false;
  try {
    await transaction(pool, async (tx) => {
      await tx.query(
        "SELECT id FROM hackutd_finance.owner WHERE id=$1 FOR UPDATE",
        [job.owner_id],
      );
      const held = (
        await tx.query(
          "SELECT * FROM hackutd_finance.pipeline_job WHERE owner_id=$1 AND id=$2 AND lease_token=$3 AND state='running' FOR UPDATE",
          [job.owner_id, job.id, token],
        )
      ).rows[0];
      if (!held) return;
      tx.isPipelineTransaction = true;
      try {
        const outcome = await handlers[job.kind](tx, job);
        await tx.query(
          `UPDATE hackutd_finance.pipeline_job SET state=$4,input_hash=$5,summary=$6,output_version=$7,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE owner_id=$1 AND id=$2 AND lease_token=$3`,
          [
            job.owner_id,
            job.id,
            token,
            outcome.skipped ? "skipped" : "completed",
            outcome.inputHash || null,
            outcome.summary || "",
            outcome.version || null,
          ],
        );
      } finally {
        delete tx.isPipelineTransaction;
      }
    });
  } catch (error) {
    const code = /^[a-z0-9_]{1,80}$/i.test(error.code || "")
      ? error.code
      : "stage_failed";
    await transaction(pool, async (tx) => {
      await tx.query(
        `UPDATE hackutd_finance.pipeline_job SET state=CASE WHEN attempts>=max_attempts THEN 'dead' ELSE 'failed' END,last_error=$4,lease_token=NULL,lease_until=NULL,available_at=now()+make_interval(secs=>LEAST(3600,power(2,attempts)::int)),updated_at=now() WHERE owner_id=$1 AND id=$2 AND lease_token=$3`,
        [job.owner_id, job.id, token, code],
      );
      await tx.query(
        `UPDATE hackutd_finance.pipeline_job SET state='dead',last_error='dependency_failed',updated_at=now() WHERE owner_id=$1 AND run_id=$2 AND state IN ('queued','failed') AND array_position($3::text[],kind)>array_position($3::text[],$4) AND EXISTS(SELECT 1 FROM hackutd_finance.pipeline_job WHERE id=$5 AND state='dead')`,
        [job.owner_id, job.run_id, STAGES, job.kind, job.id],
      );
    });
  }
  return true;
}
async function runStatus(db, ownerId, runId) {
  return (
    await db.query(
      "SELECT kind,state,summary,last_error,attempts,updated_at FROM hackutd_finance.pipeline_job WHERE owner_id=$1 AND run_id=$2 ORDER BY array_position($3::text[],kind)",
      [ownerId, runId, STAGES],
    )
  ).rows;
}
function startPipeline(pool, handlers, schedule) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await schedule?.();
      for (let n = 0; n < 20 && (await runOne(pool, handlers)); n++);
    } catch {
      console.error("Pipeline worker unavailable.");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
module.exports = { STAGES, queueRun, runOne, runStatus, startPipeline };
