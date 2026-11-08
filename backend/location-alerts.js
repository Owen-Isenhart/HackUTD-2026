const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { SEARCH_RADIUS_METERS, offers } = require('../src/nearbyOffers');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const deviceLifetimeMs = 7 * 24 * 60 * 60_000;

function createLocationAlerts(pool, ownerId) {
  return {
    async settings() {
      const { rows: [row] } = await pool.query(`SELECT channel, version FROM hackutd_finance.alert_settings WHERE owner_id = $1`, [ownerId]);
      return row ?? { channel: 'off', version: 0 };
    },
    async updateSettings(channel, version) {
      const { rows: [row] } = version === 0
        ? await pool.query(`
            INSERT INTO hackutd_finance.alert_settings (owner_id, channel, version)
            VALUES ($1, $2, 1) ON CONFLICT DO NOTHING RETURNING channel, version
          `, [ownerId, channel])
        : await pool.query(`
            UPDATE hackutd_finance.alert_settings SET channel = $2, version = version + 1
            WHERE owner_id = $1 AND version = $3 RETURNING channel, version
          `, [ownerId, channel, version]);
      return row;
    },
    async registerDevice() {
      const id = randomUUID();
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + deviceLifetimeMs);
      await pool.query(`
        INSERT INTO hackutd_finance.location_device (id, owner_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)
      `, [id, ownerId, hash(token), expiresAt]);
      return { id, token, expiresAt };
    },
    async revokeDevice(id) {
      await pool.query(`DELETE FROM hackutd_finance.location_device WHERE id = $1 AND owner_id = $2`, [id, ownerId]);
    },
    async authenticateDevice(id, authorization) {
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
      if (!token) return false;
      const { rowCount } = await pool.query(`
        SELECT 1 FROM hackutd_finance.location_device
        WHERE id = $1 AND owner_id = $2 AND token_hash = $3 AND expires_at > now()
      `, [id, ownerId, hash(token)]);
      return rowCount === 1;
    },
    async isDeviceActive(id) {
      const { rowCount } = await pool.query(`
        SELECT 1 FROM hackutd_finance.location_device WHERE id = $1 AND owner_id = $2 AND expires_at > now()
      `, [id, ownerId]);
      return rowCount === 1;
    },
  };
}

function routineRegions(profile) {
  if(profile.selectedStores){
    const routineIds=new Set(profile.routines.map(r=>r.branch_merchant_id));
    return profile.selectedStores.filter(s=>s.selected).flatMap(s=>s.branches)
      .filter(b=>Number.isFinite(Number(b.lat))&&Number.isFinite(Number(b.lon))&&b.lat!=null&&b.lon!=null)
      .sort((a,b)=>Number(routineIds.has(b.id))-Number(routineIds.has(a.id))||(b.visits||0)-(a.visits||0)||a.id.localeCompare(b.id))
      .slice(0,20).map(b=>({identifier:b.id,latitude:Number(b.lat),longitude:Number(b.lon),radius:SEARCH_RADIUS_METERS,notifyOnExit:false}));
  }
  const timedMerchants = new Set(profile.routines.filter(({ daypart }) => daypart).map(({ provenance }) => provenance.merchantSourceId));
  return offers.filter((offer) => timedMerchants.has(offer.nessieMerchantId)).slice(0, 20)
    .map(({ id, coordinates }) => ({ identifier: id, ...coordinates, radius: SEARCH_RADIUS_METERS, notifyOnExit: false }));
}

function inQuietHours(timeZone, now = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour >= 22 || hour < 8;
}

function imessageEnabled(env) {
  return Boolean(env.PHOTON_PROJECT_ID && env.PHOTON_API_KEY && env.PHOTON_AGENT_USER_ID && env.PHOTON_RECIPIENT);
}

async function sendRecommendationMessage(context, env, fetchImpl, stillEligible) {
  const prefix = `https://api.photon.codes/v1/projects/${encodeURIComponent(env.PHOTON_PROJECT_ID)}`;
  const post = async (path, payload, key) => {
    const response = await fetchImpl(`${prefix}/${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3500),
      headers: { Authorization: `Bearer ${env.PHOTON_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { rejected: response.status >= 400 && response.status < 500 && response.status !== 408 };
    return { accepted: true, payload: await response.json().catch(() => null) };
  };
  const platform = 'imessage';
  const setupKey = hash(`${env.PHOTON_AGENT_USER_ID}:${env.PHOTON_RECIPIENT}`);
  try {
    const recipient = await post('users', { platform, handle: env.PHOTON_RECIPIENT }, `recipient-${setupKey}`);
    if (!recipient.payload?.id) return { state: 'failed' };
    const space = await post('spaces', { platform, participantIds: [env.PHOTON_AGENT_USER_ID, recipient.payload.id] }, `space-${setupKey}`);
    if (!space.payload?.id) return { state: 'failed' };
    if (!await stillEligible()) return { state: 'failed' };
    const result = await post('messages', { spaceId: space.payload.id, senderId: env.PHOTON_AGENT_USER_ID,
      content: { type: 'text', format: 'plain', text: 'Hands-Off Banking found a nearby demo offer. Open the app to see your recommendation.' } }, context.id);
    if (result.accepted) return { state: 'message_accepted', providerId: result.payload?.id ?? null };
    return { state: result.rejected ? 'failed' : 'uncertain' };
  } catch {
    return { state: 'uncertain' };
  }
}

module.exports = { createLocationAlerts, routineRegions, inQuietHours, imessageEnabled, sendRecommendationMessage };
