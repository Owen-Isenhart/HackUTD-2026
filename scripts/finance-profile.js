const { timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');
const { buildFinanceProfile } = require('../backend/finance-profile');
const { recommendVisit } = require('../backend/recommendation');
const { createTigerPool, createTigerMemory, migrateTiger } = require('../backend/tiger-memory');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new Error('Expected JSON.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 4096) {
      req.resume();
      throw new Error('Request too large.');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validConfirmedMemory(body) {
  const budget = body?.budget;
  const validBudget = budget === null || (budget && ['week', 'month'].includes(budget.period)
    && Number.isSafeInteger(budget.limitCents) && budget.limitCents >= 0);
  return body?.confirmed === true && Number.isInteger(body.version) && body.version >= 0 && body.version < 2_147_483_647
    && validBudget && Array.isArray(body.goals) && body.goals.length <= 10
    && body.goals.every((goal) => typeof goal === 'string' && goal.trim().length > 0 && goal.length <= 160);
}

function serveProfile({ env = process.env, memory, buildProfile = buildFinanceProfile, recommend = recommendVisit } = {}) {
  const token = env.FINANCE_DEMO_TOKEN;
  if (!token || token.length < 24) throw new Error('Set FINANCE_DEMO_TOKEN to a random token of at least 24 characters.');
  const expected = Buffer.from(`Bearer ${token}`);
  const port = Number(env.FINANCE_PORT || 8787);
  let inFlight;
  let lastProfile;
  let refreshFailed = false;
  const loadProfile = () => memory ? memory.loadProfile() : lastProfile;

  async function refreshProfile() {
    let profile;
    try {
      profile = await buildProfile({ env });
    } catch (error) {
      refreshFailed = true;
      if (!memory) throw error;
      const saved = await loadProfile();
      if (!saved) throw error;
      return { ...saved, refreshStatus: 'cached' };
    }
    if (memory) {
      await memory.saveProfile(profile);
      profile = await memory.loadProfile();
      if (!profile) throw new Error('Saved finance profile is unavailable.');
    } else {
      lastProfile = { ...profile, memoryStorage: 'session' };
      profile = lastProfile;
    }
    refreshFailed = false;
    return profile;
  }

  const server = createServer(async (req, res) => {
    const profileRoute = req.method === 'GET' && req.url === '/api/finance-profile';
    const recommendationRoute = req.method === 'POST' && req.url === '/api/finance-recommendation';
    const memoryRoute = req.method === 'PUT' && req.url === '/api/finance-memory';
    if (!profileRoute && !recommendationRoute && !memoryRoute) {
      return sendJson(res, 404, { error: 'Not found.' });
    }
    const auth = Buffer.from(req.headers.authorization || '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      return sendJson(res, 401, { error: 'A valid demo token is required.' });
    }
    let body;
    if (!profileRoute) {
      try {
        body = await readJson(req);
      } catch {
        return sendJson(res, 400, { error: 'Expected a valid JSON request.' });
      }
    }
    try {
      if (profileRoute) {
        inFlight ??= refreshProfile().finally(() => { inFlight = undefined; });
        return sendJson(res, 200, await inFlight);
      }
      if (recommendationRoute) {
        const profile = await loadProfile();
        const usableProfile = profile && refreshFailed ? { ...profile, refreshStatus: 'cached' } : profile;
        const result = await recommend(usableProfile, body, { env });
        if (result.recommendation) {
          const latest = await loadProfile();
          if (refreshFailed || latest?.asOf !== profile.asOf || latest?.memoryVersion !== profile.memoryVersion) {
            return sendJson(res, 200, { recommendation: null, reason: 'refresh_required' });
          }
        }
        return sendJson(res, 200, result);
      }
      if (!memory) return sendJson(res, 503, { error: 'Tiger Data memory is unavailable.' });
      if (!validConfirmedMemory(body)) return sendJson(res, 400, { error: 'Supply an explicitly confirmed budget, goals and memory version.' });
      const budget = body.budget && { period: body.budget.period, limitCents: body.budget.limitCents };
      const confirmed = await memory.confirmMemory({ version: body.version, budget, goals: body.goals.map((goal) => goal.trim()) });
      return confirmed
        ? sendJson(res, 200, confirmed)
        : sendJson(res, 409, { error: 'Memory changed. Refresh the finance profile and try again.' });
    } catch (error) {
      console.error('Finance request failed.', /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : '');
      return sendJson(res, 502, { error: 'Finance data is unavailable. Check the backend terminal.' });
    }
  });
  server.on('error', (error) => {
    console.error(`Finance backend could not listen: ${error.code}.`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Finance backend listening on http://127.0.0.1:${server.address().port}/api/finance-profile`);
  });
  return server;
}

async function main() {
  if (process.argv[2] === '--migrate') {
    const pool = createTigerPool();
    try {
      await migrateTiger(pool);
      console.log('Tiger Data finance memory migration applied.');
    } finally {
      await pool.end();
    }
    return;
  }
  if (process.argv[2] === '--serve') {
    const memory = process.env.TIGER_DATA_URL
      ? createTigerMemory(createTigerPool(), process.env.NESSIE_ACCOUNT_ID)
      : undefined;
    serveProfile({ memory });
    return;
  }
  console.log(JSON.stringify(await buildFinanceProfile(), null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    const safeMessage = error.message.startsWith('Set ') ? error.message : error.code ?? error.name;
    console.error('Finance setup failed.', safeMessage);
    process.exitCode = 1;
  });
}

module.exports = { serveProfile };
