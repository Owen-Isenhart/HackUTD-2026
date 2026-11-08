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
    await pool.query(readFileSync('backend/migrations/008-voice-phone-link.sql', 'utf8'));
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
    for (const table of ['onboarding_phone_link', 'onboarding_registration', 'onboarding_user_link', 'onboarding_session', 'onboarding_attempt']) {
      await pool.query(`DELETE FROM hackutd_finance.${table} WHERE user_id LIKE $1`, [`${prefix}%`]);
    }
    await pool.end();
  }
});

test('PostgreSQL routes only verified, linked phones to phone details and keeps the two flows apart', { skip: !process.env.ONBOARDING_TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.ONBOARDING_TEST_DATABASE_URL, max: 4 });
  const prefix = randomUUID();
  const store = createOnboardingStore(pool, 'test-only-hash-key-at-least-24-characters');
  const phone = '+19725550444';
  const other = '+19725550333';
  const session = (suffix) => `${prefix}_+19725550444_${suffix}`;
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS hackutd_finance');
    await pool.query(readFileSync('backend/migrations/007-onboarding.sql', 'utf8'));
    await pool.query(readFileSync('backend/migrations/008-voice-phone-link.sql', 'utf8'));
    await pool.query(readFileSync('backend/migrations/008-voice-phone-link.sql', 'utf8')); // re-runnable

    // New number: onboarding with a provisional id.
    const first = await store.route({ phone_number: phone, session_id: session('a') });
    assert.equal(first.status, 'pending');
    assert.equal(first.profile, 'onboarding');
    const user = first.user_id;
    // Still pending (no verified link): onboarding again.
    assert.equal((await store.route({ phone_number: phone, session_id: session('b') })).profile, 'onboarding');

    // Complete onboarding: the verify transaction writes the durable phone link.
    const body = { session_id: session('a'), user_id: user, phone_number: phone };
    assert.equal((await store.attempt(body)).allowed, true);
    await store.verify(body, { customerId: `${prefix}-customer`, accountId: `${prefix}-account` });
    await pool.query('DELETE FROM hackutd_finance.onboarding_registration WHERE user_id = $1', [user]); // 24 h prune

    // Same number calls again: returning-caller sequence, unverified until the check passes.
    const again = await store.route({ phone_number: phone, session_id: session('c') });
    assert.deepEqual(again, { status: 'registered', profile: 'phone_details', user_id: user });
    const details = { session_id: session('c'), user_id: user, phone_number: phone };
    assert.deepEqual(await store.phoneDetailsSession(details),
      { verified: false, failures: 0, customerId: `${prefix}-customer`, accountId: `${prefix}-account` });
    // The phone_details session cannot run the onboarding path, and onboarding cannot reuse it.
    assert.equal((await store.attempt(details)).allowed, false);
    await assert.rejects(store.verify(details, { customerId: 'someone-else', accountId: 'x' }));
    assert.equal((await store.resolve({ phone_number: phone, session_id: session('c') })).status, 'unavailable');
    assert.equal((await store.attempt(details, { profile: 'phone_details' })).allowed, true);
    await store.verifyReturning(details);
    assert.equal((await store.phoneDetailsSession(details)).verified, true);
    // A session id cannot be rebound to another caller.
    assert.equal((await store.route({ phone_number: other, session_id: session('c') })).status, 'unavailable');

    // Two mismatches lock a returning-caller session.
    const locked = { session_id: session('d'), user_id: user, phone_number: phone };
    await store.route({ phone_number: phone, session_id: locked.session_id });
    await store.fail(locked); await store.fail(locked);
    assert.equal(await store.phoneDetailsSession(locked), null);
    assert.equal((await store.attempt(locked, { profile: 'phone_details' })).allowed, false);

    // A number already linked to one user cannot be linked to another during onboarding.
    const intruder = await store.route({ phone_number: other, session_id: `${prefix}_other` });
    const steal = { session_id: `${prefix}_other`, user_id: intruder.user_id, phone_number: other };
    await pool.query('INSERT INTO hackutd_finance.onboarding_user_link (user_id, customer_id, account_id) VALUES ($1, $2, $3)',
      [`${prefix}-owner`, `${prefix}-owner-customer`, `${prefix}-owner-account`]);
    await pool.query("INSERT INTO hackutd_finance.onboarding_phone_link (phone_hash, user_id) SELECT phone_hash, $1 FROM hackutd_finance.onboarding_session WHERE session_id = $2",
      [`${prefix}-owner`, steal.session_id]);
    assert.equal((await store.attempt(steal)).allowed, true);
    await assert.rejects(store.verify(steal, { customerId: `${prefix}-c2`, accountId: `${prefix}-a2` }), /Phone link conflict/);
    const { rows } = await pool.query('SELECT 1 FROM hackutd_finance.onboarding_user_link WHERE user_id = $1', [intruder.user_id]);
    assert.equal(rows.length, 0, 'the failed verification rolled back the user link');

    // Outbound seeding needs the user's own linked phone.
    assert.deepEqual(await store.seedVerified({ phone_number: phone, user_id: user, session_id: `${prefix}-out` }), { status: 'verified' });
    assert.deepEqual(await store.seedVerified({ phone_number: other, user_id: user, session_id: `${prefix}-out2` }), { status: 'unavailable' });
  } finally {
    await pool.query('DELETE FROM hackutd_finance.onboarding_session WHERE session_id LIKE $1', [`${prefix}%`]);
    for (const number of [phone, other]) {
      const hash = require('node:crypto').createHmac('sha256', 'test-only-hash-key-at-least-24-characters').update(number).digest('hex');
      await pool.query('DELETE FROM hackutd_finance.onboarding_phone_link WHERE phone_hash = $1', [hash]);
      await pool.query('DELETE FROM hackutd_finance.onboarding_attempt WHERE phone_hash = $1', [hash]);
      await pool.query('DELETE FROM hackutd_finance.onboarding_registration WHERE phone_hash = $1', [hash]);
    }
    await pool.query("DELETE FROM hackutd_finance.onboarding_user_link WHERE user_id LIKE $1 OR customer_id LIKE $1", [`${prefix}%`]);
    await pool.end();
  }
});
