// Stores and offers around a position, from POST /api/v1/app/nearby. Refetches
// only after the position moves more than 75 m, so GPS jitter doesn't spam it.
import { useEffect, useRef, useState } from 'react';
import { api } from './financeApi';
import { distanceInMeters } from '../location/geo';

export type NearbyOffer = { title: string; detail: string; source: 'tiger' | 'demo' | 'card' };
export type NearbyStore = {
  id: string; name: string; category: string; address: string; latitude: number; longitude: number;
  distanceM: number; offers: NearbyOffer[]; visits90d: number; source: 'osm' | 'nessie';
};
export type Nearby = {
  center: { latitude: number; longitude: number };
  stores: NearbyStore[];
  best: { storeId: string; title: string; text: string; source: 'nemotron' | 'distance' } | null;
};

export function useNearby(at: { latitude: number; longitude: number } | null) {
  const [data, setData] = useState<Nearby | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    if (!at) return;
    if (last.current && distanceInMeters(last.current, at) < 75) return;
    last.current = at;
    let live = true;
    api('/api/v1/app/nearby', 'POST', { latitude: at.latitude, longitude: at.longitude })
      .then((d) => { if (live) { setData(d as Nearby); setError(null); } })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load nearby stores.'));
    return () => { live = false; };
  }, [at]);
  return { data, error };
}
