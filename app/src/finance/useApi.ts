// Loads one backend route and keeps the answer. `path: null` means "do not load yet".
// Errors are sorted into the kinds screens care about, so no screen reads status codes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, FinanceApiError } from './financeApi';

export type LoadState<T> =
  | { kind: 'loading'; data?: T }
  | { kind: 'ready'; data: T }
  | { kind: 'unavailable'; message: string } // not set up on this server, or not allowed for this owner
  | { kind: 'error'; message: string };

export function errorState(e: unknown): { kind: 'unavailable' | 'error'; message: string } {
  if (e instanceof FinanceApiError) {
    if (e.status === 401) return { kind: 'unavailable', message: 'Only the team account can use this.' };
    if (e.status === 404 || e.status === 503) return { kind: 'unavailable', message: 'This is not set up on the server yet.' };
    if (e.status === 409) return { kind: 'unavailable', message: 'Your data is still being prepared. Try again in a moment.' };
    return { kind: 'error', message: e.message };
  }
  return { kind: 'error', message: 'Couldn’t reach the finance backend. Check that it is running and reachable.' };
}

export function useApi<T>(path: string | null) {
  const [state, setState] = useState<LoadState<T>>({ kind: 'loading' });
  const generation = useRef(0);
  // State changes only in the request's callbacks, so loading on mount never re-renders synchronously.
  // A newer request makes an older answer be ignored.
  const request = useCallback(() => {
    if (!path) return Promise.resolve();
    const mine = ++generation.current;
    return api(path).then(
      (data) => { if (mine === generation.current) setState({ kind: 'ready', data: data as T }); },
      (e) => { if (mine === generation.current) setState(errorState(e)); },
    );
  }, [path]);
  useEffect(() => { void request(); }, [request]);
  const reload = useCallback(() => {
    setState((s) => ({ kind: 'loading', data: 'data' in s ? s.data : undefined }));
    return request();
  }, [request]);
  const data = 'data' in state ? state.data : undefined;
  return { state, data, reload };
}

// Waits for a pipeline run (started by a sync or an edit) to finish, so screens can reload after it.
export async function waitForRun(runId: string | undefined, maxSeconds = 60) {
  if (!runId) return;
  for (let i = 0; i < maxSeconds / 2; i++) {
    const run = await api(`/api/v1/pipeline/runs/${runId}`);
    if (run.stages.every((s: { state: string }) => ['completed', 'skipped', 'dead'].includes(s.state))) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
