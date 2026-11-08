const { readLedger } = require("./ledger");
const { latest } = require("./pipeline-stages");
const {hash}=require('./pipeline-utils');
const {
  profileFromLedger,
  comparisonForecast,
} = require("./profile-from-ledger");
async function loadOwnerData(db, ownerId, now = new Date(), plans = {}) {
  const owner = (
    await db.query("SELECT * FROM hackutd_finance.owner WHERE id=$1", [ownerId])
  ).rows[0];
  if (!owner) return null;
  const ledger = await readLedger(db, ownerId),
    bank = (
      await db.query(
        "SELECT cursor FROM hackutd_finance.provider_cursor WHERE owner_id=$1 AND source='bank_snapshot'",
        [ownerId],
      )
    ).rows[0]?.cursor;
  if (!bank) return { owner, ledger, bank: null };
  const budgets = (await latest(db, "budget", ownerId)).filter(
      (b) => !b.superseded_at,
    ),
    routines = (
      await db.query(
        "SELECT * FROM hackutd_finance.routine_fact WHERE owner_id=$1 AND valid_to IS NULL AND superseded_by IS NULL",
        [ownerId],
      )
    ).rows;
  const selections = (
    await db.query(
      "SELECT DISTINCT ON(brand_key) * FROM hackutd_finance.store_selection WHERE owner_id=$1 ORDER BY brand_key,version DESC",
      [ownerId],
    )
  ).rows;
  const bands = (await latest(db, "forecast_snapshot", ownerId))[0];
  const memory = (
    await db.query(
      "SELECT reserve_cents FROM hackutd_finance.confirmed_memory WHERE owner_id=$1",
      [ownerId],
    )
  ).rows[0];
  const context = {
    owner,
    ledger,
    bank,
    budgets,
    routines,
    selections,
    plans: { ...plans, reserveCents: Number(memory?.reserve_cents || 0) },
  };
  const evaluation = (
    await db.query(
      "SELECT cursor FROM hackutd_finance.provider_cursor WHERE owner_id=$1 AND source='forecast_evaluation'",
      [ownerId],
    )
  ).rows[0]?.cursor;
  const adopted =
    evaluation?.accepted === true && evaluation?.method === 'weekly_block_bootstrap_v1'
    && bands?.input_hash===hash([ledger,bank.inputHash,plans,Math.floor(Date.parse(bands.as_of)/1800000)]);
  const old = comparisonForecast(context, now);
  const forecast =
    adopted && bands
      ? {
          ...bands.summary,
          version: bands.version,
          daily: bands.daily,
          reserveCents: old.reserveCents,
        }
      : {
          method: "finance_forecast_comparison",
          asOf: bank.asOf,
          validUntil: new Date(Date.parse(bank.asOf) + 1800000).toISOString(),
          version: bank.inputHash,
          startingBalanceCents: old.startingBalanceCents,
          minimumBalanceLowCents: old.minimumProjectedBalanceCents,
          safeToSpendCents: old.safeSpendCents,
          reserveCents: old.reserveCents,
          adoption: "bootstrap_requires_backtest",
        };
  if (plans.pendingUnknownAmounts || plans.summary?.unverifiedPendingCount)
    forecast.safeToSpendCents = null;
  else if(adopted&&forecast.safeToSpendCents!==null)forecast.safeToSpendCents=Math.max(0,forecast.minimumBalanceLowCents-old.reserveCents);
  forecast.savingsBalanceCents=((bank.balances||[]).filter(a=>a.type==="Savings").every(a=>Number.isSafeInteger(a.available_cents))?(bank.balances||[]).filter(a=>a.type==="Savings").reduce((sum,a)=>sum+a.available_cents,0):null);
  return {
    ...context,
    forecast,
    bands: bands && { ...bands.summary, daily: bands.daily },
    profile: profileFromLedger(context),
    evaluation,
  };
}
module.exports = { loadOwnerData };
