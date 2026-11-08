// Pure parts of the in-app voice assistant (no React Native, no LiveKit), so Node can test them.
// The server side is services/calls: POST /voice/session mints a LiveKit token that dispatches the
// voice agent; the agent then talks to this app over LiveKit RPC and participant attributes.
// Contract (see Calls.md, "In-app voice"):
//   app -> agent RPC:  start_turn (button pressed), end_turn (released), cancel_turn
//   agent -> app RPC:  navigate, payload {"route": "deals" | "spending" | "upcoming" | "account"}
//   app attributes:    page (route slug), visible (section titles), facts (frozen demo data)

// The four bottom tabs in App.tsx. Keep in sync with ROUTES in services/calls/src/navigation.py
// and the list in services/calls/prompts/app_voice.txt (the server tests check those two).
export const ROUTES = ['deals', 'spending', 'upcoming', 'account'] as const;
export type VoiceRoute = (typeof ROUTES)[number];

const TAB_FOR_ROUTE: Record<VoiceRoute, string> = {
  deals: 'Deals', spending: 'Spending', upcoming: 'Upcoming', account: 'Account',
};

// What each tab shows, as the user reads it on screen (section titles from the screens).
const SECTIONS: Record<VoiceRoute, string[]> = {
  deals: ['Nearby Deals', 'Nearby Stores', 'Your offers'],
  spending: ['Current Spending', 'Spending by category', 'Budgets', 'Recent purchases'],
  upcoming: ['Upcoming Cashflow', 'Balance range', 'Next 14 days'],
  account: ['Account', 'Your money', 'Your routines', 'Store rewards email'],
};

const MAX_LABELS = 8;
const MAX_LABEL = 40;
const MAX_FACTS = 24;
const MAX_FACT = 160;

export type ScreenFacts = Partial<Record<VoiceRoute, string[]>>;

function boundedFacts(facts: readonly string[]): string[] {
  return facts.map((fact) => fact.replace(/\s+/g, ' ').trim())
    .filter((fact) => fact.length > 0 && fact.length <= MAX_FACT)
    .slice(0, MAX_FACTS);
}

/** An unavailable screen can retry. Once it has facts, preserve them for this signed-in session. */
export function captureScreenFacts(screens: ScreenFacts, tab: string, facts: readonly string[]): ScreenFacts {
  const route = routeForTab(tab);
  if (!route || screens[route]) return screens;
  const captured = boundedFacts(facts);
  return captured.length ? { ...screens, [route]: captured } : screens;
}

function asRoute(value: unknown): VoiceRoute | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return (ROUTES as readonly string[]).includes(v) ? (v as VoiceRoute) : null;
}

/** Tab name for a route the agent asked for, or null when it is not one of the four. */
export function tabForRoute(route: unknown): string | null {
  const r = asRoute(route);
  return r ? TAB_FOR_ROUTE[r] : null;
}

export function routeForTab(tab: string): VoiceRoute | null {
  const hit = (Object.keys(TAB_FOR_ROUTE) as VoiceRoute[]).find((r) => TAB_FOR_ROUTE[r] === tab);
  return hit ?? null;
}

/** The agent's `navigate` RPC payload -> tab name, or null for anything malformed or unknown. */
export function parseNavigatePayload(payload: string): string | null {
  try {
    const data = JSON.parse(payload);
    return data && typeof data === 'object' && !Array.isArray(data) ? tabForRoute((data as { route?: unknown }).route) : null;
  } catch {
    return null;
  }
}

function cleanLabel(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL).trim() : '';
}

/** LiveKit participant attributes (string values only) telling the agent which screen is showing. */
export function screenAttributes(tab: string, labels?: string[], facts: readonly string[] = []): Record<string, string> {
  const route = routeForTab(tab);
  if (!route) return {};
  const visible = (labels ?? SECTIONS[route]).map(cleanLabel).filter(Boolean).slice(0, MAX_LABELS);
  return { page: route, visible: JSON.stringify(visible), facts: JSON.stringify(boundedFacts(facts)) };
}

export type VoiceSession = { url: string; token: string; room: string };

/**
 * Ask the calls service for a LiveKit session. The API key is typed into the app at run time and is
 * only ever sent as a header; it is never put in an error message. Production should replace the
 * key with the signed-in user's session so the server derives user_id itself.
 */
export async function fetchVoiceSession(opts: {
  baseUrl: string; apiKey: string; userId: string; fetchImpl?: typeof fetch;
}): Promise<VoiceSession> {
  const base = opts.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Set the voice service address (http:// or https://).');
  if (!opts.apiKey.trim()) throw new Error('Enter the voice service key.');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(opts.userId)) throw new Error('Invalid user id.');
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${base}/voice/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey.trim() },
    body: JSON.stringify({ user_id: opts.userId }),
  });
  if (!res.ok) throw new Error(`Voice service refused the request (${res.status}).`);
  const body = (await res.json()) as Partial<VoiceSession> | null;
  if (!body || typeof body.url !== 'string' || typeof body.token !== 'string' || typeof body.room !== 'string') {
    throw new Error('Voice service returned an unexpected answer.');
  }
  return { url: body.url, token: body.token, room: body.room };
}

// What the assistant is doing. Nessie pops up whenever it is not idle/ready.
export type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'listening' | 'thinking' | 'speaking' | 'error';

/** What a tap on Nessie does in each state. Tapping while she thinks or speaks interrupts her. */
export function nextAction(status: VoiceStatus | string): 'connect' | 'start' | 'end' | 'none' {
  switch (status) {
    case 'idle': case 'error': return 'connect';
    case 'ready': case 'thinking': case 'speaking': return 'start';
    case 'listening': return 'end';
    default: return 'none';
  }
}

export function isPopped(status: VoiceStatus | string): boolean {
  return status === 'connecting' || status === 'listening' || status === 'thinking' || status === 'speaking';
}

export function statusCaption(status: VoiceStatus | string): string {
  return ({ connecting: 'Connecting…', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' } as Record<string, string>)[status] ?? '';
}

// What Nessie is saying, shown in a speech bubble. The agent streams her words over the LiveKit text
// stream topic "lk.transcription"; every stream is one segment, sent in small chunks.
export const REPLY_TOPIC = 'lk.transcription';
export const MAX_REPLY = 240;
export type Reply = { segment: string; text: string };

export function applyReplyChunk(previous: Reply | null, segment: string, chunk: string): Reply {
  const text = previous && previous.segment === segment ? previous.text + chunk : chunk;
  return { segment, text: text.length > MAX_REPLY ? text.slice(-MAX_REPLY) : text };
}
