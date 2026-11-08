const { isCallId } = require("./recommendation-calls");

const privateRoutes = new Set([
  "/v1/deals/purchases",
  "/v1/deals/candidates",
  "/v1/deals/events",
]);
const isDealsRoute = (pathname) =>
  /^\/v1\/deals\/[a-zA-Z0-9/_-]+$/.test(pathname) &&
  !privateRoutes.has(pathname.replace(/\/+$/, ""));

function createDealsGateway(env, fetchImpl) {
  if (!env.DEALS_API_URL || Buffer.byteLength(env.DEALS_AUTH_SECRET ?? "") < 32)
    return null;
  const origin = new URL(env.DEALS_API_URL);
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
      ))
  ) {
    throw new Error(
      "Set DEALS_API_URL to a trusted HTTPS origin or local Deals service.",
    );
  }
  const secret = new TextEncoder().encode(env.DEALS_AUTH_SECRET);
  async function ownerToken(ownerId, scope) {
    if (!isCallId(ownerId)) throw new Error("invalid_deals_owner");
    const { SignJWT } = await import("jose");
    return new SignJWT({ scope })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ownerId)
      .setIssuer(env.DEALS_AUTH_ISSUER || "nessiessential")
      .setAudience(env.DEALS_AUTH_AUDIENCE || "nessiessential-api")
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(secret);
  }
  async function request(
    ownerId,
    path,
    method = "GET",
    body,
    scope = "deals:user",
  ) {
    const response = await fetchImpl(new URL(path, origin), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (await ownerToken(ownerId, scope)),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw Object.assign(new Error("deals_unavailable"), {
        code: "deals_http_" + response.status,
        status: 502,
      });
    return response.json();
  }
  return {
    request,
    provision: (owner) =>
      request(
        owner.id,
        "/internal/v1/owners",
        "POST",
        {
          id: owner.id,
          timezone: owner.time_zone,
          syntheticPerson: owner.is_synthetic_person,
          firstName: owner.first_name,
        },
        "deals:provision",
      ),
    catalog: (ownerId) => request(ownerId, "/v1/deals/programs"),
    status: async (ownerId) => {
      const s = await request(ownerId, "/v1/deals/status");
      return {
        ...s,
        consented: !!s.profile?.consent_at && !s.profile?.revoked_at,
      };
    },
    enroll: (ownerId, programId) =>
      request(ownerId, "/v1/deals/enrollments", "POST", {
        programId,
        existingMembership: "unknown",
        intent: "loyalty_and_promotions",
        initiation: "store_selection",
      }),
    purchases: (ownerId, rows) =>
      request(
        ownerId,
        "/v1/deals/purchases",
        "POST",
        {
          purchases: rows.map((r) => ({
            transactionId: r.id,
            merchantId: r.brand_key,
            ...(r.merchant_id ? { branchId: r.merchant_id } : {}),
            occurredAt: r.occurred_at,
            status: r.reversed_cents >= r.amount_cents ? "refunded" : "posted",
            provenance:
              r.provenance === "synthetic_persona"
                ? "synthetic_test"
                : "nessie_sandbox",
            sourceVersion: r.version || 1,
          })),
        },
        "deals:purchase",
      ),
    async proxy(
      path,
      method,
      headers,
      body,
      webhook = false,
      ownerId = env.DEALS_OWNER_ID,
    ) {
      const outbound = {
        "content-type": headers["content-type"] ?? "application/json",
      };
      if (webhook) {
        for (const key of [
          "webhook-id",
          "webhook-timestamp",
          "webhook-signature",
        ]) {
          if (typeof headers[key] === "string") outbound[key] = headers[key];
        }
      } else {
        outbound.authorization = `Bearer ${await ownerToken(ownerId, "deals:user")}`;
      }
      return fetchImpl(new URL(path, origin), {
        method,
        headers: outbound,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    },
  };
}

module.exports = { createDealsGateway, isDealsRoute };
