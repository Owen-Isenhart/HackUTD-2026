// Feeds the app's location events to the finance backend and keeps the latest answer.
// Live GPS is re-checked at most every RECHECK_MS or after moving MOVE_M; a demo session is
// checked once, because the backend's demo visit is fixed and ignores the dragged marker.
import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceInMeters, type LocationEvent } from '../location/geo';
import { FinanceApiError, loadFinanceProfile, requestRecommendation, type RecommendationAnswer } from './financeApi';

const RECHECK_MS = 15_000;
const MOVE_M = 50;

export type FinanceStatus =
  | { kind: 'signed-out' }
  | { kind: 'loading-profile' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; asOf: string; checking: boolean; answer: RecommendationAnswer | null };

const errorText = (e: unknown) =>
  e instanceof FinanceApiError ? e.message : 'Couldn’t reach the finance backend. Check that it is running and reachable.';

export function useFinanceRecommendation(event: LocationEvent | null) {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<FinanceStatus>({ kind: 'signed-out' });
  const last = useRef<{ event: LocationEvent; at: number } | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const signIn = useCallback(async (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    inFlight.current?.abort();
    last.current = null;
    setToken(t);
    setStatus({ kind: 'loading-profile' });
    try {
      const asOf = await loadFinanceProfile(t);
      setStatus({ kind: 'ready', asOf, checking: false, answer: null });
    } catch (e) {
      setStatus({ kind: 'error', message: errorText(e) });
    }
  }, []);

  const signOut = useCallback(() => {
    inFlight.current?.abort();
    last.current = null;
    setToken(null);
    setStatus({ kind: 'signed-out' });
  }, []);

  const ready = status.kind === 'ready';
  useEffect(() => {
    if (!token || !ready || !event) return;
    const prev = last.current;
    const due =
      !prev ||
      prev.event.source !== event.source ||
      (event.source === 'live' &&
        (Date.now() - prev.at >= RECHECK_MS || distanceInMeters(prev.event, event) >= MOVE_M));
    if (!due) return;
    last.current = { event, at: Date.now() };
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus((s) => (s.kind === 'ready' ? { ...s, checking: true } : s));
    requestRecommendation(token, event, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setStatus((s) => (s.kind === 'ready' ? { ...s, checking: false, answer } : s));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setStatus({ kind: 'error', message: errorText(e) });
      });
  }, [token, ready, event]);

  useEffect(() => () => inFlight.current?.abort(), []);

  // When the backend says the profile is old, reload it; the next location event re-checks.
  const refreshProfile = useCallback(() => (token ? signIn(token) : undefined), [token, signIn]);

  return { status, signIn, signOut, refreshProfile, hasToken: !!token };
}
