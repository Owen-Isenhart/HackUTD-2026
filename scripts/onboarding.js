const { createServer } = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { createTigerPool, migrateTiger } = require('../backend/tiger-memory');
const { createOnboardingStore } = require('../backend/onboarding-store');
const { createOnboarding, createNessieLookup } = require('../backend/onboarding');

function createOnboardingServer({ evaluate, store, apiKey }) {
  if (!apiKey || apiKey.length < 24) throw Error('Configure a recommendation API key of at least 24 characters.');
  const expected = Buffer.from(apiKey);
  return createServer(async (req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && req.url === '/health') return send(200, { status: 'ok' });
    if (req.method !== 'POST' || !['/api/recommendations/evaluate', '/internal/onboarding/registrations', '/internal/onboarding/resolve'].includes(req.url)) return send(404, { error: 'Not found.' });
    const supplied = Buffer.from(req.headers['x-api-key'] || '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(401, { error: 'Credentials required.' });
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(400, { status: 'unavailable' });
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > 8192) { req.resume(); return send(413, { status: 'unavailable' }); }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/internal/onboarding/registrations') return send(200, await store.register(body));
      if (req.url === '/internal/onboarding/resolve') return send(200, await store.resolve(body));
      return send(200, await evaluate(body));
    } catch { return send(200, { status: 'unavailable' }); }
  });
}

async function main(env = process.env) {
  const pool = createTigerPool(env);
  if (process.argv.includes('--migrate')) {
    try { await migrateTiger(pool); console.log('Onboarding migrations applied.'); } finally { await pool.end(); }
    return;
  }
  const store = createOnboardingStore(pool, env.ONBOARDING_HASH_KEY);
  const evaluate = createOnboarding({ store, nessie: createNessieLookup({ env }), env });
  const server = createOnboardingServer({ evaluate, store, apiKey: env.RECOMMENDATION_API_KEY });
  let working = false;
  const timer = setInterval(async () => {
    if (working) return;
    working = true;
    try { await store.prune(); }
    catch { console.error('Onboarding session cleanup failed; will retry.'); }
    finally { working = false; }
  }, 60000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); pool.end(); });
  server.listen(Number(env.ONBOARDING_PORT || 8790), '127.0.0.1', () => console.log('Onboarding service listening on loopback.'));
  return server;
}
if (require.main === module) main().catch(() => { console.error('Onboarding service could not start; check configuration.'); process.exitCode = 1; });
module.exports = { createOnboardingServer, main };
