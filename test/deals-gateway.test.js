const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const { serveProfile } = require('../scripts/finance-profile');

test('the Deals gateway exchanges mobile auth for an owner scope and preserves signed webhook bytes', async (t) => {
  const env = { FINANCE_PORT: '0', FINANCE_DEMO_TOKEN: 'gateway-mobile-token-for-tests',
    DEALS_API_URL: 'http://127.0.0.1:3001', DEALS_AUTH_SECRET: 'gateway-test-secret-with-more-than-32-bytes',
    DEALS_OWNER_ID: 'ac72544b-ad03-4139-af1b-d44ffb68e84d' };
  const { jwtVerify } = await import('jose');
  const calls = [];
  const server = serveProfile({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.pathname === '/webhooks/photon') return new Response(null, { status: 204 });
    const token = options.headers.authorization.slice('Bearer '.length);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.DEALS_AUTH_SECRET), {
      issuer: 'nessiessential', audience: 'nessiessential-api', algorithms: ['HS256'],
    });
    assert.equal(payload.sub, env.DEALS_OWNER_ID);
    assert.equal(payload.scope, 'deals:user');
    return Response.json({ status: 'ready' });
  } });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/v1/deals/status`)).status, 401);
  const headers = { authorization: `Bearer ${env.FINANCE_DEMO_TOKEN}` };
  assert.equal((await fetch(`${origin}/v1/deals/status`, { headers })).status, 200);
  assert.equal((await fetch(`${origin}/v1/deals/candidates`, { method: 'POST', headers })).status, 404);

  const body = '{"content":"cafés"}\n';
  const signature = { 'content-type': 'application/json', 'webhook-id': 'event-1', 'webhook-timestamp': '1', 'webhook-signature': 'v1,test' };
  assert.equal((await fetch(`${origin}/webhooks/photon`, { method: 'POST', headers: signature, body })).status, 204);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].options.headers, signature);
  assert.deepEqual(calls[1].options.body, Buffer.from(body));
});


test('pipeline gateway provisions and signs each request for its own owner and scope',async()=>{
 const {createDealsGateway}=require('../backend/deals-gateway');const {decodeJwt}=await import('jose');const seen=[];
 const gateway=createDealsGateway({DEALS_API_URL:'http://127.0.0.1:3001',DEALS_AUTH_SECRET:'x'.repeat(40)},async(url,init)=>{seen.push({url,init,jwt:decodeJwt(init.headers.Authorization.slice(7))});return Response.json({});});
 const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
 await gateway.provision({id:a,time_zone:'America/Chicago',is_synthetic_person:true,first_name:'Alex'});await gateway.enroll(b,'chipotle_rewards');
 assert.equal(seen[0].jwt.sub,a);assert.equal(seen[0].jwt.scope,'deals:provision');assert.equal(seen[1].jwt.sub,b);assert.equal(JSON.parse(seen[1].init.body).initiation,'store_selection');
});
