import {getSession,saveSession,onSessionChanged} from './session';
import {api} from './financeApi';
import type {NearbyStore} from '../location/nearbyStores';
// Feeds the app's location events to the finance backend and keeps the latest answer.
// Rechecks follow movement, elapsed time and changes to nearby stores.
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

export function useFinanceRecommendation(event: LocationEvent | null, nearbyStores: NearbyStore[] = []) {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<FinanceStatus>({ kind: 'signed-out' });
  const last = useRef<{ event: LocationEvent; at: number;stores:string } | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const signIn = useCallback(async (raw?: string) => {
    const t = raw?.trim() || await getSession();
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
    void api('/api/v1/session','DELETE').finally(()=>saveSession(null));
  }, []);

  useEffect(()=>{void signIn();return onSessionChanged(()=>{void signIn();});},[signIn]);
  const ready = status.kind === 'ready';
  useEffect(() => {
    if (!token || !ready || !event) return;
    const prev = last.current;
    const stores=nearbyStores.map(s=>s.id).sort().join(',');
    const due =
      !prev || prev.stores!==stores ||
      prev.event.source !== event.source ||
      Date.now() - prev.at >= RECHECK_MS || distanceInMeters(prev.event, event) >= MOVE_M;
    if (!due) return;
    last.current = { event, at: Date.now(),stores };
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus((s) => (s.kind === 'ready' ? { ...s, checking: true } : s));
    requestRecommendation(token, event, controller.signal, nearbyStores)
      .then((answer) => {
        if (!controller.signal.aborted) setStatus((s) => (s.kind === 'ready' ? { ...s, checking: false, answer } : s));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setStatus({ kind: 'error', message: errorText(e) });
      });
  }, [token, ready, event, nearbyStores]);

  useEffect(() => () => inFlight.current?.abort(), []);

  // When the backend says the profile is old, reload it; the next location event re-checks.
  const refreshProfile = useCallback(async()=>{if(!token)return;try{const run=await api('/api/v1/finance/sync','POST',{});for(let i=0;i<30;i++){const progress=await api('/api/v1/pipeline/runs/'+run.runId);if(progress.stages.every((s:{state:string})=>['completed','skipped','dead'].includes(s.state)))break;await new Promise(r=>setTimeout(r,1000));}await signIn(token);}catch(e){setStatus({kind:'error',message:errorText(e)});}},[token,signIn]);

  return { status, signIn, signOut, refreshProfile, hasToken: !!token };
}
