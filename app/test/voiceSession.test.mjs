// Tests for src/voice/voiceSession.ts: the pure parts of the in-app voice assistant. No network and
// no LiveKit: fetch is replaced with a fake. The server side of the same contract is tested in
// services/calls (tests/test_voice_routes.py, test_navigation.py, test_screen_context.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  ROUTES, tabForRoute, routeForTab, parseNavigatePayload, screenAttributes, captureScreenFacts, fetchVoiceSession,
} = await import('../src/voice/voiceSession.ts');

test('the allowed routes are exactly the four tabs of the app, same as the voice server', () => {
  assert.deepEqual([...ROUTES].sort(), ['account', 'deals', 'spending', 'upcoming']);
  for (const r of ROUTES) assert.equal(routeForTab(tabForRoute(r)), r);
});

test('tabForRoute only accepts known routes, whatever the server sends', () => {
  assert.equal(tabForRoute('deals'), 'Deals');
  assert.equal(tabForRoute('Account'), 'Account');
  for (const bad of ['settings', '', '../x', 'deals; drop', null, undefined, 5, {}]) assert.equal(tabForRoute(bad), null);
  assert.equal(routeForTab('Nope'), null);
});

test('parseNavigatePayload turns the agent RPC payload into a tab or null', () => {
  assert.equal(parseNavigatePayload('{"route": "spending"}'), 'Spending');
  for (const bad of ['', 'not json', '[]', '{"route": 5}', '{"route": "budgets"}', '{}']) assert.equal(parseNavigatePayload(bad), null);
});

test('screenAttributes publishes the page slug and the real section titles as a JSON string', () => {
  const a = screenAttributes('Spending');
  assert.equal(a.page, 'spending');
  assert.deepEqual(JSON.parse(a.visible), ['Current Spending', 'Spending by category', 'Budgets', 'Recent purchases']);
  assert.equal(screenAttributes('Deals').page, 'deals');
  assert.deepEqual(screenAttributes('Unknown'), {});
});

test('screenAttributes caps and cleans extra labels', () => {
  const labels = Array.from({ length: 12 }, (_, i) => ` item\n${i} ${'x'.repeat(60)} `);
  const visible = JSON.parse(screenAttributes('Deals', labels).visible);
  assert.equal(visible.length, 8);
  assert.ok(visible.every((l) => l.length <= 40 && !/[\n\r\t]/.test(l)));
});

test('captureScreenFacts keeps the first loaded facts for each tab', () => {
  const empty = {};
  assert.equal(captureScreenFacts(empty, 'Spending', []), empty);
  const spending = captureScreenFacts(empty, 'Spending', ['Spent this month: $27.00']);
  assert.equal(captureScreenFacts(spending, 'Spending', ['Spent this month: $31.00']), spending);
  const both = captureScreenFacts(spending, 'Deals', ['Active offers: 0']);
  assert.deepEqual(both, { spending: ['Spent this month: $27.00'], deals: ['Active offers: 0'] });
  assert.deepEqual(JSON.parse(screenAttributes('Spending', undefined, both.spending).facts), both.spending);
  assert.deepEqual(JSON.parse(screenAttributes('Deals', undefined, both.deals).facts), both.deals);
  assert.deepEqual(JSON.parse(screenAttributes('Account').facts), []);
});

test('screenAttributes bounds facts without sending partial facts', () => {
  const lines = ['   ', 'x'.repeat(161), ...Array.from({ length: 30 }, (_, i) => ` item\n${i} `)];
  assert.deepEqual(JSON.parse(screenAttributes('Deals', undefined, lines).facts), Array.from({ length: 24 }, (_, i) => `item ${i}`));
});

function fakeFetch(response, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return response;
  };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const session = { url: 'wss://x.livekit.cloud', token: 'jwt', room: 'app-voice-abc' };

test('fetchVoiceSession posts the user id with the API key header and returns the session', async () => {
  const calls = [];
  const got = await fetchVoiceSession({ baseUrl: 'http://10.0.0.5:8000/', apiKey: 'k', userId: 'alex', fetchImpl: fakeFetch(ok(session), calls) });
  assert.deepEqual(got, session);
  assert.equal(calls[0].url, 'http://10.0.0.5:8000/voice/session');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-api-key'], 'k');
  assert.deepEqual(JSON.parse(calls[0].init.body), { user_id: 'alex' });
});

test('fetchVoiceSession fails clearly and never puts the key in an error', async () => {
  const denied = fakeFetch({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(fetchVoiceSession({ baseUrl: 'http://h', apiKey: 'secret-key', userId: 'a', fetchImpl: denied }),
    (e) => /401/.test(e.message) && !e.message.includes('secret-key'));
  for (const body of [{}, { url: 'wss://x', token: 'jwt' }, { url: 5, token: 'a', room: 'b' }, null]) {
    await assert.rejects(fetchVoiceSession({ baseUrl: 'http://h', apiKey: 'k', userId: 'a', fetchImpl: fakeFetch(ok(body)) }), /unexpected/i);
  }
});

test('fetchVoiceSession rejects bad input before any network call', async () => {
  const calls = [];
  const f = fakeFetch(ok(session), calls);
  for (const args of [
    { baseUrl: '', apiKey: 'k', userId: 'a' }, { baseUrl: 'ftp://h', apiKey: 'k', userId: 'a' },
    { baseUrl: 'http://h', apiKey: '', userId: 'a' }, { baseUrl: 'http://h', apiKey: 'k', userId: 'a b' },
  ]) await assert.rejects(fetchVoiceSession({ ...args, fetchImpl: f }));
  assert.equal(calls.length, 0);
});

const { nextAction, isPopped, statusCaption } = await import('../src/voice/voiceSession.ts');

test('tapping Nessie: connect and listen when off, send when listening, interrupt otherwise', () => {
  assert.equal(nextAction('idle'), 'connect');
  assert.equal(nextAction('error'), 'connect');
  assert.equal(nextAction('connecting'), 'none');
  assert.equal(nextAction('ready'), 'start');
  assert.equal(nextAction('listening'), 'end');
  assert.equal(nextAction('thinking'), 'start'); // tapping while she thinks or speaks starts a new turn
  assert.equal(nextAction('speaking'), 'start');
});

test('Nessie is popped up exactly while the assistant is doing something', () => {
  for (const s of ['connecting', 'listening', 'thinking', 'speaking']) assert.equal(isPopped(s), true, s);
  for (const s of ['idle', 'ready', 'error']) assert.equal(isPopped(s), false, s);
});

test('every state has a caption, and only the idle-like ones are silent', () => {
  assert.equal(statusCaption('listening'), 'Listening…');
  assert.equal(statusCaption('thinking'), 'Thinking…');
  assert.equal(statusCaption('speaking'), 'Speaking…');
  assert.equal(statusCaption('connecting'), 'Connecting…');
  assert.equal(statusCaption('idle'), '');
  assert.equal(statusCaption('ready'), '');
});

const { applyReplyChunk, MAX_REPLY } = await import('../src/voice/voiceSession.ts');

test('streamed reply chunks of one segment add up to the sentence', () => {
  let r = null;
  for (const chunk of ['You have ', '$56.31 ', 'left.']) r = applyReplyChunk(r, 'seg1', chunk);
  assert.deepEqual(r, { segment: 'seg1', text: 'You have $56.31 left.' });
});

test('a new segment replaces the previous reply instead of piling up', () => {
  let r = applyReplyChunk(null, 'seg1', 'First answer.');
  r = applyReplyChunk(r, 'seg2', 'Second answer.');
  assert.deepEqual(r, { segment: 'seg2', text: 'Second answer.' });
});

test('a runaway reply is cut to the last MAX_REPLY characters', () => {
  const r = applyReplyChunk(null, 's', 'x'.repeat(MAX_REPLY + 50));
  assert.equal(r.text.length, MAX_REPLY);
});
