import {getSession,saveSession} from './session';
import type {NearbyStore} from '../location/nearbyStores';
// Sandbox sessions are stored in SecureStore and sent only to the finance origin.
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
  payWith?: {id:string;label:string;termsUrl?:string;verifiedOn?:string};
  applied?: {kind:string;label:string;provenance:string}[];
  loyalty?: {program:string;points:number;valued:boolean;simulatedMembership:boolean}|null;
  budgetAfter?: Record<string,number>;
  labels?: string[];
};

export type RecommendationAnswer =
  | { kind: 'recommendation'; recommendation: FinanceRecommendation }
  | { kind: 'skip'; reason: string };

// Both live fixes and dragged markers keep their explicit source label.
export function recommendationRequest(event: LocationEvent) {
  if (event.source === 'live' && event.accuracyM === null) return null;
  return {
    source: event.source,
    fix: { coords: { latitude: event.latitude, longitude: event.longitude, accuracy: event.accuracyM ?? 10 }, timestamp: event.timestamp },
  };
}

// Plain-language text for every reason the backend can return instead of a recommendation.
// Wording for the first ten is copied from the feat-rs App.js so both UIs say the same thing.
const SKIP_TEXT: Record<string, string> = {
  commute_window: 'Recommendations are held during your stated commute.',
  no_verified_price:'There is not enough purchase history to estimate a price here.',
  optimizer_mismatch:'The recommendation failed the independent money checks.',
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

export class FinanceApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) { super(message); this.status=status; }
}

// Routes that only the team's operator account may use. A 401 here means "not allowed for
// this owner", not "session expired", so it must not sign the user out.
const OPERATOR_ONLY = [/^\/api\/text-obligations/, /^\/api\/texts\//, /^\/api\/v1\/settings/, /^\/api\/v1\/devices/,
  /^\/api\/v1\/location\//, /^\/api\/v1\/calls\//, /^\/api\/finance-memory/];
export const isOperatorOnly = (path: string) => OPERATOR_ONLY.some((r) => r.test(path));

export async function call(path: string, token?: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  if (!FINANCE_API_URL) throw new FinanceApiError('EXPO_PUBLIC_FINANCE_API_URL is not set.');
  const stored=path==='/api/v1/onboarding/identify'?null:token || await getSession();
  const response = await fetch(`${FINANCE_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(stored?{Authorization: `Bearer ${stored}`} : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if(response.status===401&&isOperatorOnly(path))throw new FinanceApiError('Only the team account can use this.',401);
  if(response.status===401){if(await getSession())await saveSession(null);throw new FinanceApiError('The session token was not accepted. Find your sandbox account again.',401);}
  if (!response.ok) throw new FinanceApiError(`The finance backend answered ${response.status}.`,response.status);
  return response.json();
}

// Refreshes the Nessie profile on the backend. Returns the profile's timestamp (asOf).
export async function loadFinanceProfile(token?: string, signal?: AbortSignal): Promise<string> {
  const profile = await call('/api/finance-profile', token, { signal });
  return String(profile?.asOf ?? '');
}

export async function requestRecommendation(token: string, event: LocationEvent, signal?: AbortSignal, nearbyStores: NearbyStore[] = []): Promise<RecommendationAnswer> {
  const body = recommendationRequest(event);
  if (!body) return { kind: 'skip', reason: 'invalid_location' };
  const answer = await call('/api/finance-recommendation', token, { method: 'POST', body:{...body,nearbyStores:nearbyStores.slice(0,100).map(s=>({id:s.id,name:s.name,brand:s.brand,latitude:s.latitude,longitude:s.longitude}))}, signal });
  if (answer?.recommendation) return { kind: 'recommendation', recommendation: answer.recommendation };
  return { kind: 'skip', reason: String(answer?.reason ?? 'unknown') };
}

export async function identifySandbox(input: { fullName: string; last4: string }) {
  const result = await call('/api/v1/onboarding/identify', '', { method: 'POST', body: input });
  await saveSession(result.session.token);
  return result;
}
export const api=(path:string,method='GET',body?:unknown)=>call(path,undefined,{method,body});
