const { timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');
const { buildFinanceProfile } = require('../backend/finance-profile');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function serveProfile() {
  const token = process.env.FINANCE_DEMO_TOKEN;
  if (!token || token.length < 24) throw new Error('Set FINANCE_DEMO_TOKEN to a random token of at least 24 characters.');
  const expected = Buffer.from(`Bearer ${token}`);
  const port = Number(process.env.FINANCE_PORT || 8787);
  let inFlight;
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url !== '/api/finance-profile') {
      return sendJson(res, 404, { error: 'Not found.' });
    }
    const auth = Buffer.from(req.headers.authorization || '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      return sendJson(res, 401, { error: 'A valid demo token is required.' });
    }
    inFlight ??= buildFinanceProfile().finally(() => { inFlight = undefined; });
    try {
      return sendJson(res, 200, await inFlight);
    } catch (error) {
      console.error(error.message);
      return sendJson(res, 502, { error: 'Could not refresh the finance profile. Check the backend terminal.' });
    }
  });
  server.on('error', (error) => {
    console.error(`Finance backend could not listen: ${error.code}.`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Finance backend listening on http://127.0.0.1:${port}/api/finance-profile`);
  });
}

async function main() {
  if (process.argv[2] === '--serve') {
    serveProfile();
    return;
  }
  console.log(JSON.stringify(await buildFinanceProfile(), null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
