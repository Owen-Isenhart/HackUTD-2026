const { dialRecommendationCall, inputVersions, isCallId, sameInputs } = require('./recommendation-calls');
const { inQuietHours, imessageEnabled, routineRegions, sendRecommendationMessage } = require('./location-alerts');
const { MAX_PROFILE_AGE_MS } = require('../src/routineOffers');

function createLocationDelivery({ env, calls, locations, destination, loadProfile, isRefreshFailed, refresh, recommend, fetchImpl }) {
  const channels = ['off'];
  if (env.ALERT_ALLOW_DEMO_CATALOG === '1') {
    if (destination) channels.push('call');
    if (imessageEnabled(env)) channels.push('imessage');
  }

  async function currentInputs(context) {
    const profile = await loadProfile();
    return !isRefreshFailed() && sameInputs(profile, context.inputs) && !inQuietHours(profile.timeZone)
      && Date.now() < Math.min(new Date(context.dispatchBefore).getTime(), Date.parse(profile.asOf) + MAX_PROFILE_AGE_MS);
  }

  async function stillEligible(context) {
    const settings = await locations.settings();
    return channels.includes(context.channel) && settings.channel === context.channel && settings.version === context.settingsVersion
      && await locations.isDeviceActive(context.deviceId) && await currentInputs(context);
  }

  let running;
  function run() {
    running ??= (async () => {
      for (const { id } of await calls.pending()) {
        const context = await calls.load(id);
        if (!context || context.state !== 'ready') continue;
        if (!await stillEligible(context) || !await calls.claim(id)) {
          await calls.discard(id);
          continue;
        }
        if (!await stillEligible(context)) {
          await calls.setDispatchState(id, 'failed');
          continue;
        }
        const result = context.channel === 'call'
          ? { state: await dialRecommendationCall(destination, context, env, fetchImpl) }
          : await sendRecommendationMessage(context, env, fetchImpl, () => stillEligible(context));
        await calls.setDispatchState(id, result.state, result.providerId);
      }
    })().catch(() => console.error('Location delivery worker failed.')).finally(() => { running = undefined; });
    return running;
  }

  async function locationEvent(body) {
    const settings = await locations.settings();
    if (settings.channel === 'off' || !channels.includes(settings.channel)) return { state: 'disabled' };
    const prior = await calls.load(body.eventId);
    if (prior) return prior.automatic && prior.deviceId === body.deviceId ? { state: prior.state, eventId: body.eventId } : { state: 'conflict' };
    const profile = await loadProfile();
    if (!profile || isRefreshFailed() || Date.now() >= Date.parse(profile.asOf) + MAX_PROFILE_AGE_MS) {
      refresh().catch(() => {});
      return { state: 'refresh_required' };
    }
    if (inQuietHours(profile.timeZone)) return { state: 'quiet_hours' };
    const now = Date.now();
    if (body.fix.timestamp > now + 3000) return { state: 'invalid_location' };
    const fix = { ...body.fix, timestamp: Math.min(body.fix.timestamp, now) };
    const { recommendation, callCandidates, reason } = await recommend(profile, { source: 'live', fix }, { env, fetchImpl });
    if (!recommendation || !callCandidates?.length) return { state: reason ?? 'no_recommendation' };
    if (!await currentInputs({ inputs: inputVersions(profile), dispatchBefore: recommendation.expiresAt })) return { state: 'refresh_required' };
    await calls.save({ profile, recommendation, candidates: callCandidates, id: body.eventId, settings, deviceId: body.deviceId });
    const saved = await calls.load(body.eventId);
    if (!saved?.automatic || saved.deviceId !== body.deviceId) return { state: 'conflict' };
    run();
    return { state: saved.state, eventId: body.eventId, recommendation };
  }

  return {
    channels,
    run,
    locationEvent,
    async prewarm() {
      const { channel } = await locations.settings();
      if (channels.includes(channel) && channel !== 'off') await refresh();
    },
    async regions() {
      const [profile, settings] = await Promise.all([loadProfile(), locations.settings()]);
      return {
        regions: profile && channels.includes(settings.channel) && settings.channel !== 'off' ? routineRegions(profile) : [],
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      };
    },
  };
}

function validLocationEvent(body) {
  const coords = body?.fix?.coords;
  return isCallId(body?.eventId) && isCallId(body?.deviceId) && body?.source === 'live'
    && body?.type === 'fix' && Number.isFinite(body?.fix?.timestamp)
    && [coords?.latitude, coords?.longitude, coords?.accuracy].every(Number.isFinite);
}

module.exports = { createLocationDelivery, validLocationEvent };
