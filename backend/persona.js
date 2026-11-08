const persona = require("../data/persona/alex-taylor.v1.json");
const { upsertLedger } = require("./ledger");
const { transaction } = require("./pipeline-utils");
async function loadPersona(pool, owner, env = process.env) {
  if (
    env.PERSONA_HISTORY_ENABLED !== "1" ||
    owner.nessie_customer_id !== persona.nessieCustomerId ||
    !owner.persona_enabled
  )
    return { skipped: true, count: 0 };
  return transaction(pool, async (tx) => {
    const merchants = (
      await tx.query(
        "SELECT id,brand_key FROM hackutd_finance.merchant WHERE provenance='nessie_sandbox' ORDER BY id",
      )
    ).rows;
    const ids = new Map(merchants.map((m) => [m.brand_key, m.id]));
    const previous = (
      await tx.query(
        "SELECT cursor FROM hackutd_finance.provider_cursor WHERE owner_id=$1 AND source='persona'",
        [owner.id],
      )
    ).rows[0]?.cursor;
    if (previous && previous.version !== persona.generatorVersion)
      await tx.query(
        "DELETE FROM hackutd_finance.ledger_transaction WHERE owner_id=$1 AND provenance='synthetic_persona'",
        [owner.id],
      );
    const rows = persona.records.map((r) => ({
      id: r.id,
      provenance: "synthetic_persona",
      account_id: null,
      kind: "purchase",
      status: "completed",
      direction: "outflow",
      amount_cents: r.amountCents,
      occurred_at: r.occurredAt,
      merchant_id: ids.get(r.brand) || null,
      brand_key: r.brand,
      category: r.category,
      descriptor: "Generated demo purchase",
      parent_id: null,
      reversed_cents: 0,
      screen_flags: [],
    }));
    const changed = await upsertLedger(tx, owner.id, rows);
    await tx.query(
      `INSERT INTO hackutd_finance.provider_cursor(owner_id,source,cursor) VALUES($1,'persona',$2) ON CONFLICT(owner_id,source) DO UPDATE SET cursor=$2 WHERE provider_cursor.cursor IS DISTINCT FROM $2`,
      [owner.id, { version: persona.generatorVersion }],
    );
    return {
      count: rows.length,
      changed,
      missingBranches: [
        ...new Set(rows.filter((r) => !r.merchant_id).map((r) => r.brand_key)),
      ],
    };
  });
}
module.exports = { loadPersona };
