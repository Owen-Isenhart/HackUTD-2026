const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createTigerPool, migrateTiger } = require("../backend/tiger-memory");
const { owner } = require("./helpers/pipeline-fixtures");
const { queueRun, runOne, runStatus, STAGES } = require("../backend/pipeline");
test(
  "network PostgreSQL workers never execute the same leased stage concurrently",
  { skip: process.env.TEST_TIGER_PIPELINE !== "1", timeout: 30000 },
  async () => {
    const base = createTigerPool();
    const schema = "pipeline_test_" + randomUUID().replaceAll("-", "");
    const rewrite = (sql) => sql.replaceAll("hackutd_finance", schema);
    const pool = {
      query: (sql, p) => base.query(rewrite(sql), p),
      connect: async () => {
        const c = await base.connect();
        return {
          query: (sql, p) => c.query(rewrite(sql), p),
          release: () => c.release(),
        };
      },
    };
    try {
      await migrateTiger(pool);
      await migrateTiger(pool);
      const a = await owner(pool),
        run = await queueRun(pool, a.id);
      const active = new Set(),
        seen = [];
      const handlers = Object.fromEntries(
        STAGES.map((kind) => [
          kind,
          async () => {
            assert.equal(active.has(kind), false);
            active.add(kind);
            await new Promise((r) => setTimeout(r, 25));
            seen.push(kind);
            active.delete(kind);
            return { inputHash: kind, summary: "fixture" };
          },
        ]),
      );
      await Promise.all(
        [0, 1].map(async () => {
          for (let i = 0; i < 20; i++) {
            if (!(await runOne(pool, handlers)))
              await new Promise((r) => setTimeout(r, 30));
          }
        }),
      );
      assert.deepEqual(seen, STAGES);
      assert.ok(
        (await runStatus(pool, a.id, run)).every(
          (s) => s.state === "completed",
        ),
      );
    } finally {
      await base.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
      await base.end();
    }
  },
);
