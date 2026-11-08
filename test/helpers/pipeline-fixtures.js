const { PGlite } = require("@electric-sql/pglite");
const { migrateTiger } = require("../../backend/tiger-memory");
const { randomUUID } = require("node:crypto");
const customer = "cust_01m6x5w635z27trg3dfbhjxjvx",
  checking = "acct_00000000000000000000000001",
  card = "acct_00000000000000000000000002";
async function database() {
  const db = new PGlite();
  const pool = {
    query: async (sql, params) => {
      const results = params?.length
        ? await db.query(sql, params)
        : (await db.exec(sql)).at(-1);
      return {
        ...results,
        rowCount: results?.affectedRows ?? results?.rows?.length ?? 0,
      };
    },
    connect: async () => ({ ...pool, release() {} }),
    end: () => db.close(),
  };
  await migrateTiger(pool);
  return pool;
}
const nessieFixture = () => ({
  listCustomers: async () => [
    { id: customer, first_name: "Alex", last_name: "Taylor" },
  ],
  customerAccounts: async () => [
    {
      id: checking,
      customer_id: customer,
      type: "Checking",
      account_number: "012345672583",
      nickname: "Checking",
    },
    {
      id: card,
      customer_id: customer,
      type: "Credit Card",
      account_number: "012345676619",
      nickname: "Capital One SavorOne Rewards",
    },
  ],
  account: async (id) => ({
    id,
    customer_id: customer,
    available_cents: id === checking ? 15000000 : 900000,
  }),
  accountTransactions: async () => [],
  bills: async () => [],
  loans: async () => [],
  merchants: async () => [
    {
      id: "merch_00000000000000000000000001",
      name: "Chipotle Mexican Grill",
      category: "restaurant",
      geocode: { lat: 32.98, lng: -96.75 },
    },
  ],
  rows: (p) => p.items || [],
  events: async () => ({ items: [], next_cursor: 0 }),
});
async function owner(pool, { id = randomUUID(), customerId = customer } = {}) {
  await pool.query(
    "INSERT INTO hackutd_finance.owner(id,nessie_customer_id,card_account_id,first_name,time_zone,is_synthetic_person,persona_enabled) VALUES($1,$2,$3,'Alex','America/Chicago',true,true)",
    [id, customerId, card],
  );
  await pool.query(
    "INSERT INTO hackutd_finance.owner_account(owner_id,account_id,account_type,last4) VALUES($1,$2,'Checking','2583'),($1,$3,'Credit Card','6619')",
    [id, checking, card],
  );
  return (
    await pool.query("SELECT * FROM hackutd_finance.owner WHERE id=$1", [id])
  ).rows[0];
}
const personaLedger = () =>
  require("../../data/persona/alex-taylor.v1.json").records.map((r) => ({
    id: r.id,
    kind: "purchase",
    status: "completed",
    direction: "outflow",
    amount_cents: r.amountCents,
    occurred_at: r.occurredAt,
    merchant_id: null,
    brand_key: r.brand,
    category: r.category,
    reversed_cents: 0,
    screen_flags: [],
    provenance: "synthetic_persona",
  }));
module.exports = {
  database,
  owner,
  nessieFixture,
  personaLedger,
  customer,
  checking,
  card,
};
