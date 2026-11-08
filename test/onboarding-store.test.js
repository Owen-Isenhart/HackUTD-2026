const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Pool } = require('pg');
const { createOnboardingStore } = require('../backend/onboarding-store');

test('PostgreSQL serializes per-user and per-phone limits, expires sessions, and stores only verification identifiers', { skip: !process.env.ONBOARDING_TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.ONBOARDING_TEST_DATABASE_URL, max: 10 });
  const prefix = randomUUID();
  const store = createOnboardingStore(pool, 'test-only-hash-key-at-least-24-characters');
  const phone = `+1${String(Date.now()).slice(-10)}`;
  const request = (suffix, user = prefix, number = phone) => ({ session_id: `${prefix}-${suffix}`, user_id: user, phone_number: number });
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS hackutd_finance');
    await pool.query(readFileSync('backend/migrations/007-onboarding.sql', 'utf8'));
    const registration = request('incoming', `${prefix}-incoming`, '+19725550555');
    const incoming = await store.resolve({ ...registration, session_id: `${prefix}_+19725550555_live` });
    assert.equal(incoming.status, 'pending');
    assert.match(incoming.user_id, /^phone-[a-f0-9]{40}$/);
    assert.ok(!incoming.user_id.includes('19725550555'));
    assert.deepEqual(await store.resolve({ ...registration, session_id: `${prefix}_+19725550555_next` }), incoming);
    // A trusted app signup may register the phone under the same provisional ID.
    await pool.query('DELETE FROM hackutd_finance.onboarding_session WHERE user_id = $1', [incoming.user_id]);
    await pool.query('DELETE FROM hackutd_finance.onboarding_registration WHERE user_id = $1', [incoming.user_id]);
    await store.register(registration);
    assert.deepEqual(await store.resolve(registration), { status: 'pending', user_id: registration.user_id });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => store.attempt(request(i))));
    assert.equal(results.filter((r) => r.allowed).length, 5);
    const byPhone = await Promise.all(Array.from({ length: 10 }, (_, i) => store.attempt(request(`phone-${i}`, `${prefix}-${i}`, '+19725550999'))));
    assert.equal(byPhone.filter((r) => r.allowed).length, 5);
    // Changing phones does not bypass a user's limit.
    assert.equal((await store.attempt(request('new-phone', prefix, '+19725550888'))).allowed, false);
    const verified = request('verify', `${prefix}-verify`, '+19725550777');
    assert.equal((await store.attempt(verified)).allowed, true);
    const result = { status: 'verified', customer_id: 'customer-test' };
    await store.verify(verified, { customerId: 'customer-test', accountId: 'account-test' });
    assert.deepEqual((await store.attempt(verified)).result, result);
    assert.equal((await store.attempt({ ...verified, user_id: 'different-user' })).allowed, false);
    const { rows: [link] } = await pool.query('SELECT customer_id, account_id FROM hackutd_finance.onboarding_user_link WHERE user_id = $1', [verified.user_id]);
    assert.deepEqual(link, { customer_id: 'customer-test', account_id: 'account-test' });
    const retry = request('retry', `${prefix}-retry`, '+19725550666');
    assert.equal((await store.attempt(retry)).allowed, true);
    await store.fail(retry);
    assert.equal((await store.attempt(retry)).allowed, true);
    await store.fail(retry);
    assert.equal((await store.attempt(retry)).allowed, false);
    await pool.query("UPDATE hackutd_finance.onboarding_session SET expires_at = now() - interval '1 minute' WHERE session_id = $1", [verified.session_id]);
    assert.equal((await store.attempt(verified)).allowed, false);
  } finally {
    for (const table of ['onboarding_registration', 'onboarding_user_link', 'onboarding_session', 'onboarding_attempt']) {
      await pool.query(`DELETE FROM hackutd_finance.${table} WHERE user_id LIKE $1`, [`${prefix}%`]);
    }
    await pool.end();
  }
});
