const { randomUUID } = require("node:crypto");
const { hash, localParts } = require("./pipeline-utils");
const { importFromNessie, readLedger } = require("./ledger");
const { loadPersona } = require("./persona");
const { forecastBands } = require("./forecast-bands");
const { detectRoutines, visitsFromLedger } = require("./routines-v2");
const { deriveBudgets, shouldDerive } = require("./budget-derive");
const { selectStores } = require("./store-selection");
async function latest(db, table, ownerId) {
  if (!["forecast_snapshot", "budget"].includes(table))
    throw new Error("invalid_pipeline_table");
  return (
    await db.query(
      "SELECT * FROM hackutd_finance." +
        table +
        " WHERE owner_id=$1 ORDER BY version DESC",
      [ownerId],
    )
  ).rows;
}
async function saveRoutine(tx, ownerId, r) {
  const id = randomUUID();
  await tx.query(
    `INSERT INTO hackutd_finance.routine_fact(id,owner_id,version,kind,purpose,brand_key,branch_merchant_id,weekdays,window_start_minute,window_end_minute,typical_low_cents,typical_mid_cents,typical_high_cents,confidence,support,evidence,provenance) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id,
      ownerId,
      r.kind,
      r.purpose,
      r.brand_key,
      r.branch_merchant_id,
      r.weekdays,
      r.window_start_minute,
      r.window_end_minute,
      r.typical_low_cents,
      r.typical_mid_cents,
      r.typical_high_cents,
      r.confidence,
      r.support,
      r.evidence,
      r.provenance,
    ],
  );
  return id;
}
async function writeBudget(tx, ownerId, b, previous) {
  if (previous)
    await tx.query(
      "UPDATE hackutd_finance.budget SET superseded_at=now() WHERE owner_id=$1 AND category=$2 AND version=$3",
      [ownerId, b.category, previous.version],
    );
  const version = Number(previous?.version || 0) + 1;
  await tx.query(
    "INSERT INTO hackutd_finance.budget(owner_id,category,version,period,limit_cents,source,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      ownerId,
      b.category,
      version,
      b.period,
      b.limit_cents,
      b.source,
      b.evidence,
    ],
  );
  return version;
}
function createStages({
  nessie,
  env = process.env,
  deals,
  now = () => new Date(),
  obligations = async () => ({}),
}) {
  async function context(tx, job) {
    const owner = (
      await tx.query("SELECT * FROM hackutd_finance.owner WHERE id=$1", [
        job.owner_id,
      ])
    ).rows[0];
    const ledger = await readLedger(tx, owner.id);
    const bank =
      (
        await tx.query(
          "SELECT cursor FROM hackutd_finance.provider_cursor WHERE owner_id=$1 AND source='bank_snapshot'",
          [owner.id],
        )
      ).rows[0]?.cursor || {};
    return { owner, ledger, bank };
  }
  async function unchanged(tx, job, inputHash) {
    return Boolean(
      (
        await tx.query(
          `SELECT id FROM hackutd_finance.pipeline_job WHERE owner_id=$1 AND kind=$2 AND input_hash=$3 AND state IN ('completed','skipped') AND id<>$4 LIMIT 1`,
          [job.owner_id, job.kind, inputHash, job.id],
        )
      ).rows[0],
    );
  }
  return {
    bank_pull: async (tx, j) => {
      const bank = await importFromNessie(tx, j.owner_id, nessie, now());
      return {
        inputHash: bank.inputHash,
        skipped: await unchanged(tx, j, bank.inputHash),
        summary:
          "Sandbox bank import: " +
          bank.coverage.reduce((s, c) => s + c.rows, 0) +
          " rows read",
      };
    },
    persona_load: async (tx, j) => {
      const { owner } = await context(tx, j);
      const r = await loadPersona(tx, owner, env);
      return {
        inputHash: hash(r.count),
        skipped: r.skipped || !r.changed,
        summary: r.skipped
          ? "Synthetic demo history disabled"
          : r.count +
            " synthetic demo purchases; " +
            r.missingBranches.length +
            " brands awaiting branch setup",
      };
    },
    forecast: async (tx, j) => {
      const { owner, ledger, bank } = await context(tx, j),
        plans = await obligations(owner.id);
      const inputHash = hash([
        ledger,
        bank.inputHash,
        plans,
        Math.floor(+now() / 1800000),
      ]);
      if (await unchanged(tx, j, inputHash))
        return { inputHash, skipped: true };
      const forecast = forecastBands({
        ownerId: owner.id,
        ledger,
        bank,
        asOf: now().toISOString(),
        timeZone: owner.time_zone,
        ...plans,
      });
      const version =
        Number(
          (await latest(tx, "forecast_snapshot", owner.id))[0]?.version || 0,
        ) + 1;
      const { daily, ...summary } = forecast;
      await tx.query(
        "INSERT INTO hackutd_finance.forecast_snapshot(owner_id,version,input_hash,method,as_of,valid_until,horizon_days,summary,daily) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          owner.id,
          version,
          inputHash,
          forecast.method,
          forecast.asOf,
          forecast.validUntil,
          forecast.horizonDays,
          summary,
          JSON.stringify(daily),
        ],
      );
      return {
        inputHash,
        version,
        summary:
          forecast.safeToSpendCents === null
            ? "Forecast incomplete: " + forecast.missingSources.join(", ")
            : "Forecast bands ready; evaluation required before recommendation use",
      };
    },
    routines: async (tx, j) => {
      const { owner, ledger } = await context(tx, j);
      const inputHash = hash([ledger, localParts(now(), owner.time_zone).date]);
      if (await unchanged(tx, j, inputHash))
        return { inputHash, skipped: true };
      const found = detectRoutines(
        visitsFromLedger(ledger, now(), owner.time_zone),
        now(),
      );
      const old = (
        await tx.query(
          "SELECT * FROM hackutd_finance.routine_fact WHERE owner_id=$1 AND valid_to IS NULL",
          [owner.id],
        )
      ).rows;
      for (const r of found) {
        const stated = old.find(
          (o) =>
            o.kind === "stated" &&
            o.brand_key === r.brand_key &&
            o.weekdays.some((d) => r.weekdays.includes(d)) &&
            o.window_start_minute <= r.window_end_minute &&
            o.window_end_minute >= r.window_start_minute,
        );
        const existing = old.find(
          (o) =>
            o.kind === "inferred" &&
            o.brand_key === r.brand_key &&
            hash(o.weekdays) === hash(r.weekdays),
        );
        if (stated) {
          if (existing)
            await tx.query(
              "UPDATE hackutd_finance.routine_fact SET superseded_by=$3 WHERE owner_id=$1 AND id=$2",
              [owner.id, existing.id, stated.id],
            );
          continue;
        }
        if (existing) {
          await tx.query(
            "UPDATE hackutd_finance.routine_fact SET window_start_minute=$3,window_end_minute=$4,support=$5,evidence=$6,typical_mid_cents=$7,confidence=$8,version=version+1 WHERE owner_id=$1 AND id=$2",
            [
              owner.id,
              existing.id,
              r.window_start_minute,
              r.window_end_minute,
              r.support,
              r.evidence,
              r.typical_mid_cents,
              r.confidence,
            ],
          );
        } else await saveRoutine(tx, owner.id, r);
      }
      for (const r of old.filter(
        (o) =>
          o.kind === "inferred" &&
          !found.some(
            (f) =>
              f.brand_key === o.brand_key &&
              hash(f.weekdays) === hash(o.weekdays),
          ),
      )) {
        const support = {
          ...r.support,
          failedRuns: (r.support.failedRuns || 0) + 1,
          firstFailedAt: r.support.firstFailedAt || now().toISOString(),
        };
        await tx.query(
          "UPDATE hackutd_finance.routine_fact SET support=$3,valid_to=CASE WHEN $4 THEN now() ELSE valid_to END WHERE owner_id=$1 AND id=$2",
          [
            owner.id,
            r.id,
            support,
            support.failedRuns >= 4 &&
              +now() - Date.parse(support.firstFailedAt) >= 28 * 86400000,
          ],
        );
      }
      return {
        inputHash,
        summary: found.length + " inferred routines; source labels retained",
      };
    },
    budget: async (tx, j) => {
      const { owner, ledger, bank } = await context(tx, j);
      const plans = await obligations(owner.id);
      const derived = deriveBudgets(ledger, {}, plans.obligations || [], {
        now: now(),
        timeZone: owner.time_zone,
        bank,
      });
      const current = (await latest(tx, "budget", owner.id)).filter(
        (b) => !b.superseded_at,
      );
      const legacy = (
        await tx.query(
          "SELECT budget FROM hackutd_finance.confirmed_memory WHERE owner_id=$1",
          [owner.id],
        )
      ).rows[0]?.budget;
      if (legacy && !current.some((b) => b.category === "all")) {
        await writeBudget(
          tx,
          owner.id,
          {
            category: "all",
            period: legacy.period,
            limit_cents: legacy.limitCents,
            source: "user",
            evidence: { migration: "confirmed_memory" },
          },
          null,
        );
        current.push({ category: "all", source: "user" });
      }
      let count = 0;
      for (const b of derived) {
        const prior = current.find((c) => c.category === b.category);
        if (shouldDerive(prior, b, now(), owner.time_zone)) {
          await writeBudget(tx, owner.id, b, prior);
          count++;
        }
      }
      return {
        inputHash: hash(derived),
        skipped: count === 0,
        summary:
          derived.length + " enforced monthly budgets; " + count + " updated",
      };
    },
    store_selection: async (tx, j) => {
      const { owner, ledger } = await context(tx, j);
      if (!deals)
        throw Object.assign(new Error(), { code: "deals_not_configured" });
      await deals.provision(owner);
      const programs = await deals.catalog(owner.id);
      const routines = (
        await tx.query(
          "SELECT * FROM hackutd_finance.routine_fact WHERE owner_id=$1 AND valid_to IS NULL AND superseded_by IS NULL",
          [owner.id],
        )
      ).rows;
      const merchants = (
        await tx.query("SELECT * FROM hackutd_finance.merchant")
      ).rows;
      const previous = (
        await tx.query(
          "SELECT DISTINCT ON(brand_key) * FROM hackutd_finance.store_selection WHERE owner_id=$1 ORDER BY brand_key,version DESC",
          [owner.id],
        )
      ).rows;
      const selected = selectStores({
        ledger,
        routines,
        programs,
        previous,
        merchants,
        now: now(),
        timeZone: owner.time_zone,
      });
      for (const s of selected) {
        const old = previous.find((p) => p.brand_key === s.brand_key);
        if (
          old &&
          hash([
            old.selected,
            old.decided_by,
            old.reasons,
            old.stats,
            old.branches,
          ]) ===
            hash([s.selected, s.decided_by, s.reasons, s.stats, s.branches])
        )
          continue;
        await tx.query(
          "INSERT INTO hackutd_finance.store_selection(owner_id,brand_key,version,selected,decided_by,reasons,stats,branches) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            owner.id,
            s.brand_key,
            Number(old?.version || 0) + 1,
            s.selected,
            s.decided_by,
            s.reasons,
            s.stats,
            JSON.stringify(s.branches),
          ],
        );
      }
      const inputHash = hash(selected);
      return {
        inputHash,
        skipped: await unchanged(tx, j, inputHash),
        summary: selected.filter((s) => s.selected).length + " stores selected",
      };
    },
    enrollment_sync: async (tx, j) => {
      const { owner, ledger } = await context(tx, j);
      if (!deals)
        throw Object.assign(new Error(), { code: "deals_not_configured" });
      await deals.provision(owner);
      const selected = (
        await tx.query(
          "SELECT DISTINCT ON(brand_key) * FROM hackutd_finance.store_selection WHERE owner_id=$1 ORDER BY brand_key,version DESC",
          [owner.id],
        )
      ).rows.filter((s) => s.selected);
      const status = await deals.status(owner.id);
      if (!status.consented)
        return {
          skipped: true,
          inputHash: hash([selected.map((s) => s.brand_key), false]),
          summary: "Store rewards needs your email consent",
        };
      const inputHash = hash([
        selected.map((s) => s.brand_key).sort(),
        status.consented,
      ]);
      const cursor =
        (
          await tx.query(
            "SELECT cursor FROM hackutd_finance.provider_cursor WHERE owner_id=$1 AND source='deals_purchase_versions'",
            [owner.id],
          )
        ).rows[0]?.cursor || {};
      const changes = ledger.filter(
        (r) =>
          r.kind === "purchase" &&
          r.status === "completed" &&
          r.brand_key &&
          cursor[r.id] !== r.version,
      );
      for (let offset = 0; offset < changes.length; offset += 100) {
        const batch = changes.slice(offset, offset + 100);
        await deals.purchases(owner.id, batch);
        for (const row of batch) cursor[row.id] = row.version;
      }
      if (changes.length)
        await tx.query(
          "INSERT INTO hackutd_finance.provider_cursor(owner_id,source,cursor) VALUES($1,'deals_purchase_versions',$2) ON CONFLICT(owner_id,source) DO UPDATE SET cursor=$2,updated_at=now()",
          [owner.id, cursor],
        );
      if (await unchanged(tx, j, inputHash))
        return {
          skipped: true,
          inputHash,
          summary:
            "Store signups unchanged; " +
            changes.length +
            " purchase observations updated",
        };
      const programs = await deals.catalog(owner.id);
      let count = 0;
      for (const s of selected)
        for (const p of programs.filter(
          (p) =>
            p.merchant_id === s.brand_key &&
            p.kind === "store_loyalty" &&
            !p.paid_membership,
        )) {
          await deals.enroll(owner.id, p.id);
          count++;
        }
      return {
        inputHash,
        summary:
          count +
          (owner.is_synthetic_person
            ? " simulated signups queued (demo)"
            : " assisted signups queued"),
      };
    },
  };
}
module.exports = { createStages, saveRoutine, writeBudget, latest };
