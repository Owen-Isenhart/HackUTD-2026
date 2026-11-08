const {
  matchBrand,
  category,
  BRANDS,
  normalizeMerchantName,
} = require("./brands");
const { screenTransactions } = require("./anomaly-screen");
const { hash, fail, transaction } = require("./pipeline-utils");
function normalizeTransactions(
  raw,
  accountIds,
  merchants,
  now = new Date(),
  timeZone,
) {
  const owned = new Set(accountIds),
    m = new Map(merchants.map((x) => [x.id, x]));
  const unique = [
    ...new Map(
      raw
        .filter(
          (r) =>
            owned.has(r.payer_id) ||
            owned.has(r.payee_id) ||
            owned.has(r.account_id),
        )
        .map((r) => [r.id, r]),
    ).values(),
  ];
  const rows = unique.map((r) => {
    if (
      !Number.isSafeInteger(r.amount_cents) ||
      r.amount_cents < 0 ||
      !Number.isFinite(Date.parse(r.created_at)) ||
      !["completed", "pending", "declined", "cancelled"].includes(r.status)
    )
      throw fail("invalid_nessie_transaction", 503);
    const merchant = m.get(r.merchant_id),
      brand = merchant && matchBrand(merchant.name);
    let direction = [
      "deposit",
      "interest_credit",
      "refund",
      "chargeback",
    ].includes(r.kind)
      ? "inflow"
      : "outflow";
    if (r.kind === "transfer")
      direction =
        owned.has(r.payer_id) && owned.has(r.payee_id)
          ? "internal"
          : owned.has(r.payee_id)
            ? "inflow"
            : "outflow";
    return {
      id: r.id,
      provenance: "nessie_sandbox",
      account_id: owned.has(r.payer_id)
        ? r.payer_id
        : (r.payee_id ?? r.account_id),
      kind: r.kind,
      status: r.status,
      direction,
      amount_cents: r.amount_cents,
      occurred_at: r.created_at,
      merchant_id: r.merchant_id ?? null,
      brand_key: brand?.key ?? null,
      category: brand?.category ?? category(merchant?.category),
      descriptor: r.description ?? r.descriptor ?? null,
      parent_id: r.parent_transaction_id ?? null,
      bill_id: r.bill_id ?? null,
      reversed_cents: 0,
      payee_id: r.payee_id,
    };
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows)
    if (
      ["refund", "chargeback"].includes(r.kind) &&
      r.status === "completed" &&
      byId.has(r.parent_id)
    )
      byId.get(r.parent_id).reversed_cents += r.amount_cents;
  return screenTransactions(rows, merchants, now, timeZone).map(
    ({ payee_id, ...r }) => r,
  );
}
const fields = [
  "provenance",
  "account_id",
  "kind",
  "status",
  "direction",
  "amount_cents",
  "occurred_at",
  "merchant_id",
  "brand_key",
  "category",
  "descriptor",
  "parent_id",
  "bill_id",
  "reversed_cents",
  "screen_flags",
];
async function upsertLedger(tx, ownerId, rows) {
  let changed = 0;
  for (const r of rows) {
    const values = [
      ownerId,
      r.id,
      ...fields.map((k) => r[k] ?? null),
      hash(fields.map((k) => r[k] ?? null)),
    ];
    const placeholders = values.map((_, i) => "$" + (i + 1));
    const result = await tx.query(
      `INSERT INTO hackutd_finance.ledger_transaction AS t(owner_id,id,${fields.join(",")},content_hash) VALUES(${placeholders.join(",")}) ON CONFLICT(owner_id,id) DO UPDATE SET ${[...fields, "content_hash"].map((k) => k + "=EXCLUDED." + k).join(",")},version=t.version+1,imported_at=now() WHERE t.content_hash IS DISTINCT FROM EXCLUDED.content_hash`,
      values,
    );
    changed += result.rowCount;
  }
  return changed;
}
async function importFromNessie(pool, ownerId, nessie, now = new Date()) {
  const accounts = (
    await pool.query(
      "SELECT * FROM hackutd_finance.owner_account WHERE owner_id=$1",
      [ownerId],
    )
  ).rows;
  const owner = (
    await pool.query("SELECT * FROM hackutd_finance.owner WHERE id=$1", [
      ownerId,
    ])
  ).rows[0];
  if (!owner || !accounts.length) throw fail("owner_accounts_missing", 503);
  const ids = accounts.map((a) => a.account_id),
    raw = [],
    balances = [],
    bills = [],
    loans = [],
    coverage = [];
  for (const a of accounts) {
    const detail = await nessie.account(a.account_id);
    const rows = await nessie.accountTransactions(a.account_id);
    balances.push({
      id: a.account_id,
      type: a.account_type,
      available_cents: detail.available_cents,
    });
    raw.push(...rows);
    coverage.push({
      accountId: a.account_id,
      rows: rows.length,
      truncated: rows.length === 5000,
      fetchedAt: now.toISOString(),
    });
    bills.push(...(await nessie.bills(a.account_id)));
    loans.push(...(await nessie.loans(a.account_id)));
  }
  if (coverage.some((c) => c.truncated)) {
    let cursor;
    const seen = new Set();
    do {
      const page = await nessie.tenantTransactions({ cursor, limit: 5000 });
      raw.push(
        ...nessie
          .rows(page)
          .filter((r) => ids.includes(r.payer_id) || ids.includes(r.payee_id)),
      );
      cursor = page.next_cursor;
      if (cursor && seen.has(cursor)) throw fail("nessie_cursor_loop", 503);
      seen.add(cursor);
      if (seen.size > 1000) throw fail("nessie_page_cap", 503);
    } while (cursor);
    for (const c of coverage) c.recovered = true;
  }
  const merchants = (await nessie.merchants()).map((m) => ({
    ...m,
    lat: m.geocode?.lat ?? m.location?.lat ?? m.lat ?? null,
    lon: m.geocode?.lng ?? m.geocode?.lon ?? m.location?.lon ?? m.lon ?? null,
  }));
  const rows = normalizeTransactions(raw, ids, merchants, now, owner.time_zone);
  const result = {
    balances,
    bills: [...new Map(bills.map((b) => [b.id, b])).values()],
    loans: [...new Map(loans.map((l) => [l.id, l])).values()],
    coverage,
    asOf: now.toISOString(),
    unresolvedPurchases: rows.filter(
      (r) => r.kind === "purchase" && !r.brand_key,
    ).length,
  };
  result.inputHash = hash([rows, balances, result.bills, result.loans]);
  await transaction(pool, async (tx) => {
    await tx.query(
      "SELECT id FROM hackutd_finance.owner WHERE id=$1 FOR UPDATE",
      [ownerId],
    );
    for (const [key, name, cat, alias] of BRANDS) {
      await tx.query(
        "INSERT INTO hackutd_finance.brand(key,display_name,category) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [key, name, cat],
      );
      for (const n of [name, alias].filter(Boolean))
        await tx.query(
          "INSERT INTO hackutd_finance.brand_alias(normalized_name,brand_key) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [normalizeMerchantName(n), key],
        );
    }
    for (const m of merchants) {
      const b = matchBrand(m.name);
      await tx.query(
        `INSERT INTO hackutd_finance.merchant(id,name,category,lat,lon,brand_key,brand_match,provenance,fetched_at) VALUES($1,$2,$3,$4,$5,$6,$7,'nessie_sandbox',$8) ON CONFLICT(id) DO UPDATE SET name=$2,category=$3,lat=$4,lon=$5,brand_key=$6,brand_match=$7,fetched_at=$8`,
        [m.id, m.name, category(m.category), m.lat, m.lon, b.key, b.match, now],
      );
    }
    await upsertLedger(tx, ownerId, rows);
    await tx.query(
      `INSERT INTO hackutd_finance.provider_cursor(owner_id,source,cursor) VALUES($1,'bank_snapshot',$2) ON CONFLICT(owner_id,source) DO UPDATE SET cursor=$2,updated_at=now()`,
      [ownerId, result],
    );
  });
  return result;
}
async function readLedger(db, ownerId) {
  return (
    await db.query(
      "SELECT * FROM hackutd_finance.ledger_transaction WHERE owner_id=$1 ORDER BY occurred_at,id",
      [ownerId],
    )
  ).rows.map((r) => ({
    ...r,
    amount_cents: Number(r.amount_cents),
    reversed_cents: Number(r.reversed_cents),
    occurred_at: new Date(r.occurred_at).toISOString(),
  }));
}
module.exports = {
  normalizeTransactions,
  upsertLedger,
  importFromNessie,
  readLedger,
};
