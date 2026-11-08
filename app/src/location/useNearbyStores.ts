// Keeps the list of stores within a radius of the user up to date as they move.
// Searches are rationed, because Overpass is a free shared server: a new search runs only
// when the radius changes, the location source changes, or the user has moved far enough
// from where the last search was made, and only once the position has settled.
import { useEffect, useMemo, useRef, useState } from 'react';
import { distanceInMeters, type LocationEvent } from './geo';
import { findNearbyStores, type NearbyStore, type NearbyStoresResult } from './nearbyStores';

// Wait this long after the last position change before searching. Stops a demo drag or
// GPS wobble from firing a search on every update.
const SETTLE_MS = 800;
// Search again after moving this far from the last search point (or a quarter of the
// radius, if that is smaller), so stores near the edge are not missed for long.
const MAX_MOVE_BEFORE_SEARCH_M = 100;

export type NearbyStoresStatus =
  | { kind: 'idle' } // no position yet
  | { kind: 'too-approximate'; accuracyM: number } // GPS uncertainty is larger than the radius
  | { kind: 'searching' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export function useNearbyStores(event: LocationEvent | null, radiusM: number) {
  const [result, setResult] = useState<NearbyStoresResult | null>(null);
  const [status, setStatus] = useState<NearbyStoresStatus>({ kind: 'idle' });
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!event) {
      inFlight.current?.abort();
      setResult(null);
      setStatus({ kind: 'idle' });
      return;
    }
    // Same rule as feat-rs: a reading less precise than the search radius cannot say which
    // stores are inside it.
    if (event.source === 'live' && event.accuracyM !== null && event.accuracyM > radiusM) {
      setStatus({ kind: 'too-approximate', accuracyM: event.accuracyM });
      return;
    }
    const last = result?.query;
    const moved = last ? distanceInMeters(last, event) : Infinity;
    const needSearch =
      !last ||
      last.radiusM !== Math.round(radiusM) ||
      last.locationSource !== event.source ||
      moved > Math.min(MAX_MOVE_BEFORE_SEARCH_M, radiusM / 4);
    if (!needSearch) {
      // The last search still covers this position; clear an earlier "too approximate".
      setStatus((s) => (s.kind === 'too-approximate' ? { kind: 'ready' } : s));
      return;
    }

    const timer = setTimeout(() => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      setStatus({ kind: 'searching' });
      findNearbyStores(event, radiusM, controller.signal)
        .then((r) => {
          if (controller.signal.aborted) return;
          setResult(r);
          setStatus({ kind: 'ready' });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // `result` is read only to compare with the last search; a new result must not
    // trigger another search by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, radiusM]);

  useEffect(() => () => inFlight.current?.abort(), []);

  // The last search's stores, re-measured from where the user is now and limited to the
  // radius again, so distances stay right between searches.
  const stores: NearbyStore[] = useMemo(() => {
    if (!result || !event || result.query.locationSource !== event.source) return [];
    return result.stores
      .map((s) => ({ ...s, distanceM: distanceInMeters(event, s) }))
      .filter((s) => s.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [result, event, radiusM]);

  return { status, result, stores };
}
