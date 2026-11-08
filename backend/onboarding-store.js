const { createHmac } = require('node:crypto');

function createOnboardingStore(pool, secret) {
  if (!secret || secret.length < 24) throw Error('Configure ONBOARDING_HASH_KEY with at least 24 characters.');
  const phoneHash = (phone) => createHmac('sha256', secret).update(phone).digest('hex');
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
    } finally { client.release(); }
  }
  const api = {
    async register({ user_id, phone_number }) {
      if (!/^[a-z0-9_.-]{1,64}$/i.test(user_id ?? '') || !/^\+[1-9]\d{7,14}$/.test(phone_number ?? '')) throw Error('Invalid registration.');
      await pool.query(`INSERT INTO hackutd_finance.onboarding_registration (user_id, phone_hash)
        VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET phone_hash = EXCLUDED.phone_hash,
        expires_at = now() + interval '24 hours'`, [user_id, phoneHash(phone_number)]);
      return { status: 'registered' };
    },
    async resolve({ phone_number, session_id }) {
      if (!/^\+[1-9]\d{7,14}$/.test(phone_number ?? '') || !/^[a-z0-9_.+-]{1,128}$/i.test(session_id ?? '')) return { status: 'unavailable' };
      const hash = phoneHash(phone_number);
      // A phone-first caller can begin setup without an existing app signup. The
      // stable opaque ID keeps limits and verified links consistent across calls.
      // Caller ID starts an unverified session; it is never proof of identity.
      const provisionalId = `phone-${hash.slice(0, 40)}`;
      const { rows: [registration] } = await pool.query(`INSERT INTO hackutd_finance.onboarding_registration AS existing
        (user_id, phone_hash) VALUES ($1, $2)
        ON CONFLICT (phone_hash) DO UPDATE SET expires_at = now() + interval '24 hours'
        RETURNING user_id`, [provisionalId, hash]);
      const { rows: [session] } = await pool.query(`INSERT INTO hackutd_finance.onboarding_session AS existing (session_id, user_id, phone_hash)
        VALUES ($1, $2, $3) ON CONFLICT (session_id) DO UPDATE SET session_id = EXCLUDED.session_id
        WHERE existing.user_id = EXCLUDED.user_id AND existing.phone_hash = EXCLUDED.phone_hash AND existing.expires_at > now()
          AND existing.profile = 'onboarding'
        RETURNING user_id`, [session_id, registration.user_id, hash]);
      return session ? { status: 'pending', user_id: session.user_id } : { status: 'unavailable' };
    },
    // Chooses the call sequence for an inbound caller. A number linked to a user who completed
    // onboarding gets an unverified phone_details session; everyone else gets onboarding.
    // Caller ID only picks the sequence and the candidate account; it never verifies anyone.
    async route({ phone_number, session_id }) {
      if (!/^\+[1-9]\d{7,14}$/.test(phone_number ?? '') || !/^[a-z0-9_.+-]{1,128}$/i.test(session_id ?? '')) return { status: 'unavailable' };
      const hash = phoneHash(phone_number);
      const { rows: [linked] } = await pool.query(`SELECT link.user_id FROM hackutd_finance.onboarding_phone_link AS phone
        JOIN hackutd_finance.onboarding_user_link AS link USING (user_id) WHERE phone.phone_hash = $1`, [hash]);
      if (!linked) {
        const pending = await api.resolve({ phone_number, session_id });
        return pending.status === 'pending' ? { ...pending, profile: 'onboarding' } : pending;
      }
      const { rows: [session] } = await pool.query(`INSERT INTO hackutd_finance.onboarding_session AS existing
          (session_id, user_id, phone_hash, profile, expires_at)
        VALUES ($1, $2, $3, 'phone_details', now() + interval '15 minutes')
        ON CONFLICT (session_id) DO UPDATE SET session_id = EXCLUDED.session_id
        WHERE existing.user_id = EXCLUDED.user_id AND existing.phone_hash = EXCLUDED.phone_hash
          AND existing.profile = 'phone_details' AND existing.expires_at > now()
        RETURNING user_id`, [session_id, linked.user_id, hash]);
      return session ? { status: 'registered', profile: 'phone_details', user_id: session.user_id } : { status: 'unavailable' };
    },
    // Outbound calls placed by the trusted backend to the user's own linked number start verified.
    async seedVerified({ phone_number, session_id, user_id }) {
      if (!/^\+[1-9]\d{7,14}$/.test(phone_number ?? '') || !/^[a-z0-9_.+-]{1,128}$/i.test(session_id ?? '')
        || !/^[a-z0-9_.-]{1,64}$/i.test(user_id ?? '')) return { status: 'unavailable' };
      const hash = phoneHash(phone_number);
      const { rows: [session] } = await pool.query(`INSERT INTO hackutd_finance.onboarding_session
          (session_id, user_id, phone_hash, profile, verified, customer_id, expires_at)
        SELECT $1, link.user_id, phone.phone_hash, 'phone_details', true, link.customer_id, now() + interval '15 minutes'
        FROM hackutd_finance.onboarding_phone_link AS phone
        JOIN hackutd_finance.onboarding_user_link AS link USING (user_id)
        WHERE phone.phone_hash = $2 AND link.user_id = $3
        ON CONFLICT (session_id) DO NOTHING
        RETURNING session_id`, [session_id, hash, user_id]);
      return session ? { status: 'verified' } : { status: 'unavailable' };
    },
    async phoneDetailsSession(body) {
      const { rows: [session] } = await pool.query(`SELECT session.verified, session.failures, link.customer_id, link.account_id
        FROM hackutd_finance.onboarding_session AS session
        JOIN hackutd_finance.onboarding_user_link AS link USING (user_id)
        JOIN hackutd_finance.onboarding_phone_link AS phone ON phone.phone_hash = session.phone_hash AND phone.user_id = session.user_id
        WHERE session.session_id = $1 AND session.user_id = $2 AND session.phone_hash = $3
          AND session.profile = 'phone_details' AND session.expires_at > now()`,
      [body.session_id, body.user_id, phoneHash(body.phone_number)]);
      if (!session || session.failures >= 2) return null;
      return { verified: session.verified, failures: session.failures, customerId: session.customer_id, accountId: session.account_id };
    },
    // The user's confirmed budget, if they saved one in the app. Missing table or row -> null.
    async confirmedBudget(userId) {
      try {
        const { rows: [row] } = await pool.query('SELECT budget FROM hackutd_finance.confirmed_memory WHERE owner_id = $1', [userId]);
        const budget = row?.budget;
        return budget && ['week', 'month'].includes(budget.period) && Number.isSafeInteger(budget.limitCents) && budget.limitCents >= 0
          ? { period: budget.period, limitCents: budget.limitCents } : null;
      } catch { return null; }
    },
    async verifyReturning(body) {
      const updated = await pool.query(`UPDATE hackutd_finance.onboarding_session AS session SET verified = true, customer_id = link.customer_id
        FROM hackutd_finance.onboarding_user_link AS link
        WHERE session.session_id = $1 AND session.user_id = $2 AND session.phone_hash = $3 AND link.user_id = session.user_id
          AND session.profile = 'phone_details' AND session.expires_at > now() AND session.failures < 2
        RETURNING session.session_id`, [body.session_id, body.user_id, phoneHash(body.phone_number)]);
      if (!updated.rowCount) throw Error('Verification session expired.');
    },
    async attempt(body, { profile = 'onboarding' } = {}) {
      const hash = phoneHash(body.phone_number);
      return transaction(async (client) => {
        // Stable ordering prevents deadlocks; both identities are locked across workers.
        for (const key of [`onboard-phone:${hash}`, `onboard-user:${body.user_id}`].sort()) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        }
        // Only onboarding may create its session here; phone_details sessions come from route().
        if (profile === 'onboarding') {
          await client.query(`INSERT INTO hackutd_finance.onboarding_session (session_id, user_id, phone_hash)
            VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [body.session_id, body.user_id, hash]);
        }
        const { rows: [session] } = await client.query(`SELECT *, expires_at > now() AS active
          FROM hackutd_finance.onboarding_session WHERE session_id = $1 FOR UPDATE`, [body.session_id]);
        // A returning caller's session can never run the onboarding (link a new customer) path, and vice versa.
        if (!session || !session.active || session.profile !== profile || session.user_id !== body.user_id
          || session.phone_hash !== hash || session.failures >= 2) return { allowed: false };
        if (session.verified) return { allowed: true, result: { status: 'verified', customer_id: session.customer_id } };
        const { rows: [counts] } = await client.query(`SELECT
          count(*) FILTER (WHERE user_id = $1)::int AS users,
          count(*) FILTER (WHERE phone_hash = $2)::int AS phones
          FROM hackutd_finance.onboarding_attempt
          WHERE attempted_at > now() - interval '1 hour' AND (user_id = $1 OR phone_hash = $2)`, [body.user_id, hash]);
        if (counts.users >= 5 || counts.phones >= 5) return { allowed: false };
        await client.query('INSERT INTO hackutd_finance.onboarding_attempt (user_id, phone_hash) VALUES ($1, $2)', [body.user_id, hash]);
        return { allowed: true };
      });
    },
    async fail(body) {
      await pool.query(`UPDATE hackutd_finance.onboarding_session SET failures = failures + 1
        WHERE session_id = $1 AND user_id = $2 AND NOT verified`, [body.session_id, body.user_id]);
    },
    async verify(body, { customerId, accountId }) {
      await transaction(async (client) => {
        const updated = await client.query(`UPDATE hackutd_finance.onboarding_session
          SET verified = true, customer_id = $3
          WHERE session_id = $1 AND user_id = $2 AND phone_hash = $4 AND expires_at > now() AND failures < 2
            AND profile = 'onboarding'
          RETURNING session_id`, [body.session_id, body.user_id, customerId, phoneHash(body.phone_number)]);
        if (!updated.rowCount) throw Error('Verification session expired.');
        // Refuse silently reassigning an existing user to another sandbox customer.
        const link = await client.query(`INSERT INTO hackutd_finance.onboarding_user_link AS existing (user_id, customer_id, account_id)
          VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET verified_at = now(), account_id = EXCLUDED.account_id
          WHERE existing.customer_id = EXCLUDED.customer_id RETURNING user_id`, [body.user_id, customerId, accountId]);
        if (!link.rowCount) throw Error('User link conflict.');
        // The durable phone record that makes the next call from this number a returning-caller call.
        // A number already linked to a different user rolls the whole verification back.
        const phone = await client.query(`INSERT INTO hackutd_finance.onboarding_phone_link AS existing (phone_hash, user_id)
          VALUES ($1, $2) ON CONFLICT (phone_hash) DO UPDATE SET linked_at = now()
          WHERE existing.user_id = EXCLUDED.user_id RETURNING phone_hash`, [phoneHash(body.phone_number), body.user_id]);
        if (!phone.rowCount) throw Error('Phone link conflict.');
      });
    },
    async prune() {
      await pool.query("DELETE FROM hackutd_finance.onboarding_attempt WHERE attempted_at < now() - interval '1 hour'");
      await pool.query('DELETE FROM hackutd_finance.onboarding_registration WHERE expires_at < now()');
      await pool.query('DELETE FROM hackutd_finance.onboarding_session WHERE expires_at < now()');
    },
  };
  return api;
}
module.exports = { createOnboardingStore };
