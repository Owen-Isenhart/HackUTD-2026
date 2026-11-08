const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");
const {
  database,
  owner,
  nessieFixture,
} = require("./helpers/pipeline-fixtures");
const { issueSession } = require("../backend/owners");
const { queueRun } = require("../backend/pipeline");
const { createPipelineHttp } = require("../backend/pipeline-http");
test("HTTP session scopes runs, routines, budgets and ledger to one owner; stale edits conflict", async () => {
  const pool = await database();
  let server;
  try {
    const a = await owner(pool),
      b = await owner(pool, { customerId: "cust_other" }),
      session = await issueSession(pool, a.id),
      runB = await queueRun(pool, b.id);
    const h = createPipelineHttp({ pool, nessie: nessieFixture(), env: {} });
    server = createServer(async (req, res) => {
      if (!(await h(req, res))) {
        res.writeHead(404);
        res.end();
      }
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const call = (path, method = "GET", body, token = session.token) =>
      fetch("http://127.0.0.1:" + server.address().port + path, {
        method,
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    assert.equal((await call("/api/v1/pipeline/runs/" + runB)).status, 404);
    assert.equal(
      (await call("/api/v1/budgets", "GET", null, "wrong")).status,
      401,
    );
    const first = await call("/api/v1/budgets/all", "PUT", {
      version: 0,
      limitCents: 5000,
      period: "month",
    });
    assert.equal(first.status, 200);
    assert.equal(
      (
        await call("/api/v1/budgets/all", "PUT", {
          version: 0,
          limitCents: 5,
          period: "month",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM hackutd_finance.budget WHERE owner_id=$1",
          [b.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal((await call("/api/v1/finance/forecast/" + b.id)).status, 404);
    assert.deepEqual(
      (await (await call("/api/finance-transactions")).json()).transactions,
      [],
    );
    assert.deepEqual(
      (await (await call("/api/v1/routines")).json()).routines,
      [],
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
  }
});
