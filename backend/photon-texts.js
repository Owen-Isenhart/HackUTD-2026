// Photon message ingestion for the finance profile: texts (SMS, iMessage) and
// email that the user forwards from Gmail, including Google Calendar
// notifications, to a finance alias on the Photon email domain.
//
// Contract: Photon API version 2026-07-01, `ReceivedSmsMessage`,
// `ReceivedImessageMessage` and `ReceivedEmailMessage` from the pinned schema on
// the `deals` branch (src/contracts/photon-email-2026-07-01.json). Email is
// read with read-only API calls; this module never changes the shared email
// webhook destination, and promotional deal extraction stays in the deals
// pipeline.
const { createHmac, timingSafeEqual } = require('node:crypto');

const API_VERSION = '2026-07-01';
const API_ORIGIN = 'https://api.photon.codes';
const TEXT_PLATFORMS = new Set(['sms', 'imessage']);
const PLATFORMS = new Set([...TEXT_PLATFORMS, 'email']);
const GMAIL_FORWARDING_SENDER = 'forwarding-noreply@google.com';
const WEBHOOK_TOLERANCE_SECONDS = 300;
const MAX_TEXT_CHARS = 2000;
const MAX_EMAIL_CHARS = 6000;

class TextIngestError extends Error {
  constructor(code, { retryable = false, status } = {}) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value.length > 0;

function isoInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

/** Normalizes a phone handle to digits with a leading +, or lowercases an Apple ID email. */
function normalizeHandle(handle) {
  if (!nonEmpty(handle)) return null;
  const trimmed = handle.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits.length === 10 ? `1${digits}` : digits}`;
}

/** Readable text from HTML: drops scripts, styles and tags, keeps line breaks. */
function htmlToText(html) {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&#36;/g, '$')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

function emailSubject(content, depth = 0) {
  if (!isObject(content) || depth > 3) return '';
  if (typeof content.metadata?.email?.subject === 'string') return content.metadata.email.subject;
  if (content.type === 'group' && Array.isArray(content.parts)) {
    for (const part of content.parts) {
      const subject = emailSubject(part, depth + 1);
      if (subject) return subject;
    }
  }
  return '';
}

/** Plain text of a text or group content, ignoring attachments, reactions and typing updates. */
function messageText(content, depth = 0) {
  if (!isObject(content) || depth > 3) return '';
  if (content.type === 'text' && nonEmpty(content.text)) return content.format === 'html' ? htmlToText(content.text) : content.text;
  if (content.type === 'group' && Array.isArray(content.parts)) {
    // Email alternatives (plain and HTML) carry the same content; keep the first readable one per group.
    const parts = content.parts.slice(0, 20).map((part) => messageText(part, depth + 1)).filter(Boolean);
    const seen = new Set();
    return parts.filter((p) => {
      const key = p.replace(/\s+/g, ' ').trim();
      return !seen.has(key) && seen.add(key);
    }).join('\n');
  }
  return '';
}

/**
 * Validates the fields this module depends on. Returns null for messages that
 * are not received SMS/iMessage texts; throws on a project mismatch.
 */
function parseTextMessage(input, projectId) {
  if (!isObject(input) || !PLATFORMS.has(input.platform) || input.status !== 'received') return null;
  const { id, sentBy, space, timestamps, receivedBy } = input;
  if (!nonEmpty(id) || !isObject(sentBy) || !nonEmpty(sentBy.handle) || !nonEmpty(sentBy.id)
    || !isObject(space) || !nonEmpty(space.id) || !isObject(timestamps) || !isoInstant(timestamps.receivedAt)) {
    throw new TextIngestError('unsupported_photon_text_schema');
  }
  const projects = [input.projectId, space.projectId, sentBy.projectId, receivedBy?.projectId].filter((v) => v !== undefined);
  if (projects.some((value) => value !== projectId)) throw new TextIngestError('photon_project_mismatch');
  const participants = Array.isArray(space.participantIds) ? space.participantIds.filter(nonEmpty) : [];
  const email = input.platform === 'email';
  const body = messageText(input.content).replace(/\r\n/g, '\n').trim();
  const subject = email ? emailSubject(input.content).trim().slice(0, 300) : '';
  const fromAddress = email ? sentBy.handle.trim().toLowerCase() : null;
  return {
    id,
    platform: input.platform,
    spaceId: space.id,
    participantIds: participants,
    senderId: sentBy.id,
    senderHandle: email ? fromAddress : normalizeHandle(sentBy.handle),
    // For email, delivery evidence is receivedBy.handle; visible To/Cc are not.
    receiverHandle: nonEmpty(receivedBy?.handle) ? receivedBy.handle.trim().toLowerCase() : null,
    receiverResourceId: receivedBy?.details?.resourceId ?? null,
    receivedAt: timestamps.receivedAt,
    fromAddress,
    subject,
    text: email
      ? `Subject: ${subject}\nFrom: ${fromAddress}\n\n${body}`.slice(0, MAX_EMAIL_CHARS)
      : body.slice(0, MAX_TEXT_CHARS),
  };
}

function textConfig(env = process.env) {
  const ownerHandles = new Set((env.PHOTON_TEXT_OWNER_HANDLES ?? '').split(',').map(normalizeHandle).filter(Boolean));
  const platforms = ownerHandles.size === 0 ? [] : (env.PHOTON_TEXT_PLATFORMS || 'sms').split(',').map((p) => p.trim()).filter((p) => TEXT_PLATFORMS.has(p));
  const emailAddresses = new Set((env.PHOTON_FINANCE_EMAIL_ADDRESSES ?? '').split(',').map((a) => a.trim().toLowerCase()).filter((a) => /^[^@\s]+@[^@\s]+$/.test(a)));
  if (emailAddresses.size > 0) platforms.push('email');
  return {
    projectId: env.PHOTON_PROJECT_ID,
    apiKey: env.PHOTON_API_KEY,
    ownerId: env.NESSIE_ACCOUNT_ID,
    ownerHandles,
    lineResourceId: env.PHOTON_TEXT_RESOURCE_ID || null,
    platforms,
    webhookSecret: env.PHOTON_TEXT_WEBHOOK_SECRET || null,
    emailAddresses,
    enabled: Boolean(env.PHOTON_PROJECT_ID && (ownerHandles.size > 0 || emailAddresses.size > 0)),
  };
}

/**
 * Decides whether a text belongs to the consenting user. The user's own texts
 * are matched by handle. A friend's text is accepted only in a space where the
 * user's Photon user ID has already been seen, so the user chose to bring the
 * Nessie line into that conversation.
 */
function classifySender(message, cfg, knownOwnerUserIds) {
  // Forwarded email belongs to the user whose finance alias received it.
  if (message.platform === 'email') return message.receiverHandle && cfg.emailAddresses?.has(message.receiverHandle) ? 'owner' : null;
  if (cfg.lineResourceId && message.receiverResourceId && message.receiverResourceId !== cfg.lineResourceId) {
    return null;
  }
  if (message.senderHandle && cfg.ownerHandles.has(message.senderHandle)) return 'owner';
  if (message.participantIds.some((id) => knownOwnerUserIds.has(id))) return 'participant';
  return null;
}

// Standard Webhooks: v1 signature = base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)).
function verifyStandardWebhook(rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new TextIngestError('webhook_secret_missing', { status: 503 });
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (!nonEmpty(id) || !/^\d{1,12}$/.test(timestamp ?? '') || !nonEmpty(signatures)) {
    throw new TextIngestError('invalid_webhook_signature', { status: 401 });
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new TextIngestError('webhook_timestamp_out_of_range', { status: 401 });
  }
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  const matches = signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const supplied = Buffer.from(value, 'base64');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  if (!matches) throw new TextIngestError('invalid_webhook_signature', { status: 401 });
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new TextIngestError('invalid_webhook_body', { status: 400 });
  }
  if (event?.id !== id) throw new TextIngestError('webhook_id_mismatch', { status: 400 });
  return event;
}

/** Returns { eventId, message } for a text message.received event, or null for other events. */
function parseTextEvent(event, cfg) {
  if (event?.type !== 'message.received' || event.apiVersion !== API_VERSION || !isObject(event.data)) return null;
  if (event.data.projectId !== cfg.projectId) throw new TextIngestError('photon_project_mismatch', { status: 400 });
  // Email arrives on the shared deals destination; finance reads it by read-only sync, never here.
  const message = parseTextMessage(event.data.object, cfg.projectId);
  return message && TEXT_PLATFORMS.has(message.platform) ? { eventId: event.id, message } : null;
}

/** Records one message. Repeated delivery of the same message yields one stored row and one job. */
async function ingestText(store, cfg, message, deliveryId) {
  // Gmail's forwarding verification code is shown to the user by the CLI, never stored or sent to the model.
  if (message.platform === 'email' && message.fromAddress === GMAIL_FORWARDING_SENDER) return { accepted: false, reason: 'gmail_forwarding_confirmation' };
  const knownOwners = await store.ownerUserIds();
  const role = classifySender(message, cfg, knownOwners);
  if (!role) return { accepted: false, reason: 'not_authorized' };
  if (role === 'owner' && !knownOwners.has(message.senderId)) await store.addOwnerUserId(message.senderId);
  const { inserted } = await store.recordMessage({ ...message, senderRole: role }, deliveryId);
  return { accepted: true, inserted, role };
}

class PhotonTextClient {
  constructor(cfg, fetchImpl = fetch) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
  }

  async listMessages(query) {
    if (!this.cfg.apiKey || !this.cfg.projectId) throw new TextIngestError('photon_credentials_missing');
    const url = new URL(`/v1/projects/${encodeURIComponent(this.cfg.projectId)}/messages`, API_ORIGIN);
    url.search = new URLSearchParams(query).toString();
    let response;
    try {
      response = await this.fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
      });
    } catch {
      throw new TextIngestError('photon_request_failed', { retryable: true });
    }
    if (!response.ok) {
      throw new TextIngestError(`photon_http_${response.status}`, { retryable: response.status === 429 || response.status >= 500 });
    }
    const page = await response.json();
    if (!Array.isArray(page?.items)) throw new TextIngestError('photon_invalid_page');
    if (page.nextPageToken !== undefined && page.nextPageToken !== null
      && (typeof page.nextPageToken !== 'string' || page.nextPageToken.length > 4096)) {
      throw new TextIngestError('photon_invalid_cursor');
    }
    return page;
  }
}

/**
 * Pulls received texts updated within a delayed window and follows every
 * nextPageToken. Owner texts are processed before friends' texts on each page
 * so a space becomes known before its other messages are classified. The
 * window overlaps the previous one by a day because listings are eventually
 * consistent; duplicates are absorbed by the store.
 */
async function syncTexts(store, cfg, { client = new PhotonTextClient(cfg), now = new Date(), maxPages = 50 } = {}) {
  const cursor = (await store.syncCursor()) ?? {};
  const end = cursor.windowEnd ?? new Date(now.getTime() - 120_000).toISOString();
  const start = cursor.windowStart
    ?? (cursor.lastSuccessEnd ? new Date(Date.parse(cursor.lastSuccessEnd) - 86_400_000).toISOString() : new Date(now.getTime() - 30 * 86_400_000).toISOString());
  const summary = { pages: 0, seen: 0, accepted: 0, inserted: 0 };
  for (const platform of cfg.platforms) {
    let token = cursor.platform === platform ? cursor.pageToken : undefined;
    if (cursor.platform && cfg.platforms.indexOf(platform) < cfg.platforms.indexOf(cursor.platform)) continue;
    for (let page = 0; page < maxPages; page++) {
      const query = {
        platform, direction: 'received', order: 'asc', orderBy: 'updated_at',
        updatedSince: start, updatedBefore: end, pageSize: '100',
      };
      if (token) query.pageToken = token;
      const data = await client.listMessages(query);
      summary.pages++;
      const parsed = data.items.map((item) => parseTextMessage(item, cfg.projectId)).filter(Boolean);
      parsed.sort((a, b) => Number(!cfg.ownerHandles.has(a.senderHandle)) - Number(!cfg.ownerHandles.has(b.senderHandle)));
      // Only the platform requested on this page is processed.
      for (let i = parsed.length - 1; i >= 0; i--) if (parsed[i].platform !== platform) parsed.splice(i, 1);
      for (const message of parsed) {
        summary.seen++;
        const result = await ingestText(store, cfg, message, `reconcile:${message.id}`);
        if (result.accepted) summary.accepted++;
        if (result.inserted) summary.inserted++;
      }
      token = data.nextPageToken || undefined;
      await store.saveSyncCursor(token ? { windowStart: start, windowEnd: end, platform, pageToken: token } : { windowStart: start, windowEnd: end, platform });
      if (!token) break;
      if (page === maxPages - 1) throw new TextIngestError('photon_sync_window_incomplete', { retryable: true });
    }
  }
  await store.saveSyncCursor({ lastSuccessEnd: end });
  return summary;
}

/**
 * Finds the newest Gmail forwarding confirmation code sent to a finance alias
 * in the last three days. Read-only.
 */
async function findGmailForwardingCode(cfg, { client = new PhotonTextClient(cfg), now = new Date() } = {}) {
  let token;
  let latest = null;
  for (let page = 0; page < 20; page++) {
    const query = {
      platform: 'email', direction: 'received', order: 'asc', orderBy: 'updated_at',
      updatedSince: new Date(now.getTime() - 3 * 86_400_000).toISOString(), updatedBefore: now.toISOString(), pageSize: '100',
    };
    if (token) query.pageToken = token;
    const data = await client.listMessages(query);
    for (const item of data.items) {
      const message = parseTextMessage(item, cfg.projectId);
      if (!message || message.fromAddress !== GMAIL_FORWARDING_SENDER || !cfg.emailAddresses.has(message.receiverHandle)) continue;
      const code = /confirmation code:\s*(\d{6,12})/i.exec(message.text)?.[1];
      if (code && (!latest || message.receivedAt > latest.receivedAt)) latest = { code, alias: message.receiverHandle, receivedAt: message.receivedAt };
    }
    token = data.nextPageToken || undefined;
    if (!token) break;
  }
  return latest;
}

module.exports = {
  findGmailForwardingCode,
  htmlToText,
  API_VERSION,
  TextIngestError,
  PhotonTextClient,
  classifySender,
  ingestText,
  messageText,
  normalizeHandle,
  parseTextEvent,
  parseTextMessage,
  syncTexts,
  textConfig,
  verifyStandardWebhook,
};
