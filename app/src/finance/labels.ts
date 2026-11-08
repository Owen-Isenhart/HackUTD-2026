// Shared display helpers: money in cents, and the fixed words for anything that is not real data.
// Pure functions, so they are tested without React (app/test/labels.test.mjs).

export const usd = (cents: number | null | undefined) =>
  cents === null || cents === undefined || !Number.isFinite(cents)
    ? 'Unavailable'
    : (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCE_WORDS: Record<string, string> = {
  nessie_sandbox: 'Sandbox bank data',
  synthetic_persona: 'Synthetic demo history',
  synthetic_test: 'Synthetic demo history',
  user_stated: 'Stated by you',
  user: 'Set by you',
  derived: 'Set automatically from your history',
  openstreetmap: 'Store data © OpenStreetMap contributors',
  synthetic_fixture: 'Sample offer, written by the team, not from Capital One',
  sample_offer: 'Sample offer, written by the team, not from Capital One',
  simulated_signup: 'Simulated signup (demo)',
  synthetic_history: 'Includes synthetic demo history',
};
export const sourceWords = (value: string | null | undefined) => (value ? SOURCE_WORDS[value] ?? value.replace(/_/g, ' ') : 'Unknown source');

// One line for a recommendation's `labels` list, e.g. "Includes a sample offer and a simulated signup."
const LABEL_PHRASE: Record<string, string> = {
  sample_offer: 'a sample offer',
  simulated_signup: 'a simulated signup',
  synthetic_history: 'synthetic demo history',
};
export function labelsLine(labels: string[] | undefined) {
  const parts = [...new Set(labels ?? [])].map((l) => LABEL_PHRASE[l] ?? l.replace(/_/g, ' '));
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `Includes ${list}.`;
}

// The 12 hand-written Capital One offers are stored under one message with this classification.
export const SAMPLE_OFFER_CLASSIFICATION = 'capital_one_feed';

export type DealsOffer = {
  provenance?: string;
  id: string; program_id: string; merchant_name: string; status: string; message_id: string;
  expires_at: string | null; stale_at: string; terms: { title?: string; minSpendMinor?: number | null; channels?: string[] };
};
export const isCurrentOffer = (o: DealsOffer, now = Date.now()) =>
  o.status === 'active' && (!o.expires_at || Date.parse(o.expires_at) > now) && Date.parse(o.stale_at) > now;

// Words for every state a recommendation call can be in (wording from the root App.js).
const CALL_WORDS: Record<string, string> = {
  ready: 'Ready to call.',
  dialing: 'Placing the call…',
  dial_requested: 'Photon accepted the call request. Check the demo phone.',
  message_accepted: 'The message was accepted for delivery.',
  uncertain: 'Call delivery is uncertain. Check the demo phone before retrying.',
  ended: 'This recommendation call has ended.',
  busy: 'The demo phone was busy.',
  no_answer: 'The demo phone did not answer or was unavailable.',
  declined: 'The demo phone declined the call.',
  failed: 'The call could not be placed.',
};
export const callWords = (state: string) => CALL_WORDS[state] ?? 'Call status unknown.';
export const callFinished = (state: string) => !['ready', 'dialing'].includes(state);

// Spending totals per category for one month ('YYYY-MM'), largest first.
export function categoryTotals(rows: { date: string; amountCents: number; category: string | null }[], month: string) {
  const totals = new Map<string, number>();
  for (const r of rows) if (r.date.startsWith(month) && r.amountCents > 0) totals.set(r.category ?? 'other', (totals.get(r.category ?? 'other') ?? 0) + r.amountCents);
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .map(([category, cents]) => ({ category, cents, pct: all ? Math.round((cents / all) * 100) : 0 }))
    .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
}
