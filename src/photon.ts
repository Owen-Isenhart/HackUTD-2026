import official from "./contracts/photon-email-2026-07-01.json" with { type: "json" };
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { z } from "zod";
import { Webhook } from "standardwebhooks";
import type pg from "pg";
import type { Config } from "./config.js";
import { required } from "./config.js";
import { DomainError, enqueue, tenant, type Tx } from "./db.js";
import { digest, sanitizeHtml } from "./extraction.js";

const ajv = new Ajv2020({
  strict: false,
  allErrors: false,
  validateFormats: true,
});
// ajv-formats ships a CJS-compatible default.
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const validateEvent = ajv.compile<{
  id: string;
  data: { projectId: string; object: unknown };
}>(official);
const validateMessage = ajv.compile({
  ...official,
  $ref: "#/$defs/ReceivedEmailMessage",
});
const user = z
  .object({
    projectId: z.string(),
    platform: z.literal("email"),
    id: z.string(),
    handle: z.string(),
  })
  .passthrough();
const content: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      type: z.string(),
      text: z.string().optional(),
      format: z.string().optional(),
      parts: z.array(content).max(100).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
);
const messageShape = z
  .object({
    id: z.string(),
    projectId: z.string(),
    platform: z.literal("email"),
    status: z.literal("received"),
    sentBy: user,
    receivedBy: user.optional(),
    addressedTo: user.optional(),
    content,
    timestamps: z.object({ receivedAt: z.iso.datetime() }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    space: z
      .object({
        projectId: z.string(),
        details: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();
export type PhotonMessage = z.infer<typeof messageShape>;
export function parseEmailMessage(
  input: unknown,
  projectId: string,
): PhotonMessage {
  if (!validateMessage(input))
    throw new DomainError("unsupported_photon_email_schema");
  const m = messageShape.parse(input);
  if (
    m.projectId !== projectId ||
    m.space.projectId !== projectId ||
    m.sentBy.projectId !== projectId ||
    (m.receivedBy && m.receivedBy.projectId !== projectId) ||
    (m.addressedTo && m.addressedTo.projectId !== projectId)
  )
    throw new DomainError("photon_project_mismatch");
  return m;
}
export function verifyEvent(
  raw: string,
  headers: Record<string, string>,
  cfg: Config,
) {
  const secret = required(cfg.PHOTON_WEBHOOK_SECRET, "PHOTON_WEBHOOK_SECRET");
  let event: any;
  try {
    event = new Webhook(secret).verify(raw, headers);
  } catch {
    throw new DomainError("invalid_webhook_signature");
  }
  if (!validateEvent(event))
    throw new DomainError("unsupported_photon_event_schema");
  if (event.id !== headers["webhook-id"])
    throw new DomainError("webhook_id_mismatch");
  if (event.data.projectId !== cfg.PHOTON_PROJECT_ID)
    throw new DomainError("photon_project_mismatch");
  return {
    eventId: event.id as string,
    message: parseEmailMessage(event.data.object, cfg.PHOTON_PROJECT_ID!),
  };
}
export function recipientFor(m: PhotonMessage, domain: string): string {
  // Visible To/Cc/space participants are not delivery evidence. Never guess ownership from them.
  const delivered = m.receivedBy?.handle;
  if (!delivered) throw new DomainError("recipient_delivery_evidence_missing");
  const address = delivered.toLowerCase();
  if (
    !z.email().safeParse(address).success ||
    address.split("@")[1] !== domain.toLowerCase()
  )
    throw new DomainError("unrecognized_recipient");
  return address;
}
export function emailBody(m: PhotonMessage): {
  text: string;
  subject: string;
  unreadable: boolean;
} {
  const texts: string[] = [],
    subjects: string[] = [];
  let unreadable = false;
  function part(c: any, depth = 0) {
    if (depth > 4) {
      unreadable = true;
      return;
    }
    const email = c.metadata?.email;
    if (typeof email?.subject === "string")
      subjects.push(email.subject.slice(0, 500));
    if (c.type === "group") {
      for (const p of c.parts ?? []) part(p, depth + 1);
      return;
    }
    if (c.type === "text") {
      const text =
        c.format === "html" ? sanitizeHtml(c.text ?? "") : String(c.text ?? "");
      // originalHtml is an alternative, not another offer. Prefer the canonical text.
      texts.push(
        text ||
          (typeof email?.originalHtml === "string"
            ? sanitizeHtml(email.originalHtml)
            : ""),
      );
    } else unreadable = true;
  }
  part(m.content);
  const unique = [
    ...new Set(
      texts.map((t) => t.replace(/\r\n/g, "\n").trim()).filter(Boolean),
    ),
  ];
  // Canonical group parts may be distinct offers; duplicate alternatives collapse by fingerprint later.
  const text = unique.join("\n\n").slice(0, 100_000);
  return { text, subject: subjects[0] ?? "", unreadable: unreadable || !text };
}
export async function ingestEmail(
  tx: Tx,
  owner: string,
  m: PhotonMessage,
  eventId: string,
) {
  const allowed = await tx.query(
    `SELECT o.revoked_at,i.disabled_at FROM deals.owner o JOIN deals.identity i ON i.owner_id=o.id
    WHERE o.id=$1 AND i.project_id=$2 AND i.address=$3 FOR UPDATE OF o`,
    [owner, m.projectId, m.receivedBy?.handle.toLowerCase()],
  );
  if (
    !allowed.rows[0] ||
    allowed.rows[0].revoked_at ||
    allowed.rows[0].disabled_at
  )
    return { accepted: false };
  const body = emailBody(m),
    hash = digest(body.text);
  const inserted = await tx.query(
    `INSERT INTO deals.message(owner_id,project_id,provider_id,sender,received_at,subject,sanitized_text,content_hash,purge_at,trust)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '7 days',$9)
    ON CONFLICT(owner_id,project_id,provider_id) DO NOTHING RETURNING id`,
    [
      owner,
      m.projectId,
      m.id,
      m.sentBy.handle.toLowerCase(),
      m.timestamps.receivedAt,
      body.subject,
      body.text,
      hash,
      JSON.stringify({
        authentication: "unavailable_in_verified_contract",
        unreadable: body.unreadable,
        transport: "photon",
      }),
    ],
  );
  const id =
    inserted.rows[0]?.id ??
    (
      await tx.query(
        "SELECT id FROM deals.message WHERE owner_id=$1 AND project_id=$2 AND provider_id=$3",
        [owner, m.projectId, m.id],
      )
    ).rows[0].id;
  await tx.query(
    `INSERT INTO deals.delivery(owner_id,project_id,event_id,message_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [owner, m.projectId, eventId, id],
  );
  if (inserted.rowCount)
    await enqueue(tx, owner, "extract", id, { messageId: id });
  return { accepted: true };
}
export async function routeAndIngest(
  pool: pg.Pool,
  cfg: Config,
  m: PhotonMessage,
  eventId: string,
  expectedOwner?: string,
) {
  const address = recipientFor(m, cfg.PHOTON_EMAIL_DOMAIN);
  const route = await pool.query(
    "SELECT deals.route_identity($1,$2) AS owner",
    [m.projectId, address],
  );
  const owner = route.rows[0]?.owner;
  // Unknown aliases are ignored with a generic acknowledgement; no cross-owner content is retained.
  if (!owner || (expectedOwner && expectedOwner !== owner))
    return { accepted: false };
  return tenant(pool, owner, (tx) => ingestEmail(tx, owner, m, eventId));
}
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
    public retryAfterSeconds = 0,
  ) {
    super(code);
  }
}
export class PhotonClient {
  constructor(
    private cfg: Config,
    private transport: typeof fetch = fetch,
  ) {}
  async request(path: string, init: RequestInit = {}): Promise<any> {
    const base = new URL(this.cfg.PHOTON_API_BASE_URL);
    if (base.origin !== "https://api.photon.codes")
      throw new ProviderError("photon_origin_not_allowed", false);
    const response = await this.transport(new URL(path, base), {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${required(this.cfg.PHOTON_API_KEY, "PHOTON_API_KEY")}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after") ?? 0);
      throw new ProviderError(
        `photon_http_${response.status}`,
        response.status === 429 || response.status >= 500,
        Number.isFinite(retry) ? Math.min(3600, Math.max(0, retry)) : 0,
      );
    }
    const data = await response.text();
    if (data.length > 5_000_000)
      throw new ProviderError("photon_response_too_large", false);
    return JSON.parse(data);
  }
  listMessages(query: Record<string, string>) {
    return this.request(
      `/v1/projects/${required(this.cfg.PHOTON_PROJECT_ID, "PHOTON_PROJECT_ID")}/messages?${new URLSearchParams(query)}`,
    );
  }
}

/** Resumable, fixed-window pagination. Empty pages with nextPageToken must be followed. */
export async function reconcileOwner(
  pool: pg.Pool,
  cfg: Config,
  owner: string,
  client = new PhotonClient(cfg),
  now = new Date(),
) {
  const source = await tenant(pool, owner, async (tx) => {
    const r = await tx.query(
      `SELECT s.*,o.revoked_at FROM deals.source s JOIN deals.owner o ON s.owner_id=o.id
      WHERE s.owner_id=$1 AND s.product='photon_email'`,
      [owner],
    );
    return r.rows[0];
  });
  if (!source || source.revoked_at || source.status === "revoked") return;
  // Delay the upper watermark for eventual consistency; use a full-day overlap every run.
  const cursor = source.cursor ?? {};
  const start =
    cursor.windowStart ??
    (source.last_success_at
      ? new Date(
          new Date(source.last_success_at).getTime() - 86400_000,
        ).toISOString()
      : new Date(0).toISOString());
  const end =
    cursor.windowEnd ?? new Date(now.getTime() - 120_000).toISOString();
  let token = cursor.pageToken as string | undefined;
  for (let page = 0; page < 100; page++) {
    const query: Record<string, string> = {
      platform: "email",
      direction: "received",
      order: "asc",
      orderBy: "updated_at",
      updatedSince: start,
      updatedBefore: end,
      pageSize: "100",
    };
    if (token) query.pageToken = token;
    const data = await client.listMessages(query);
    if (!Array.isArray(data.items))
      throw new ProviderError("photon_invalid_page", false);
    for (const input of data.items) {
      const m = parseEmailMessage(
        input,
        required(cfg.PHOTON_PROJECT_ID, "PHOTON_PROJECT_ID"),
      );
      await routeAndIngest(pool, cfg, m, `reconcile:${m.id}`, owner);
    }
    token = data.nextPageToken;
    if (
      token !== undefined &&
      (typeof token !== "string" || token.length > 4096)
    )
      throw new ProviderError("photon_invalid_cursor", false);
    await tenant(pool, owner, async (tx) => {
      await tx.query(
        `UPDATE deals.source SET cursor=$2,status=$3,reason=NULL,last_success_at=CASE WHEN $4 THEN $5 ELSE last_success_at END,updated_at=now()
        WHERE owner_id=$1 AND product='photon_email' AND status<>'revoked'`,
        [
          owner,
          JSON.stringify(
            token
              ? { windowStart: start, windowEnd: end, pageToken: token }
              : {},
          ),
          token ? "syncing" : "ready",
          !token,
          end,
        ],
      );
    });
    if (!token) return;
  }
  // Cursor persisted; bounded next job continues this window instead of claiming completeness.
  throw new ProviderError("photon_sync_window_incomplete", true);
}
