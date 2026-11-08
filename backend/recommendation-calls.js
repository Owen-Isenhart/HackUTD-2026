const { randomUUID } = require('node:crypto');

const CALL_WINDOW_MS = 5 * 60_000;
const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const isCallId = (value) => typeof value === 'string' && new RegExp(`^${UUID}$`).test(value);
const inputVersions = (profile) => ({
  asOf: profile?.profileVersion == null ? profile?.asOf : null,
  profileVersion: profile?.profileVersion ?? null,
  memoryVersion: profile?.memoryVersion ?? null,
  obligationsVersion: profile?.socialObligations?.version ?? null,
});

function sameInputs(profile, inputs) {
  return profile && Object.entries(inputVersions(profile)).every(([field, value]) => value === inputs[field]);
}

function createCallContexts(pool, ownerId) {
  return {
    async save({ profile, recommendation, candidates, id = randomUUID(), settings, deviceId = null }) {
      await pool.query(`
        INSERT INTO hackutd_finance.recommendation_call
          (id, owner_id, inputs, opening_id, candidates, source, dispatch_before, automatic, settings_version, device_id, channel)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO NOTHING
      `, [id, ownerId, inputVersions(profile), recommendation.offer.id, JSON.stringify(candidates),
        recommendation.source, new Date(recommendation.expiresAt), Boolean(settings), settings?.version ?? null, deviceId, settings?.channel ?? 'call']);
      return id;
    },
    async load(id) {
      const { rows: [row] } = await pool.query(`
        SELECT id, inputs, opening_id AS "openingId", candidates, source, state, decision, channel, automatic,
               settings_version AS "settingsVersion", device_id AS "deviceId",
               dispatch_before AS "dispatchBefore", started_at AS "startedAt", ended_at AS "endedAt"
        FROM hackutd_finance.recommendation_call WHERE id = $1 AND owner_id = $2
      `, [id, ownerId]);
      return row;
    },
    async claim(id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), 72839902)', [ownerId]);
        const result = await client.query(`
          UPDATE hackutd_finance.recommendation_call AS proposed
          SET state = 'dialing', started_at = clock_timestamp()
          WHERE proposed.id = $1 AND proposed.owner_id = $2 AND proposed.state = 'ready'
            AND proposed.dispatch_before > clock_timestamp()
            AND (NOT proposed.automatic OR EXISTS (
              SELECT 1 FROM hackutd_finance.alert_settings AS settings
              JOIN hackutd_finance.location_device AS device ON device.owner_id = settings.owner_id
              WHERE settings.owner_id = proposed.owner_id AND settings.version = proposed.settings_version
                AND settings.channel = proposed.channel AND device.id = proposed.device_id AND device.expires_at > clock_timestamp()
            ))
            AND NOT EXISTS (
              SELECT 1 FROM hackutd_finance.recommendation_call AS recent
              WHERE recent.owner_id = $2 AND recent.state <> 'failed' AND recent.started_at IS NOT NULL
                AND (recent.started_at > clock_timestamp() - interval '10 minutes'
                  OR (proposed.automatic AND recent.opening_id = proposed.opening_id
                    AND recent.started_at > clock_timestamp() - interval '24 hours'))
            )
        `, [id, ownerId]);
        await client.query('COMMIT');
        return result.rowCount === 1;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async setDispatchState(id, state, providerId = null) {
      await pool.query(`
        UPDATE hackutd_finance.recommendation_call SET state = $3, provider_id = $4
        WHERE id = $1 AND owner_id = $2 AND state = 'dialing'
      `, [id, ownerId, state, providerId]);
    },
    async end(id, decision) {
      await pool.query(`
        UPDATE hackutd_finance.recommendation_call
        SET state = 'ended', ended_at = COALESCE(ended_at, clock_timestamp()), decision = COALESCE(decision, $3)
        WHERE id = $1 AND owner_id = $2 AND channel = 'call' AND started_at IS NOT NULL AND state <> 'failed'
      `, [id, ownerId, decision]);
    },
    async prune() {
      await pool.query(`
        UPDATE hackutd_finance.recommendation_call SET state = 'uncertain'
        WHERE owner_id = $1 AND state = 'dialing' AND started_at < now() - interval '70 seconds'
      `, [ownerId]);
      await pool.query(`
        DELETE FROM hackutd_finance.recommendation_call
        WHERE owner_id = $1 AND dispatch_before < now() - interval '2 days'
      `, [ownerId]);
    },
    async pending() {
      const { rows } = await pool.query(`
        SELECT id FROM hackutd_finance.recommendation_call
        WHERE owner_id = $1 AND automatic AND state = 'ready' AND dispatch_before > now()
        ORDER BY dispatch_before LIMIT 10
      `, [ownerId]);
      return rows;
    },
    async discard(id) {
      await pool.query(`
        UPDATE hackutd_finance.recommendation_call SET state = 'failed'
        WHERE id = $1 AND owner_id = $2 AND state = 'ready'
      `, [id, ownerId]);
    },
  };
}

function callDestination(env) {
  if (!/^\+[1-9]\d{7,14}$/.test(env.CALL_RECOMMENDATION_TO_NUMBER ?? '') || (env.CALLS_API_KEY?.length ?? 0) < 24) return null;
  try {
    const url = new URL(env.CALLS_API_URL || 'http://127.0.0.1:8788');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) return null;
    return { url: new URL('/calls', url), number: env.CALL_RECOMMENDATION_TO_NUMBER };
  } catch {
    return null;
  }
}

async function dialRecommendationCall(destination, context, env, fetchImpl) {
  const opening = context.candidates.find(({ id }) => id === context.openingId);
  try {
    const response = await fetchImpl(destination.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(65_000),
      headers: { 'content-type': 'application/json', 'x-api-key': env.CALLS_API_KEY },
      body: JSON.stringify({
        call_id: context.id, idempotency_key: context.id, user_id: env.CALL_RECOMMENDATION_USER_ID.trim(),
        to_number: destination.number,
        scenario: `There’s a nearby ${opening.merchant} offer in the demo catalog. Ask me to check a price or another option.`,
      }),
    });
    if (response.ok) {
      const result = await response.json();
      return result.call_id === context.id && ['dial_requested', 'busy', 'no_answer', 'declined'].includes(result.status)
        ? result.status : 'uncertain';
    }
    return [401, 403, 409, 422, 429].includes(response.status) ? 'failed' : 'uncertain';
  } catch {
    return 'uncertain';
  }
}

module.exports = { CALL_WINDOW_MS, UUID, isCallId, sameInputs, inputVersions, createCallContexts, callDestination, dialRecommendationCall };
