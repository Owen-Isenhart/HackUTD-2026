// Client for the finance backend in ../scripts/finance-profile.js (from the feat-rs branch).
// It sends the app's current position to POST /api/finance-recommendation, which matches it
// against the user's Nessie purchase routines, checks affordability, and ranks the options
// with the Python optimizer (optimizer/) when OPTIMIZER_API_URL is set on the backend.
//
// The backend needs GET /api/finance-profile first: that call refreshes the Nessie profile the
// recommendation is checked against. Both calls need the shared demo token (FINANCE_DEMO_TOKEN
// on the backend) as a Bearer token. The token is typed in the app, never built into it.
import { type LocationEvent } from '../location/geo';

// Expo inlines EXPO_PUBLIC_* variables at build time. Set it in app/.env to the backend's
// HTTPS origin, e.g. a tunnel to http://127.0.0.1:8787.
declare const process: { env: Record<string, string | undefined> };
export const FINANCE_API_URL = (process.env.EXPO_PUBLIC_FINANCE_API_URL ?? '').replace(/\/+$/, '');

export type FinanceRecommendation = {
  offer: { id: string; merchant: string; cashbackPercent?: number; distance?: number };
  routine: { weekday: string; daypart: string; observedDays: number };
  payableCents: number;
  cashbackCents: number;
  effectiveCostCents: number;
  source: 'live' | 'demo';
  expiresAt: number;
  explanation: { text: string };
  callId?: string;
};

export type RecommendationAnswer =
  | { kind: 'recommendation'; recommendation: FinanceRecommendation }
  | { kind: 'skip'; reason: string };

// What the backend's recommendVisit() expects. A demo event sends only { source: 'demo' }: the
// backend then uses its own fixed demo visit (Chipotle, Richardson, Friday noon), not the dragged
// marker, because a simulated position must never be sent as if it were a live fix.
// Returns null when a live event has no accuracy, which the backend would reject.
export function recommendationRequest(event: LocationEvent) {
  if (event.source === 'demo') return { source: 'demo' as const };
  if (event.accuracyM === null) return null;
  return {
    source: 'live' as const,
    fix: { coords: { latitude: event.latitude, longitude: event.longitude, accuracy: event.accuracyM }, timestamp: event.timestamp },
  };
}

// Plain-language text for every reason the backend can return instead of a recommendation.
// Wording for the first ten is copied from the feat-rs App.js so both UIs say the same thing.
const SKIP_TEXT: Record<string, string> = {
  profile_required: 'Load the finance profile before checking for routine offers.',
  refresh_required: 'Refresh the finance profile to use current financial data.',
  balance_unavailable: 'Nessie did not provide a usable balance for this offer.',
  insufficient_balance: 'The typical purchase costs more than the last reported balance.',
  budget_limit: 'The typical purchase exceeds your remaining confirmed budget.',
  budget_reserved_for_plans: 'Your remaining budget is set aside for upcoming bills and plans.',
  reserved_for_plans: 'Your balance is set aside for upcoming plans and bills from your texts and email.',
  clarification_required: 'Confirm the plans from your texts and email in the finance profile first.',
  forecast_liquidity: 'The purchase would cut into money needed for upcoming bills or your cash reserve.',
  forecast_incomplete: 'Some bank commitments or cash balance details are missing. Check the finance forecast.',
  no_matching_routine: 'No purchase routine of yours matches this place and time.',
  invalid_location: 'The location was too old or too inaccurate to check.',
  optimizer_unavailable: 'The optimizer did not answer, so no recommendation was made.',
  no_eligible_offer: 'No eligible offer at the place your routine points to.',
  location_expired: 'The location went out of date while the recommendation was being made.',
};
export const describeSkip = (reason: string) => SKIP_TEXT[reason] ?? 'No eligible routine offer for this location and time.';

export class FinanceApiError extends Error {}

async function call(path: string, token: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  if (!FINANCE_API_URL) throw new FinanceApiError('EXPO_PUBLIC_FINANCE_API_URL is not set.');
  const response = await fetch(`${FINANCE_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (response.status === 401) throw new FinanceApiError('The finance demo token was not accepted.');
  if (!response.ok) throw new FinanceApiError(`The finance backend answered ${response.status}.`);
  return response.json();
}

// Refreshes the Nessie profile on the backend. Returns the profile's timestamp (asOf).
export async function loadFinanceProfile(token: string, signal?: AbortSignal): Promise<string> {
  const profile = await call('/api/finance-profile', token, { signal });
  return String(profile?.asOf ?? '');
}

export async function requestRecommendation(token: string, event: LocationEvent, signal?: AbortSignal): Promise<RecommendationAnswer> {
  const body = recommendationRequest(event);
  if (!body) return { kind: 'skip', reason: 'invalid_location' };
  const answer = await call('/api/finance-recommendation', token, { method: 'POST', body, signal });
  if (answer?.recommendation) return { kind: 'recommendation', recommendation: answer.recommendation };
  return { kind: 'skip', reason: String(answer?.reason ?? 'unknown') };
}
