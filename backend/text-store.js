// Storage for Photon texts and text-derived obligations: Tiger Data when
// TIGER_DATA_URL is set, otherwise an in-memory store for the running server.
// Both expose the same interface so the worker and API are storage-agnostic.
const { randomUUID } = require('node:crypto');
const { hasMoneySignal, matchesExisting, mergeObligation, applyUserEdit } = require('./text-obligations');

const MAX_ATTEMPTS = 3;
const LEASE_MS = 60_000;
const CONTEXT_WINDOW_MS = 48 * 3_600_000;
const RETENTION_MS = 7 * 86_400_000;

/**
 * A text with no money words still matters when the user is replying to one
 * ("I'm in" after "$40 each Friday?"), so the user's own replies are queued
 * when a recent message in the same conversation had a signal.
 */
function initialStatus(message, recent) {
  if (!message.text) return 'no_text';
  if (hasMoneySignal(message.text)) return 'queued';
  if (message.senderRole === 'owner' && recent.slice(-3).some((m) => m.text && hasMoneySignal(m.text))) return 'queued';
  return 'no_signal';
}

function recentFilter(rows, message) {
  const at = Date.parse(message.receivedAt);
  return rows
    .filter((m) => m.spaceId === message.spaceId && m.id !== message.id && m.text
      && Date.parse(m.receivedAt) <= at && at - Date.parse(m.receivedAt) <= CONTEXT_WINDOW_MS)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id));
}

function createMemoryTextStore({ clock = () => Date.now() } = {}) {
  const owners = new Set();
  const messages = new Map();
  const deliveries = new Set();
  const obligations = new Map();
  let cursor = null;

  return {
    kind: 'session',
    async ownerUserIds() { return new Set(owners); },
    async addOwnerUserId(id) { owners.add(id); },
    async recordMessage(message, deliveryId) {
      deliveries.add(deliveryId);
      if (messages.has(message.id)) return { inserted: false };
      const status = initialStatus(message, recentFilter([...messages.values()], message));
      messages.set(message.id, { ...message, status, attempts: 0, leaseUntil: 0, purgeAt: clock() + RETENTION_MS });
      return { inserted: true, status };
    },
    async claimJobs(limit = 5) {
      const now = clock();
      const claimable = [...messages.values()]
        .filter((m) => (m.status === 'queued' || (m.status === 'interpreting' && m.leaseUntil < now)) && m.attempts < MAX_ATTEMPTS)
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
        .slice(0, limit);
      for (const m of claimable) Object.assign(m, { status: 'interpreting', attempts: m.attempts + 1, leaseUntil: now + LEASE_MS });
      return claimable.map((m) => ({ ...m }));
    },
    async recentContext(message) {
      return recentFilter([...messages.values()], message).map((m) => ({ ...m }));
    },
    async completeJob(message, interpretation) {
      const row = messages.get(message.id);
      if (!row || row.status !== 'interpreting') return { applied: false };
      let applied = false;
      if (interpretation.kind !== 'none') {
        const existing = [...obligations.values()]
          .filter((o) => matchesExisting(o, interpretation, message))
          .sort((a, b) => Number(b.spaceId === message.spaceId) - Number(a.spaceId === message.spaceId) || b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
        if (!existing?.sourceMessageIds.includes(message.id)) {
          const next = mergeObligation(existing, interpretation, message);
          if (next) {
            const id = existing?.id ?? randomUUID();
            obligations.set(id, { ...next, id, version: (existing?.version ?? 0) + 1, updatedAt: new Date(clock()).toISOString() });
            applied = true;
          }
        }
      }
      Object.assign(row, { status: 'interpreted', resultKind: interpretation.kind, lastError: null });
      return { applied };
    },
    async failJob(message, error) {
      const row = messages.get(message.id);
      if (!row) return;
      Object.assign(row, { status: row.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', lastError: String(error).slice(0, 80) });
    },
    async listObligations() { return [...obligations.values()].map((o) => ({ ...o })); },
    async editObligation(id, edit) {
      const o = obligations.get(id);
      if (!o) return undefined;
      if (o.version !== edit.version) return null;
      const next = { ...applyUserEdit(o, edit), id, version: o.version + 1, updatedAt: new Date(clock()).toISOString() };
      obligations.set(id, next);
      return { ...next };
    },
    async syncCursor() { return cursor; },
    async saveSyncCursor(next) { cursor = next; },
    async purgeExpired() {
      const now = clock();
      for (const m of messages.values()) if (m.purgeAt <= now && m.text && !['queued', 'interpreting'].includes(m.status)) m.text = null;
    },
    async status() {
      const counts = {};
      for (const m of messages.values()) counts[m.status] = (counts[m.status] ?? 0) + 1;
      return { storage: 'session', messages: counts, cursor };
    },
  };
}

function fromRow(row) {
  return {
    id: row.provider_id, platform: row.platform, spaceId: row.space_id, senderRole: row.sender_role,
    receivedAt: new Date(row.received_at).toISOString(), text: row.body, status: row.status, attempts: row.attempts,
  };
}

function obligationFromRow(row) {
  return { ...row.record, id: row.id, status: row.status, version: row.version, updatedAt: new Date(row.updated_at).toISOString() };
}

function createTigerTextStore(pool, { ownerId, projectId }) {
  if (!ownerId || !/^[a-z0-9-]+$/i.test(ownerId)) throw new Error('Set a valid NESSIE_ACCOUNT_ID.');
  if (!projectId) throw new Error('Set PHOTON_PROJECT_ID.');
  const s = 'hackutd_finance';

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function context(db, message) {
    const { rows } = await db.query(`
      SELECT * FROM ${s}.text_message
      WHERE owner_id = $1 AND project_id = $2 AND space_id = $3 AND provider_id <> $4 AND body IS NOT NULL
        AND received_at <= $5 AND received_at >= $5::timestamptz - interval '48 hours'
      ORDER BY received_at DESC, provider_id DESC LIMIT 6`, [ownerId, projectId, message.spaceId, message.id, message.receivedAt]);
    return rows.reverse().map(fromRow);
  }

  return {
    kind: 'tiger_data',
    async ownerUserIds() {
      const { rows } = await pool.query(`SELECT photon_user_id FROM ${s}.text_owner_user WHERE owner_id = $1`, [ownerId]);
      return new Set(rows.map((r) => r.photon_user_id));
    },
    async addOwnerUserId(id) {
      await pool.query(`INSERT INTO ${s}.text_owner_user (owner_id, photon_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [ownerId, id]);
    },
    recordMessage(message, deliveryId) {
      return transaction(async (db) => {
        await db.query(`INSERT INTO ${s}.text_delivery (owner_id, delivery_id, provider_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [ownerId, deliveryId, message.id]);
        const status = initialStatus(message, await context(db, message));
        const { rowCount } = await db.query(`
          INSERT INTO ${s}.text_message (owner_id, project_id, provider_id, platform, space_id, sender_role, received_at, body, purge_at, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '7 days', $9)
          ON CONFLICT (owner_id, project_id, provider_id) DO NOTHING`,
        [ownerId, projectId, message.id, message.platform, message.spaceId, message.senderRole, message.receivedAt, message.text || null, status]);
        return { inserted: rowCount === 1, status };
      });
    },
    async claimJobs(limit = 5) {
      const { rows } = await pool.query(`
        UPDATE ${s}.text_message AS m SET status = 'interpreting', attempts = m.attempts + 1,
          lease_until = now() + interval '60 seconds', updated_at = now()
        WHERE (m.owner_id, m.project_id, m.provider_id) IN (
          SELECT owner_id, project_id, provider_id FROM ${s}.text_message
          WHERE owner_id = $1 AND project_id = $2 AND attempts < $3
            AND (status = 'queued' OR (status = 'interpreting' AND lease_until < now()))
          ORDER BY received_at LIMIT $4 FOR UPDATE SKIP LOCKED)
        RETURNING m.*`, [ownerId, projectId, MAX_ATTEMPTS, limit]);
      return rows.map(fromRow).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    },
    recentContext(message) { return context(pool, message); },
    completeJob(message, interpretation) {
      return transaction(async (db) => {
        const { rows: [row] } = await db.query(`
          SELECT status FROM ${s}.text_message WHERE owner_id = $1 AND project_id = $2 AND provider_id = $3 FOR UPDATE`,
        [ownerId, projectId, message.id]);
        if (row?.status !== 'interpreting') return { applied: false };
        let applied = false;
        if (interpretation.kind !== 'none') {
          // Plans can match across conversations and email, so merges serialize per owner.
          await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`text_obligation:${ownerId}`]);
          const { rows } = await db.query(`
            SELECT * FROM ${s}.text_obligation WHERE owner_id = $1
              AND status IN ('included', 'needs_clarification', 'expected_inflow') FOR UPDATE`, [ownerId]);
          const existing = rows.map(obligationFromRow)
            .filter((o) => matchesExisting(o, interpretation, message))
            .sort((a, b) => Number(b.spaceId === message.spaceId) - Number(a.spaceId === message.spaceId) || b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
          if (!existing?.sourceMessageIds.includes(message.id)) {
            const next = mergeObligation(existing, interpretation, message);
            if (next) {
              const { id: _id, version: _v, updatedAt: _u, status, ...record } = next;
              if (existing) {
                await db.query(`UPDATE ${s}.text_obligation SET status = $2, record = $3, version = version + 1, updated_at = now() WHERE id = $1`,
                  [existing.id, status, record]);
              } else {
                await db.query(`INSERT INTO ${s}.text_obligation (id, owner_id, space_id, status, record) VALUES ($1, $2, $3, $4, $5)`,
                  [randomUUID(), ownerId, message.spaceId, status, record]);
              }
              applied = true;
            }
          }
        }
        await db.query(`UPDATE ${s}.text_message SET status = 'interpreted', result_kind = $4, last_error = NULL, lease_until = NULL, updated_at = now()
          WHERE owner_id = $1 AND project_id = $2 AND provider_id = $3`, [ownerId, projectId, message.id, interpretation.kind]);
        return { applied };
      });
    },
    async failJob(message, error) {
      await pool.query(`
        UPDATE ${s}.text_message SET status = CASE WHEN attempts >= $4 THEN 'failed' ELSE 'queued' END,
          last_error = $5, lease_until = NULL, updated_at = now()
        WHERE owner_id = $1 AND project_id = $2 AND provider_id = $3 AND status = 'interpreting'`,
      [ownerId, projectId, message.id, MAX_ATTEMPTS, String(error).slice(0, 80)]);
    },
    async listObligations() {
      const { rows } = await pool.query(`SELECT * FROM ${s}.text_obligation WHERE owner_id = $1`, [ownerId]);
      return rows.map(obligationFromRow);
    },
    editObligation(id, edit) {
      return transaction(async (db) => {
        const { rows: [row] } = await db.query(`SELECT * FROM ${s}.text_obligation WHERE owner_id = $1 AND id = $2 FOR UPDATE`, [ownerId, id]);
        if (!row) return undefined;
        if (row.version !== edit.version) return null;
        const { id: _id, version: _v, updatedAt: _u, status, ...record } = applyUserEdit(obligationFromRow(row), edit);
        const { rows: [updated] } = await db.query(`
          UPDATE ${s}.text_obligation SET status = $3, record = $4, version = version + 1, updated_at = now()
          WHERE owner_id = $1 AND id = $2 RETURNING *`, [ownerId, id, status, record]);
        return obligationFromRow(updated);
      });
    },
    async syncCursor() {
      const { rows: [row] } = await pool.query(`SELECT cursor FROM ${s}.text_sync WHERE owner_id = $1`, [ownerId]);
      return row?.cursor ?? null;
    },
    async saveSyncCursor(next) {
      await pool.query(`
        INSERT INTO ${s}.text_sync (owner_id, cursor) VALUES ($1, $2)
        ON CONFLICT (owner_id) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`, [ownerId, next]);
    },
    async purgeExpired() {
      await pool.query(`UPDATE ${s}.text_message SET body = NULL, updated_at = now()
        WHERE owner_id = $1 AND body IS NOT NULL AND purge_at <= now() AND status NOT IN ('queued', 'interpreting')`, [ownerId]);
    },
    async status() {
      const { rows } = await pool.query(`SELECT status, count(*)::int AS n FROM ${s}.text_message WHERE owner_id = $1 GROUP BY status`, [ownerId]);
      return { storage: 'tiger_data', messages: Object.fromEntries(rows.map((r) => [r.status, r.n])), cursor: await this.syncCursor() };
    },
  };
}

module.exports = { createMemoryTextStore, createTigerTextStore, initialStatus };
