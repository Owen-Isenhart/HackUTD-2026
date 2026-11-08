const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');

function createTigerPool(env = process.env) {
  const url = new URL(env.TIGER_DATA_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('TIGER_DATA_URL must use PostgreSQL.');
  if (env.TIGER_DATA_PASSWORD) url.password = encodeURIComponent(env.TIGER_DATA_PASSWORD);
  if (!url.password) throw new Error('Set TIGER_DATA_PASSWORD or include the password in TIGER_DATA_URL.');
  url.searchParams.delete('uselibpqcompat');
  url.searchParams.set('sslmode', 'verify-full');
  const pool = new Pool({ connectionString: url.toString(), max: 4, connectionTimeoutMillis: 5000, statement_timeout: 8000 });
  pool.on('error', () => console.error('Tiger Data idle connection failed.'));
  return pool;
}

async function migrateTiger(pool) {
  const directory = join(__dirname, 'migrations');
  const migrations = readdirSync(directory).filter((name) => /^\d{3}-[a-z0-9-]+\.sql$/.test(name)).sort()
    .map((name) => readFileSync(join(directory, name), 'utf8'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(72839901)');
    for (const migration of migrations) await client.query(migration);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function createTigerMemory(pool, ownerId) {
  if (!ownerId || !/^[a-z0-9-]+$/i.test(ownerId)) throw new Error('Set a valid NESSIE_ACCOUNT_ID.');
  return {
    async saveProfile(profile) {
      await pool.query(`
        INSERT INTO hackutd_finance.profile AS p (owner_id, as_of, snapshot)
        VALUES ($1, $2, $3)
        ON CONFLICT (owner_id) DO UPDATE
        SET as_of = EXCLUDED.as_of, snapshot = EXCLUDED.snapshot,
            version = p.version + CASE WHEN p.snapshot - 'asOf' - 'routineInsight'
              IS DISTINCT FROM EXCLUDED.snapshot - 'asOf' - 'routineInsight' THEN 1 ELSE 0 END
        WHERE p.as_of < EXCLUDED.as_of
      `, [ownerId, profile.asOf, profile]);
    },
    async loadProfile() {
      const { rows: [row] } = await pool.query(`
        SELECT p.snapshot, p.version, m.version AS memory_version, m.budget, m.goals, m.confirmed_at, m.reserve_cents
        FROM hackutd_finance.profile AS p
        LEFT JOIN hackutd_finance.confirmed_memory AS m USING (owner_id)
        WHERE p.owner_id = $1
      `, [ownerId]);
      if (!row) return null;
      return {
        ...row.snapshot,
        profileVersion: row.version,
        memoryVersion: row.memory_version ?? 0,
        memoryStorage: 'tiger_data',
        confirmedBudget: row.budget,
        confirmedGoals: row.goals,
        confirmedReserveCents: row.reserve_cents == null ? null : Number(row.reserve_cents),
        memoryConfirmedAt: row.confirmed_at,
      };
    },
    async confirmMemory({ version, budget, goals, reserveCents }) {
      const values = [ownerId, budget, JSON.stringify(goals), reserveCents ?? null];
      const query = version === 0
        ? `INSERT INTO hackutd_finance.confirmed_memory (owner_id, budget, goals, reserve_cents)
           VALUES ($1, $2, $3, $4) ON CONFLICT (owner_id) DO NOTHING RETURNING version, confirmed_at, reserve_cents`
        : `UPDATE hackutd_finance.confirmed_memory
           SET budget = $2, goals = $3, confirmed_at = now(), version = version + 1,
               reserve_cents = CASE WHEN $6 THEN $4::bigint ELSE reserve_cents END
           WHERE owner_id = $1 AND version = $5 RETURNING version, confirmed_at, reserve_cents`;
      if (version !== 0) values.push(version, reserveCents !== undefined);
      const { rows: [row] } = await pool.query(query, values);
      return row && { version: row.version, confirmedAt: row.confirmed_at,
        reserveCents: row.reserve_cents == null ? null : Number(row.reserve_cents) };
    },
  };
}

module.exports = { createTigerPool, migrateTiger, createTigerMemory };
