const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createNessieV2 } = require("../backend/nessie-v2");
test("v2 pages with header-only auth, no redirects, and validates path IDs before fetch", async () => {
  const seen = [];
  const n = createNessieV2({
    apiKey: "secret",
    fetchImpl: async (url, options) => {
      seen.push({ url: String(url), options });
      return Response.json(
        seen.length === 1
          ? { items: [1], next_cursor: "next" }
          : { items: [2] },
      );
    },
  });
  assert.deepEqual(await n.listCustomers(), [1, 2]);
  assert.ok(
    seen.every(
      (r) =>
        !r.url.includes("secret") &&
        r.options.headers.Authorization === "Bearer secret" &&
        r.options.redirect === "error",
    ),
  );
  assert.ok(seen[1].url.includes("cursor=next"));
  assert.throws(() => n.account("../bad"), { code: "invalid_nessie_id" });
  assert.equal(seen.length, 2);
});
test("v2 bounded rate retries and problem errors are stable sanitized codes", async () => {
  let count = 0,
    delays = [];
  const n = createNessieV2({
    apiKey: "key",
    waitImpl: async (n) => delays.push(n),
    fetchImpl: async () => {
      count++;
      return new Response("", { status: 429, headers: { "retry-after": "1" } });
    },
  });
  await assert.rejects(n.listCustomers(), { code: "nessie_rate_limited" });
  assert.equal(count, 3);
  assert.deepEqual(delays, [1500, 1500]);
  const p = createNessieV2({
    apiKey: "key",
    fetchImpl: async () =>
      Response.json({ type: "not_found", detail: "private" }, { status: 404 }),
  });
  await assert.rejects(p.listCustomers(), { code: "not_found" });
});
