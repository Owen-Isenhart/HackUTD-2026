const { isCallId } = require('./recommendation-calls');

const privateRoutes = new Set(['/v1/deals/purchases', '/v1/deals/candidates', '/v1/deals/events']);
const isDealsRoute = (pathname) => /^\/v1\/deals\/[a-zA-Z0-9/_-]+$/.test(pathname) && !privateRoutes.has(pathname.replace(/\/+$/, ''));

function createDealsGateway(env, fetchImpl) {
  if (!env.DEALS_API_URL || !isCallId(env.DEALS_OWNER_ID) || Buffer.byteLength(env.DEALS_AUTH_SECRET ?? '') < 32) return null;
  const origin = new URL(env.DEALS_API_URL);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/'
    || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))) {
    throw new Error('Set DEALS_API_URL to a trusted HTTPS origin or local Deals service.');
  }
  const secret = new TextEncoder().encode(env.DEALS_AUTH_SECRET);
  async function ownerToken(scope) {
    const { SignJWT } = await import('jose');
    return new SignJWT({ scope }).setProtectedHeader({ alg: 'HS256' }).setSubject(env.DEALS_OWNER_ID)
      .setIssuer(env.DEALS_AUTH_ISSUER || 'nessiessential').setAudience(env.DEALS_AUTH_AUDIENCE || 'nessiessential-api')
      .setIssuedAt().setExpirationTime('30s').sign(secret);
  }
  return {
    async proxy(path, method, headers, body, webhook = false) {
      const outbound = { 'content-type': headers['content-type'] ?? 'application/json' };
      if (webhook) {
        for (const key of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
          if (typeof headers[key] === 'string') outbound[key] = headers[key];
        }
      } else {
        outbound.authorization = `Bearer ${await ownerToken('deals:user')}`;
      }
      return fetchImpl(new URL(path, origin), { method, headers: outbound, body, redirect: 'error', signal: AbortSignal.timeout(5000) });
    },
  };
}

module.exports = { createDealsGateway, isDealsRoute };
