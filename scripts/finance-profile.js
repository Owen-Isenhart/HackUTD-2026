const { timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');
const { buildFinanceProfile } = require('../backend/finance-profile');
const { financeForecast } = require('../backend/finance-forecast');
const { recommendVisit } = require('../backend/recommendation');
const { evaluateCallRecommendation } = require('../backend/call-recommendation');
const { CALL_WINDOW_MS, UUID, isCallId, sameInputs, inputVersions, createCallContexts, callDestination, dialRecommendationCall } = require('../backend/recommendation-calls');
const { createLocationAlerts } = require('../backend/location-alerts');
const { createLocationDelivery, validLocationEvent } = require('../backend/location-delivery');
const { createDealsGateway, isDealsRoute } = require('../backend/deals-gateway');
const { createTigerPool, createTigerMemory, migrateTiger } = require('../backend/tiger-memory');
const { MAX_PROFILE_AGE_MS } = require('../src/routineOffers');
const { findGmailForwardingCode, parseTextEvent, ingestText, textConfig, verifyStandardWebhook } = require('../backend/photon-texts');
const { summarizeObligations, validUserEdit } = require('../backend/text-obligations');
const { createMemoryTextStore, createTigerTextStore } = require('../backend/text-store');
const { runTextCycle } = require('../backend/text-worker');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req, limit, encoding = 'utf8') {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      req.resume();
      throw new Error('Request too large.');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  return encoding ? raw.toString(encoding) : raw;
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new Error('Expected JSON.');
  return JSON.parse(await readBody(req, 4096));
}

function validConfirmedMemory(body) {
  const budget = body?.budget;
  const reserve = body?.reserveCents;
  const validBudget = budget === null || (budget && ['week', 'month'].includes(budget.period)
    && Number.isSafeInteger(budget.limitCents) && budget.limitCents >= 0);
  return body?.confirmed === true && Number.isInteger(body.version) && body.version >= 0 && body.version < 2_147_483_647
    && validBudget && (reserve == null || (Number.isSafeInteger(reserve) && reserve >= 0))
    && Array.isArray(body.goals) && body.goals.length <= 10
    && body.goals.every((goal) => typeof goal === 'string' && goal.trim().length > 0 && goal.length <= 160);
}

function matchesToken(value, expected) {
  const supplied = Buffer.from(value || '');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function serveProfile({ env = process.env, pool, memory, texts, calls, locations, readiness, buildProfile = buildFinanceProfile, recommend = recommendVisit, fetchImpl = fetch } = {}) {
  const token = env.FINANCE_DEMO_TOKEN;
  if ((token && token.length < 24) || (!token && !pool)) throw new Error('Set FINANCE_DEMO_TOKEN to a random token of at least 24 characters.');
  const expected = Buffer.from(`Bearer ${token || require('node:crypto').randomBytes(32).toString('hex')}`);
  const callUser = env.CALL_RECOMMENDATION_USER_ID?.trim();
  const callKey = env.RECOMMENDATION_API_KEY;
  const callEnabled = calls && /^[a-z0-9_.-]{1,64}$/i.test(callUser ?? '') && callKey?.length >= 24
    && callKey !== token && callKey !== env.CALLS_API_KEY;
  const callToken = callEnabled ? Buffer.from(callKey) : null;
  const destination = callEnabled && env.CALLS_API_KEY !== token && callDestination(env);
  const deals = createDealsGateway(env, fetchImpl);
  async function operatorAuthenticated(bearer){if(matchesToken(bearer,expected))return true;if(!pool||!env.FINANCE_OPERATOR_OWNER_ID)return false;const auth=await require('../backend/owners').resolveSession(pool,bearer);return auth?.ownerId===env.FINANCE_OPERATOR_OWNER_ID;}
  const plansForOwner=async ownerId=>{
    if(!texts||ownerId!==env.FINANCE_OPERATOR_OWNER_ID)return {};
    const summary=await textSummary();
    return {summary,obligations:[...(summary?.upcoming||[]),...(summary?.pendingClarifications||[])],pendingUnknownAmounts:summary?.unverifiedPendingCount||0};
  };
  const port = Number(env.FINANCE_PORT || 8787);
  let pipelineHttp, stopPipeline;
  if(pool){
    const {createNessieV2}=require('../backend/nessie-v2');
    const {createPipelineHttp}=require('../backend/pipeline-http');
    const {createStages}=require('../backend/pipeline-stages');
    const {startPipeline}=require('../backend/pipeline');
    const {createPipelineScheduler}=require('../backend/pipeline-scheduler');
    const nessie=createNessieV2({baseUrl:env.NESSIE_V2_BASE_URL,apiKey:env.NESSIE_V2_API_KEY,fetchImpl});
    pipelineHttp=createPipelineHttp({pool,nessie,deals,env,fetchImpl,plansForOwner,onRecommendation:async(ownerId,result)=>{
      if(ownerId===env.FINANCE_OPERATOR_OWNER_ID&&destination&&result.recommendation&&result.callCandidates?.length&&(result.recommendation.source==='live'||env.CALL_ALLOW_DEMO_LOCATION==='1')){
        const profile=await loadProfile();
        if(profile?.profileVersion!==result.recommendation.profileVersion||profile?.memoryVersion!==result.recommendation.memoryVersion)return {recommendation:null,reason:'refresh_required'};
        result.recommendation.callId=await calls.save({profile,recommendation:result.recommendation,candidates:result.callCandidates});
      }
      return result;
    }});
    stopPipeline=startPipeline(pool,createStages({nessie,env,deals,obligations:plansForOwner}),createPipelineScheduler(pool,nessie));
  }
  let inFlight;
  let lastProfile;
  let refreshFailed = false;
  let textStatus = texts ? { state: 'starting' } : { state: 'disabled' };
  const loadStoredProfile = async () => {
    if(pool&&env.FINANCE_OPERATOR_OWNER_ID){const d=await require('../backend/pipeline-data').loadOwnerData(pool,env.FINANCE_OPERATOR_OWNER_ID,new Date(),await plansForOwner(env.FINANCE_OPERATOR_OWNER_ID));if(d?.profile)return d.profile;}
    return memory ? memory.loadProfile() : lastProfile;
  };
  if(pool){const oldRecommend=recommend;recommend=(profile,body,options)=>profile?.schemaVersion===2?require('../backend/pipeline-recommendation').recommendPipeline(pool,profile.ownerId,body,{...options,deals,plansForOwner}):oldRecommend(profile,body,options);}
  const textSummary = async (timeZone = env.FINANCE_TIME_ZONE || 'America/Chicago', horizonDays = 30) => texts && summarizeObligations(await texts.store.listObligations(), {
    timeZone, horizonDays,
  });
  // Text-derived plans are stored apart from the Nessie snapshot so a refresh cannot overwrite them.
  async function loadProfile(horizonDays) {
    const profile = await loadStoredProfile();
    if (!profile || !texts) return profile;
    return { ...profile, socialObligations: await textSummary(profile.timeZone, horizonDays) };
  }
  const currentContext = async (context) => {
    const profile = await loadProfile();
    return !refreshFailed && sameInputs(profile, context.inputs) && Date.now() < Date.parse(profile.asOf) + MAX_PROFILE_AGE_MS;
  };
  const activeCall = (context) => context?.startedAt && !context.endedAt && context.channel !== 'imessage'
    && ['dialing', 'dial_requested', 'uncertain'].includes(context.state)
    && Date.now() < new Date(context.startedAt).getTime() + CALL_WINDOW_MS;

  let cycle;
  async function runTexts() {
    if (!texts) return textStatus;
    cycle ??= runTextCycle(texts.store, texts.cfg, { env })
      .then(async (result) => { textStatus = { state: 'ok', ...result, store: await texts.store.status() }; return textStatus; })
      .catch(() => { textStatus = { state: 'failed', at: new Date().toISOString() }; return textStatus; })
      .finally(() => { cycle = undefined; });
    return cycle;
  }

  async function refreshProfile() {
    if(pool&&env.FINANCE_OPERATOR_OWNER_ID){await require('../backend/pipeline').queueRun(pool,env.FINANCE_OPERATOR_OWNER_ID);return loadProfile();}
    let profile;
    try {
      profile = await buildProfile({ env, fetchImpl });
    } catch (error) {
      refreshFailed = true;
      if (!memory) throw error;
      const saved = await loadProfile();
      if (!saved) throw error;
      return { ...saved, refreshStatus: 'cached' };
    }
    if (memory) {
      await memory.saveProfile(profile);
      if (!await memory.loadProfile()) throw new Error('Saved finance profile is unavailable.');
    } else {
      lastProfile = { ...profile, memoryStorage: 'session' };
    }
    refreshFailed = false;
    return loadProfile();
  }

  const refresh = () => inFlight ??= refreshProfile().finally(() => { inFlight = undefined; });
  const delivery = locations && calls && createLocationDelivery({
    env, calls, locations, destination, loadProfile, isRefreshFailed: () => refreshFailed, refresh, recommend, fetchImpl,
  });

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { status: 'ok' });
    // Expo Go voice turns go to the calls service on this host's loopback, so the phone reaches
    // it through the same HTTPS origin. That service checks the user's finance session itself.
    if (req.method === 'POST' && req.url === '/api/v1/voice/turn') {
      if (!env.VOICE_TURN_URL) return sendJson(res, 404, { error: 'Not found.' });
      try {
        const body = await readBody(req, 8_000_000, null);
        const upstream = await fetchImpl(env.VOICE_TURN_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body, redirect: 'error', signal: AbortSignal.timeout(45_000),
        });
        res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' });
        return res.end(await upstream.text());
      } catch (error) {
        if (res.headersSent) return res.end();
        return sendJson(res, error.message === 'Request too large.' ? 413 : 502, { error: 'Voice service unavailable.' });
      }
    }
    if (req.method === 'GET' && req.url === '/ready') {
      let ready = false;
      try { ready = Boolean(await readiness?.()); } catch { /* report generic unavailability */ }
      return sendJson(res, ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' });
    }
    if(pipelineHttp && await pipelineHttp(req,res))return;
    const [pathname, query] = req.url.split('?', 2);
    const dealsHook = deals && req.method === 'POST' && req.url === '/webhooks/photon';
    const dealsRoute = deals && ['GET', 'POST', 'DELETE'].includes(req.method) && isDealsRoute(pathname);
    if (dealsHook || dealsRoute) {
      if (!dealsHook && !await operatorAuthenticated(req.headers.authorization)) return sendJson(res, 401, { error: 'Valid credentials are required.' });
      try {
        const body = req.method === 'POST' ? await readBody(req, dealsHook ? 262_144 : 65_536, null) : undefined;
        const response = await deals.proxy(req.url, req.method, req.headers, body?.length ? body : undefined, dealsHook);
        res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' });
        return res.end(await response.text());
      } catch (error) {
        if (!res.headersSent) return sendJson(res, error.message === 'Request too large.' ? 413 : 502, { error: 'Deals service unavailable.' });
        return res.end();
      }
    }
    if (req.method === 'POST' && req.url === '/webhooks/photon/texts') {
      if (!texts?.cfg.webhookSecret) return sendJson(res, 404, { error: 'Not found.' });
      try {
        const raw = await readBody(req, 262_144);
        const event = verifyStandardWebhook(raw, req.headers, texts.cfg.webhookSecret);
        const parsed = parseTextEvent(event, texts.cfg);
        // Other event types are acknowledged without storing anything.
        if (!parsed) return sendJson(res, 200, { accepted: false });
        const result = await ingestText(texts.store, texts.cfg, parsed.message, parsed.eventId);
        if (result.inserted) runTexts();
        return sendJson(res, 200, { accepted: result.accepted });
      } catch (error) {
        const status = error.status ?? (error.message === 'Request too large.' ? 413 : 500);
        if (status >= 500) console.error('Photon text webhook failed.', error.code ?? '');
        return sendJson(res, status, { error: status === 401 ? 'Invalid signature.' : 'Webhook rejected.' });
      }
    }
    const obligationEdit = req.method === 'PUT' && /^\/api\/text-obligations\/([0-9a-f-]{36})$/.exec(req.url ?? '');
    const obligationsRoute = req.method === 'GET' && req.url === '/api/text-obligations';
    const textSyncRoute = req.method === 'POST' && req.url === '/api/texts/sync';
    if (obligationEdit || obligationsRoute || textSyncRoute) {
      if (!await operatorAuthenticated(req.headers.authorization)) return sendJson(res, 401, { error: 'Valid credentials are required.' });
      if (!texts) return sendJson(res, 503, { error: 'Photon text ingestion is not configured.' });
      try {
        if (obligationsRoute) return sendJson(res, 200, { ...await textSummary(), ingestion: textStatus });
        if (textSyncRoute) return sendJson(res, 200, { ingestion: await runTexts(), ...await textSummary() });
        let body;
        try {
          body = await readJson(req);
        } catch {
          return sendJson(res, 400, { error: 'Expected a valid JSON request.' });
        }
        if (!validUserEdit(body)) {
          return sendJson(res, 400, { error: 'Supply confirmed: true, the current version, and either action "dismiss" or action "confirm" with amountCents and dueDate.' });
        }
        const edit = body.action === 'dismiss' ? { action: 'dismiss', version: body.version }
          : { action: 'confirm', version: body.version, amountCents: body.amountCents, dueDate: body.dueDate };
        const updated = await texts.store.editObligation(obligationEdit[1], edit);
        if (updated === undefined) return sendJson(res, 404, { error: 'Not found.' });
        if (updated === null) return sendJson(res, 409, { error: 'This plan changed. Refresh and try again.' });
        return sendJson(res, 200, { obligation: { id: updated.id, version: updated.version, status: updated.status }, ...await textSummary() });
      } catch (error) {
        console.error('Text obligation request failed.', /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : '');
        return sendJson(res, 502, { error: 'Text plans are unavailable. Check the backend terminal.' });
      }
    }
    const alertSettings = delivery && ['GET', 'PUT'].includes(req.method) && req.url === '/api/v1/settings';
    const deviceRegister = delivery && req.method === 'POST' && req.url === '/api/v1/devices';
    const deviceRevoke = delivery && req.method === 'DELETE' && new RegExp(`^/api/v1/devices/(${UUID})$`).exec(req.url);
    const regionsRoute = delivery && req.method === 'GET' && req.url === '/api/v1/location/regions';
    const locationEvent = delivery && req.method === 'POST' && req.url === '/api/v1/location/events';
    if (alertSettings || deviceRegister || deviceRevoke || regionsRoute || locationEvent) {
      if (!locationEvent && !await operatorAuthenticated(req.headers.authorization)) return sendJson(res, 401, { error: 'Valid credentials are required.' });
      let body;
      if (req.method === 'PUT' || locationEvent) {
        try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'Expected a valid JSON request.' }); }
      }
      try {
        if (locationEvent) {
          if (!validLocationEvent(body)) return sendJson(res, 400, { error: 'Expected a live fix, event ID and device ID.' });
          if (!await locations.authenticateDevice(body.deviceId, req.headers.authorization)) return sendJson(res, 401, { error: 'Valid device credentials are required.' });
          const result = await delivery.locationEvent(body);
          return sendJson(res, result.state === 'conflict' ? 409 : result.eventId ? 202 : 200, result);
        }
        if (regionsRoute) return sendJson(res, 200, await delivery.regions());
        if (deviceRegister) {
          if (!await loadProfile()) return sendJson(res, 409, { error: 'Load the finance profile first.' });
          return sendJson(res, 201, await locations.registerDevice());
        }
        if (deviceRevoke) {
          await locations.revokeDevice(deviceRevoke[1]);
          return sendJson(res, 200, { status: 'revoked' });
        }
        if (req.method === 'GET') return sendJson(res, 200, { ...await locations.settings(), channels: delivery.channels });
        if (!body || !delivery.channels.includes(body.channel) || body.confirmed !== true || !Number.isSafeInteger(body.version)
          || body.version < 0 || body.version >= 2_147_483_647) return sendJson(res, 400, { error: 'Supply an enabled channel, consent and current version.' });
        if (!await loadProfile()) return sendJson(res, 409, { error: 'Load the finance profile first.' });
        const saved = await locations.updateSettings(body.channel, body.version);
        return saved ? sendJson(res, 200, { ...saved, channels: delivery.channels }) : sendJson(res, 409, { error: 'Alert settings changed.' });
      } catch (error) {
        console.error('Location alert request failed.', /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : '');
        return sendJson(res, 503, { error: 'Location alerts are unavailable.' });
      }
    }
    const profileRoute = (req.method === 'GET' && req.url === '/api/finance-profile')
      || (req.method === 'POST' && req.url === '/api/v1/finance/sync');
    const financeRead = req.method === 'GET' && ['/api/v1/finance/transactions', '/api/v1/finance/forecast', '/api/v1/finance/memory'].includes(pathname);
    const recommendationRoute = req.method === 'POST' && req.url === '/api/finance-recommendation';
    const memoryRoute = req.method === 'PUT' && req.url === '/api/finance-memory';
    const callRoute = callEnabled && req.method === 'POST' && req.url === '/api/recommendations/evaluate';
    const callAction = callEnabled && req.method === 'POST' && new RegExp(`^/internal/v1/calls/(${UUID})/actions$`).exec(req.url);
    const callResource = callEnabled && ['GET', 'POST'].includes(req.method) && new RegExp(`^/api/v1/calls/(${UUID})$`).exec(req.url);
    if (!profileRoute && !financeRead && !recommendationRoute && !memoryRoute && !callRoute && !callAction && !callResource) {
      return sendJson(res, 404, { error: 'Not found.' });
    }
    if (callRoute || callAction ? !matchesToken(req.headers['x-api-key'], callToken) : !await operatorAuthenticated(req.headers.authorization)) {
      return sendJson(res, 401, { error: 'Valid credentials are required.' });
    }
    let body;
    if (req.method !== 'GET') {
      try {
        body = await readJson(req);
      } catch {
        return sendJson(res, 400, { error: 'Expected a valid JSON request.' });
      }
    }
    try {
      if (profileRoute) {
        const snapshot = await refresh();
        const { transactions, bankCashflow, ...profile } = snapshot;
        if (profile.timeZone) {
          const { projection, postedBillOutflows, ...summary } = financeForecast(snapshot);
          profile.forecastSummary = summary;
        }
        return sendJson(res, 200, profile);
      }
      if (financeRead) {
        const params = new URLSearchParams(query);
        const forecastRoute = pathname.endsWith('/forecast');
        const days = forecastRoute ? Number(params.get('days') ?? 30) : undefined;
        if (forecastRoute && (!Number.isInteger(days) || days < 1 || days > 90)) {
          return sendJson(res, 400, { error: 'Supply 1 to 90 days.' });
        }
        const profile = await loadProfile(days === undefined ? undefined : days - 1);
        if (!profile) return sendJson(res, 409, { error: 'Load the finance profile first.' });
        if (pathname.endsWith('/memory')) return sendJson(res, 200, {
          version: profile.memoryVersion ?? 0, budget: profile.confirmedBudget ?? null, goals: profile.confirmedGoals ?? [],
          reserveCents: profile.confirmedReserveCents ?? null,
        });
        if (forecastRoute) {
          const snapshotAge = Date.now() - Date.parse(profile.asOf);
          const stale = !Number.isFinite(snapshotAge) || snapshotAge >= MAX_PROFILE_AGE_MS;
          const forecastProfile = refreshFailed || stale ? { ...profile, refreshStatus: 'cached' } : profile;
          const { postedBillOutflows, ...forecast } = financeForecast(forecastProfile, new Date(), days);
          return sendJson(res, 200, forecast);
        }
        if (!Array.isArray(profile.transactions)) return sendJson(res, 409, { error: 'Refresh the finance profile to load the ledger.' });
        const cursor = params.get('cursor');
        const limit = Number(params.get('limit') ?? 25);
        const start = cursor ? profile.transactions.findIndex(({ id }) => id === cursor) + 1 : 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor && start === 0)) {
          return sendJson(res, 400, { error: 'Supply a valid cursor and a limit of 1 to 100.' });
        }
        const page = profile.transactions.slice(start, start + limit);
        return sendJson(res, 200, { asOf: profile.asOf, source: profile.source, transactions: page,
          nextCursor: start + limit < profile.transactions.length ? page.at(-1).id : null });
      }
      if (callRoute) {
        if (body?.user_id !== callUser) return sendJson(res, 403, { error: 'Call user is not authorized.' });
        if (!isCallId(body.call_id) || typeof body.user_text !== 'string' || !body.user_text.trim() || body.user_text.length > 1000) {
          return sendJson(res, 400, { error: 'Supply the call ID and caller text of up to 1000 characters.' });
        }
        const unavailable = { status: 'unavailable', message: 'There is no current offer to share. Refresh the nearby recommendation in the app.' };
        const context = await calls.load(body.call_id);
        if (!activeCall(context) || !await currentContext(context)) return sendJson(res, 200, unavailable);
        const result = await evaluateCallRecommendation({ ...context, userText: body.user_text }, { env, fetchImpl });
        const latest = await calls.load(body.call_id);
        return sendJson(res, 200, activeCall(latest) && await currentContext(latest) ? result : unavailable);
      }
      if (callAction) {
        if (body?.user_id !== callUser) return sendJson(res, 403, { error: 'Call user is not authorized.' });
        if (body.action !== 'end' || (body.decision != null && !['accepted', 'declined'].includes(body.decision))) {
          return sendJson(res, 400, { error: 'Invalid call action.' });
        }
        await calls.end(callAction[1], body.decision ?? null);
        return sendJson(res, 200, { status: 'ended' });
      }
      if (callResource) {
        const id = callResource[1];
        const context = await calls.load(id);
        if (!context) return sendJson(res, 404, { error: 'Unknown recommendation.' });
        const status = () => ({ callId: id, status: context.state, decision: context.decision ?? null });
        if (req.method === 'GET' || context.state !== 'ready') return sendJson(res, 200, status());
        if (context.automatic) return sendJson(res, 409, { error: 'Automatic delivery is already queued.' });
        if (!destination) return sendJson(res, 503, { error: 'Recommendation calls are disabled.' });
        if (body?.confirmed !== true || (context.source === 'demo' && env.CALL_ALLOW_DEMO_LOCATION !== '1')) {
          return sendJson(res, 403, { error: 'Call consent is required, and this location source must be enabled.' });
        }
        if (new Date(context.dispatchBefore).getTime() <= Date.now() || !await currentContext(context)) {
          return sendJson(res, 409, { error: 'The recommendation expired. Check your location again.' });
        }
        if (!await calls.claim(id)) {
          const latest = await calls.load(id);
          if (latest && latest.state !== 'ready') return sendJson(res, 200, { callId: id, status: latest.state });
          return sendJson(res, 429, { error: 'A call was recently requested or this visit expired.' });
        }
        if (!await currentContext(context) || new Date(context.dispatchBefore).getTime() <= Date.now()) {
          await calls.setDispatchState(id, 'failed');
          return sendJson(res, 409, { error: 'The recommendation expired. Check your location again.' });
        }
        const state = await dialRecommendationCall(destination, context, env, fetchImpl);
        await calls.setDispatchState(id, state);
        return sendJson(res, state === 'failed' ? 502 : 202, { callId: id, status: state });
      }
      if (recommendationRoute) {
        const profile = await loadProfile();
        const usableProfile = profile && refreshFailed ? { ...profile, refreshStatus: 'cached' } : profile;
        const { callCandidates, ...result } = await recommend(usableProfile, body, { env, fetchImpl });
        if (result.recommendation) {
          const latest = await loadProfile();
          if (refreshFailed || !sameInputs(latest, inputVersions(profile))) {
            return sendJson(res, 200, { recommendation: null, reason: 'refresh_required' });
          }
          if (destination && callCandidates?.length && (result.recommendation.source === 'live' || env.CALL_ALLOW_DEMO_LOCATION === '1')) {
            const id = await calls.save({ profile, recommendation: result.recommendation, candidates: callCandidates });
            result.recommendation = { ...result.recommendation, callId: id };
          }
        }
        return sendJson(res, 200, result);
      }
      if (!memory) return sendJson(res, 503, { error: 'Tiger Data memory is unavailable.' });
      if (!validConfirmedMemory(body)) return sendJson(res, 400, { error: 'Supply an explicitly confirmed budget, goals and memory version, and a valid reserve if supplied.' });
      const budget = body.budget && { period: body.budget.period, limitCents: body.budget.limitCents };
      const confirmed = await memory.confirmMemory({ version: body.version, budget, goals: body.goals.map((goal) => goal.trim()), reserveCents: body.reserveCents });
      return confirmed
        ? sendJson(res, 200, confirmed)
        : sendJson(res, 409, { error: 'Memory changed. Refresh the finance profile and try again.' });
    } catch (error) {
      console.error('Finance request failed.', /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : '');
      return sendJson(res, 502, { error: 'Finance data is unavailable. Check the backend terminal.' });
    }
  });
  if(stopPipeline)server.on('close',stopPipeline);
  server.on('error', (error) => {
    console.error(`Finance backend could not listen: ${error.code}.`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Finance backend listening on http://127.0.0.1:${server.address().port}/api/finance-profile`);
  });
  if (texts && texts.cfg.pollSeconds > 0) {
    const timer = setInterval(runTexts, texts.cfg.pollSeconds * 1000);
    timer.unref();
    server.on('close', () => clearInterval(timer));
    runTexts();
  }
  if ((callEnabled || delivery) && calls.prune) {
    const prune = () => calls.prune().catch(() => console.error('Expired recommendation call cleanup failed.'));
    const timer = setInterval(prune, 60 * 60_000);
    timer.unref();
    server.on('close', () => clearInterval(timer));
  }
  if (delivery && delivery.channels.length > 1) {
    const warm = () => delivery.prewarm().catch(() => console.error('Scheduled finance refresh failed.'));
    const deliveryTimer = setInterval(delivery.run, 2000);
    const refreshTimer = setInterval(warm, 10 * 60_000);
    deliveryTimer.unref();
    refreshTimer.unref();
    server.on('close', () => { clearInterval(deliveryTimer); clearInterval(refreshTimer); });
    warm();
  }
  return server;
}

function createTexts(pool, env = process.env) {
  const cfg = textConfig(env);
  if (!cfg.enabled) return undefined;
  cfg.pollSeconds = Number(env.PHOTON_TEXT_POLL_SECONDS ?? 60);
  const store = pool
    ? createTigerTextStore(pool, { ownerId: env.FINANCE_OPERATOR_OWNER_ID || env.NESSIE_ACCOUNT_ID, projectId: cfg.projectId })
    : createMemoryTextStore();
  return { cfg, store };
}

async function main() {
  if (process.argv[2] === '--migrate') {
    const pool = createTigerPool();
    try {
      await migrateTiger(pool);
      console.log('Tiger Data finance memory and text migrations applied.');
    } finally {
      await pool.end();
    }
    return;
  }
  if (process.argv[2] === '--gmail-code') {
    const cfg = textConfig();
    if (!cfg.apiKey || cfg.emailAddresses.size === 0) throw new Error('Set PHOTON_API_KEY, PHOTON_PROJECT_ID and PHOTON_FINANCE_EMAIL_ADDRESSES.');
    const found = await findGmailForwardingCode(cfg);
    console.log(found
      ? `Gmail forwarding confirmation code for ${found.alias}: ${found.code} (received ${found.receivedAt}). Enter it in Gmail > Settings > Forwarding and POP/IMAP.`
      : 'No Gmail forwarding confirmation email in the last 3 days. Add the alias in Gmail first, then run this again after a minute.');
    return;
  }
  const pool = process.env.TIGER_DATA_URL ? createTigerPool() : undefined;
  if (process.argv[2] === '--serve') {
    const operator=process.env.FINANCE_OPERATOR_OWNER_ID || process.env.NESSIE_ACCOUNT_ID;
    const memory = pool && operator && createTigerMemory(pool, operator);
    const calls = pool && operator && createCallContexts(pool, operator);
    const locations = pool && operator && createLocationAlerts(pool, operator);
    const readiness = pool && (async () => {
      const { rows: [row] } = await pool.query(`SELECT to_regclass('hackutd_finance.profile') IS NOT NULL
        AND to_regclass('hackutd_finance.location_device') IS NOT NULL AS ready`);
      return row?.ready;
    });
    serveProfile({ pool, memory, texts: createTexts(pool), calls, locations, readiness });
    return;
  }
  if (process.argv[2] === '--texts-sync') {
    const texts = createTexts(pool);
    if (!texts) throw new Error('Set PHOTON_PROJECT_ID and PHOTON_TEXT_OWNER_HANDLES or PHOTON_FINANCE_EMAIL_ADDRESSES.');
    try {
      const result = await runTextCycle(texts.store, texts.cfg);
      const summary = summarizeObligations(await texts.store.listObligations(), { timeZone: process.env.FINANCE_TIME_ZONE });
      // Counts and amounts only; message text and evidence stay out of the terminal.
      console.log(JSON.stringify({
        ...result,
        store: await texts.store.status(),
        committedCents: summary.committedCents,
        reservedPendingCents: summary.reservedPendingCents,
        unverifiedPendingCount: summary.unverifiedPendingCount,
        upcoming: summary.upcoming.length,
        pendingClarifications: summary.pendingClarifications.length,
      }, null, 2));
    } finally {
      await pool?.end();
    }
    return;
  }
  const { transactions, bankCashflow, ...profile } = await buildFinanceProfile();
  console.log(JSON.stringify(profile, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    const safeMessage = error.message.startsWith('Set ') ? error.message : error.code ?? error.name;
    console.error('Finance setup failed.', safeMessage);
    process.exitCode = 1;
  });
}

module.exports = { serveProfile };
