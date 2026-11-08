const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  database,
  owner,
  nessieFixture,
} = require("./helpers/pipeline-fixtures");
const { STAGES, queueRun, runOne, runStatus } = require("../backend/pipeline");
const { createStages } = require("../backend/pipeline-stages");
test("durable pipeline completes in order and replays without ledger or derived writes", async () => {
  const db = await database();
  try {
    let tick=Date.parse("2026-11-08T12:00Z");
    const a = await owner(db), now=()=>new Date(tick);
    const deals = {
      provision: async () => {},
      catalog: async () =>
        [
          "chipotle",
          "panera",
          "starbucks",
          "chick_fil_a",
          "taco_bell",
          "jcpenney",
          "macys",
        ].map((merchant_id) => ({
          id: merchant_id,
          merchant_id,
          kind: "store_loyalty",
        })),
      status: async () => ({ consented: false }),
    };
    const handlers = createStages({
      nessie: nessieFixture(),
      env: { PERSONA_HISTORY_ENABLED: "1" },
      deals,
      now,
    });
    const first = await queueRun(db, a.id);
    for (let i = 0; i < 7; i++) assert.equal(await runOne(db, handlers), true);
    let status = await runStatus(db, a.id, first);
    assert.deepEqual(
      status.map((s) => s.kind),
      STAGES,
    );
    assert.ok(
      status.every((s) => ["completed", "skipped"].includes(s.state)),
      JSON.stringify(status),
    );
    const before = (
      await db.query("SELECT count(*)::int AS n FROM hackutd_finance.budget")
    ).rows[0].n;
    tick+=60000;
    const second = await queueRun(db, a.id);
    for (let i = 0; i < 7; i++) await runOne(db, handlers);
    status = await runStatus(db, a.id, second);
    assert.ok(
      status.every(
        (s) => s.state === "skipped" || s.kind === "store_selection",
      ),
      JSON.stringify(status),
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM hackutd_finance.budget"))
        .rows[0].n,
      before,
    );

    // Synthetic acceptance tests the gate, not measured forecast accuracy.
    await db.query("INSERT INTO hackutd_finance.provider_cursor(owner_id,source,cursor) VALUES($1,'forecast_evaluation',$2)",[a.id,{accepted:true,method:'weekly_block_bootstrap_v1'}]);
    const {loadOwnerData}=require('../backend/pipeline-data');
    assert.equal((await loadOwnerData(db,a.id,now())).forecast.method,'weekly_block_bootstrap_v1');
    await db.query("UPDATE hackutd_finance.ledger_transaction SET amount_cents=amount_cents+1 WHERE owner_id=$1 AND id=(SELECT id FROM hackutd_finance.ledger_transaction WHERE owner_id=$1 LIMIT 1)",[a.id]);
    assert.equal((await loadOwnerData(db,a.id,now())).forecast.method,'finance_forecast_comparison');
  } finally {
    await db.end();
  }
});
test("failed stage retries to dead and dependent stages report failure", async () => {
  const db = await database();
  try {
    const a = await owner(db),
      run = await queueRun(db, a.id);
    await db.query(
      "UPDATE hackutd_finance.pipeline_job SET max_attempts=2 WHERE run_id=$1",
      [run],
    );
    const handlers = {
      bank_pull: async () => {
        throw Object.assign(new Error("private detail"), {
          code: "source_down",
        });
      },
    };
    await runOne(db, handlers);
    await db.query(
      "UPDATE hackutd_finance.pipeline_job SET available_at=now()-interval '1 second' WHERE run_id=$1",
      [run],
    );
    await runOne(db, handlers);
    const status = await runStatus(db, a.id, run);
    assert.ok(status.every((s) => s.state === "dead"));
    assert.equal(status[0].last_error, "source_down");
    assert.equal(status[1].last_error, "dependency_failed");
  } finally {
    await db.end();
  }
});
