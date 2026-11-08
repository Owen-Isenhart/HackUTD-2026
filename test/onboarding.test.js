const { test } = require("node:test");
const assert = require("node:assert/strict");
const { database, nessieFixture } = require("./helpers/pipeline-fixtures");
const {
  onboard,
  identifyCustomer,
  createIdentifyLimiter,
} = require("../backend/onboarding");
const { queueRun } = require("../backend/pipeline");
test("exact sandbox identification normalizes Unicode, resumes one owner and keeps full numbers out", async () => {
  const pool = await database();
  try {
    const args = {
      pool,
      nessie: nessieFixture(),
      env: {},
      queueRun,
      input: { firstName: " Ａｌｅｘ ", lastName: "TAYLOR", last4: "6619" },
    };
    const a = await onboard(args),
      b = await onboard({ ...args, input: { fullName: " Alex  Taylor ", last4: "6619" } });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.ownerId, b.ownerId);
    assert.notEqual(a.session.token, b.session.token);
    assert.equal(JSON.stringify(a).includes("012345676619"), false);
    const rows = (
      await pool.query("SELECT * FROM hackutd_finance.owner_account")
    ).rows;
    assert.ok(rows.every((r) => r.last4.length === 4 && !r.account_number));
  } finally {
    await pool.end();
  }
});
test("wrong name and digits have same failure and ambiguous records never select", async () => {
  const n = nessieFixture();
  for (const input of [
    { firstName: "Wrong", lastName: "Taylor", last4: "6619" },
    { firstName: "Alex", lastName: "Taylor", last4: "0000" },
  ])
    await assert.rejects(identifyCustomer(n, input), {
      code: "no_sandbox_match",
      status: 404,
    });
  n.listCustomers = async () => [
    { id: "cust_a", first_name: "Alex", last_name: "Taylor" },
    { id: "cust_b", first_name: "Alex", last_name: "Taylor" },
  ];
  const accounts = await n.customerAccounts();
  n.customerAccounts = async (id) => accounts.map((account) => ({ ...account, customer_id: id }));
  await assert.rejects(
    identifyCustomer(n, {
      firstName: "Alex",
      lastName: "Taylor",
      last4: "6619",
    }),
    { code: "ambiguous_sandbox_match" },
  );
});
test("sixth identification attempt is limited by address or normalized name", () => {
  const rate = createIdentifyLimiter();
  for (let i = 0; i < 5; i++)
    rate("a", { firstName: "Alex", lastName: "Taylor" }, 1000);
  assert.throws(
    () => rate("b", { fullName: "alex taylor" }, 1000),
    { status: 429 },
  );
});
