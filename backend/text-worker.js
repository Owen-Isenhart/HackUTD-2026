// Background processing for Photon texts: pull new messages, interpret queued
// ones with Nemotron, and purge expired message bodies. Each step is bounded
// and failures are reported in the status instead of being retried forever.
const { interpretText } = require('./text-obligations');
const { syncTexts } = require('./photon-texts');

async function processTextJobs(store, { env = process.env, fetchImpl = fetch, interpret = interpretText, limit = 5 } = {}) {
  const timeZone = env.FINANCE_TIME_ZONE || 'America/Chicago';
  const summary = { claimed: 0, interpreted: 0, applied: 0, retried: 0 };
  for (const message of await store.claimJobs(limit)) {
    summary.claimed++;
    const context = await store.recentContext(message);
    let result;
    try {
      result = await interpret(message, context, { env, fetchImpl, timeZone });
    } catch {
      result = { status: 'unavailable', error: 'interpreter_failed' };
    }
    if (result.status !== 'interpreted') {
      await store.failJob(message, result.error ?? 'unavailable');
      summary.retried++;
      continue;
    }
    const { applied } = await store.completeJob(message, result.interpretation);
    summary.interpreted++;
    if (applied) summary.applied++;
  }
  return summary;
}

/** Runs sync, interpretation and retention once. Returns a redacted status for logs and the API. */
async function runTextCycle(store, cfg, options = {}) {
  const status = { at: new Date().toISOString() };
  if (cfg.apiKey) {
    try {
      status.sync = await syncTexts(store, cfg, options);
    } catch (error) {
      status.syncError = error.code ?? 'sync_failed';
    }
  } else {
    status.sync = 'skipped_no_api_key';
  }
  try {
    status.jobs = await processTextJobs(store, options);
  } catch (error) {
    status.jobsError = error.code ?? 'jobs_failed';
  }
  await store.purgeExpired().catch(() => { status.purgeError = 'purge_failed'; });
  return status;
}

module.exports = { processTextJobs, runTextCycle };
