const { transaction, localParts } = require("./pipeline-utils");
const { queueRun } = require("./pipeline");
function createPipelineScheduler(
  pool,
  nessie,
  { now = () => new Date() } = {},
) {
  let last = 0;
  return async () => {
    if (+now() - last < 30000) return;
    last = +now();
    const owners = (await pool.query("SELECT * FROM hackutd_finance.owner"))
      .rows;
    for (const owner of owners) {
      try {
        await transaction(pool, async (tx) => {
          await tx.query(
            "SELECT id FROM hackutd_finance.owner WHERE id=$1 FOR UPDATE",
            [owner.id],
          );
          const pending = (
            await tx.query(
              "SELECT id FROM hackutd_finance.pipeline_job WHERE owner_id=$1 AND state IN ('queued','running','failed') LIMIT 1",
              [owner.id],
            )
          ).rows[0];
          if (pending) return;
          const source = "scheduler";
          const previous = (
            await tx.query(
              "SELECT cursor FROM hackutd_finance.provider_cursor WHERE owner_id=$1 AND source=$2",
              [owner.id, source],
            )
          ).rows[0]?.cursor;
          let changed =
            !previous ||
            +now() - Date.parse(previous.fullReadAt) >= 21600000 ||
            previous.month !== localParts(now(), owner.time_zone).month;
          const accounts = (
            await tx.query(
              "SELECT account_id FROM hackutd_finance.owner_account WHERE owner_id=$1",
              [owner.id],
            )
          ).rows;
          for (const a of accounts) {
            const key = "nessie_events:" + a.account_id;
            let cursor =
              (
                await tx.query(
                  "SELECT cursor FROM hackutd_finance.provider_cursor WHERE owner_id=$1 AND source=$2",
                  [owner.id, key],
                )
              ).rows[0]?.cursor?.after || 0;
            const page = await nessie.events({
              after: cursor,
              accountId: a.account_id,
              limit: 500,
            });
            if (nessie.rows(page).length) {
              changed = true;
              cursor = page.next_cursor ?? cursor;
              await tx.query(
                "INSERT INTO hackutd_finance.provider_cursor(owner_id,source,cursor) VALUES($1,$2,$3) ON CONFLICT(owner_id,source) DO UPDATE SET cursor=$3,updated_at=now()",
                [owner.id, key, { after: cursor }],
              );
            }
          }
          if (changed) {
            await queueRun(tx, owner.id);
            await tx.query(
              "INSERT INTO hackutd_finance.provider_cursor(owner_id,source,cursor) VALUES($1,$2,$3) ON CONFLICT(owner_id,source) DO UPDATE SET cursor=$3,updated_at=now()",
              [
                owner.id,
                source,
                {
                  month: localParts(now(), owner.time_zone).month,
                  fullReadAt: now().toISOString(),
                },
              ],
            );
          }
        });
      } catch {
        console.error("Nessie event poll unavailable.");
      }
    }
  };
}
module.exports = { createPipelineScheduler };
