import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { DomainError } from "./db.js";
import type { Config } from "./config.js";
function key(config: Config) {
  if (
    !config.DEALS_AUTH_SECRET ||
    Buffer.byteLength(config.DEALS_AUTH_SECRET) < 32
  )
    throw new Error("DEALS_AUTH_SECRET must contain at least 32 bytes");
  return new TextEncoder().encode(config.DEALS_AUTH_SECRET);
}
export async function authenticate(
  header: string | undefined,
  config: Config,
  requiredScope = "deals:user",
): Promise<string> {
  if (!header?.startsWith("Bearer "))
    throw new DomainError("authentication_required", 401);
  try {
    const { payload } = await jwtVerify(header.slice(7), key(config), {
      algorithms: ["HS256"],
      issuer: config.DEALS_AUTH_ISSUER,
      audience: config.DEALS_AUTH_AUDIENCE,
      requiredClaims: ["sub", "exp", "iat"],
    });
    const owner = z.uuid().parse(payload.sub);
    if (
      typeof payload.scope !== "string" ||
      !payload.scope.split(" ").includes(requiredScope)
    )
      throw new DomainError("insufficient_scope", 403);
    return owner;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError("invalid_or_expired_token", 401);
  }
}
export async function issueToken(
  owner: string,
  config: Config,
  scope = "deals:user",
  expiresIn = "1h",
) {
  z.uuid().parse(owner);
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(owner)
    .setIssuer(config.DEALS_AUTH_ISSUER)
    .setAudience(config.DEALS_AUTH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key(config));
}
