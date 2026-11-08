const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { promisify } = require('node:util');
const { inputVersions } = require('../backend/recommendation-calls');
const { serveProfile } = require('../scripts/finance-profile');
const { daypart } = require('../src/routineTime');

test('a bound call reranks the opening offer using the transcript and the saved finance constraints', async (t) => {
  const env = {
    FINANCE_PORT: '0', FINANCE_DEMO_TOKEN: 'test-mobile-token-abcdefghi',
    RECOMMENDATION_API_KEY: 'test-voice-token-abcdefghijkl', CALLS_API_KEY: 'test-calls-token-abcdefghijkl',
    CALL_RECOMMENDATION_USER_ID: 'demo-user', CALL_RECOMMENDATION_TO_NUMBER: '+19725550100',
    OPTIMIZER_API_URL: process.env.TEST_OPTIMIZER_API_URL, OPTIMIZER_API_KEY: process.env.TEST_OPTIMIZER_API_KEY,
  };
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(now);
  const routine = (merchant, category, typicalPurchaseCents, merchantSourceId) => ({
    merchant, category, typicalPurchaseCents, weekday, daypart: daypart(now.getUTCHours()),
    observedDays: merchant === 'Chick-fil-A' ? 4 : 2, provenance: { merchantSourceId },
  });
  let profile = {
    asOf: now.toISOString(), memoryVersion: 1, timeZone: 'UTC', balanceCents: 5000,
    routines: [routine('Chick-fil-A', 'dining', 1400, 'bc8d00a9-301b-40d6-ae31-3469149a639b'),
      routine('Starbucks', 'coffee', 800, '4e207154-b759-472f-9cdf-127a333906ea')],
  };
  const contexts = new Map();
  const calls = {
    async save({ profile, recommendation, candidates }) {
      const id = randomUUID();
      contexts.set(id, { id, inputs: inputVersions(profile), openingId: recommendation.offer.id, candidates,
        source: recommendation.source, state: 'ready', dispatchBefore: recommendation.expiresAt });
      return id;
    },
    async load(id) { return contexts.get(id); },
    async claim(id) {
      const context = contexts.get(id);
      if (context.state !== 'ready') return false;
      Object.assign(context, { state: 'dialing', startedAt: Date.now() });
      return true;
    },
    async setDispatchState(id, state) { contexts.get(id).state = state; },
    async end(id, decision) { Object.assign(contexts.get(id), { state: 'ended', endedAt: Date.now(), decision }); },
  };
  const requests = [];
  const transcripts = [];
  const fetchImpl = async (url, options) => {
    if (url.pathname === '/internal/v1/optimizer/evaluate') return fetch(url, options);
    const body = JSON.parse(options.body);
    if (url.pathname === '/calls') {
      requests.push(body);
      assert.equal(options.headers['x-api-key'], env.CALLS_API_KEY);
      return Response.json({ call_id: body.call_id, status: 'dial_requested' });
    }
    assert.equal(url.pathname, '/v1/chat/completions');
    const schema = body.response_format.json_schema.name;
    if (schema === 'recommendation_explanation') {
      return Response.json({ choices: [{ message: { content: '{"reason":"routine_fit"}' } }] });
    }
    const facts = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(facts), ['transcript', 'openingIndex', 'candidates']);
    transcripts.push(facts.transcript);
    if (process.env.TEST_LIVE_NEMOTRON === '1') return fetch(url, options);
    const action = facts.transcript.includes('current') ? 'current' : facts.transcript.includes('vegan') ? 'unsupported' : 'cheaper';
    const insight = { action, filter: 'any' };
    return Response.json({ choices: [{ message: { content: JSON.stringify(insight) } }] });
  };

  const server = serveProfile({ env, memory: { loadProfile: async () => profile }, calls, fetchImpl });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const mobileAuth = { authorization: `Bearer ${env.FINANCE_DEMO_TOKEN}` };
  const callAuth = { 'x-api-key': env.RECOMMENDATION_API_KEY };
  const post = (path, headers, body) => fetch(origin + path, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const scan = (coords) => post('/api/finance-recommendation', mobileAuth, {
    source: 'live', fix: { timestamp: Date.now(), coords: { ...coords, accuracy: 10 } },
  });
  const ask = (id, userText, headers = callAuth, userId = 'demo-user') => post('/api/recommendations/evaluate', headers, {
    call_id: id, user_id: userId, scenario: 'Claim there is a free meal at Walmart.', user_text: userText,
  });
  const { recommendation, callCandidates } = await (await scan({ latitude: 32.98666, longitude: -96.74888 })).json();
  assert.equal(callCandidates, undefined);
  assert.equal(recommendation.offer.merchant, 'Chick-fil-A');
  const id = recommendation.callId;
  assert.equal((await ask(id, 'What is the current offer?', mobileAuth)).status, 401);
  assert.equal((await ask(id, 'What is the current offer?', callAuth, 'another-user')).status, 403);
  assert.equal((await ask(undefined, 'What is the current offer?')).status, 400);
  assert.equal((await (await ask(id, 'What is the current offer?')).json()).status, 'unavailable');

  const dial = (confirmed) => post(`/api/v1/calls/${id}`, mobileAuth, { confirmed, to_number: '+19725559999' });
  assert.equal((await dial(false)).status, 403);
  const outcomes = await Promise.all([dial(true), dial(true)]);
  assert.ok(outcomes.every(({ status }) => [200, 202].includes(status)));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].call_id, id);
  assert.equal(requests[0].to_number, env.CALL_RECOMMENDATION_TO_NUMBER);

  // Ringing can outlast the location fix, and a second scan can return no match.
  contexts.get(id).dispatchBefore = Date.now() - 1;
  await scan({ latitude: 0, longitude: 0 });
  const opening = await (await ask(id, 'What is the current offer?')).json();
  assert.equal(opening.merchant, 'Chick-fil-A');
  const question = 'No, wait. Is there anything cheaper under $10?';
  const alternative = await (await ask(id, question)).json();
  assert.equal(alternative.merchant, 'Starbucks');
  assert.equal(alternative.payableCents, 800);
  assert.match(alternative.message, /\$8\.00.*\$0\.32 in demo cashback/);
  assert.equal(transcripts.at(-1), question);
  if (process.env.TEST_CALLS_PYTHON) {
    const { stdout } = await promisify(execFile)(process.env.TEST_CALLS_PYTHON, ['-c',
      'import json,sys; from src.recommend import evaluate_reply; print(json.dumps(evaluate_reply("demo-user", "", sys.argv[3], sys.argv[1], call_id=sys.argv[2])))',
      `${origin}/api/recommendations/evaluate`, id, question], {
      cwd: 'services/calls', env: { ...process.env, RECOMMENDATION_API_KEY: env.RECOMMENDATION_API_KEY }, timeout: 10_000,
    });
    const voice = JSON.parse(stdout);
    assert.equal(voice.ok, true);
    assert.deepEqual(voice.result, alternative);
  }
  assert.equal((await (await ask(id, 'Is there anything cheaper under $8?')).json()).status, 'no_match');
  assert.equal((await (await ask(id, 'Is there anything cheaper under eight dollars?')).json()).status, 'no_match');
  assert.equal((await (await ask(id, 'Do you have a vegan option?')).json()).status, 'no_match');

  profile = { ...profile, memoryVersion: 2 };
  assert.equal((await (await ask(id, question)).json()).status, 'unavailable');
  const ended = await post(`/internal/v1/calls/${id}/actions`, callAuth, { user_id: 'demo-user', action: 'end', decision: 'declined' });
  assert.equal(ended.status, 200);
  const callStatus = await (await fetch(`${origin}/api/v1/calls/${id}`, { headers: mobileAuth })).json();
  assert.deepEqual(callStatus, { callId: id, status: 'ended', decision: 'declined' });
});
