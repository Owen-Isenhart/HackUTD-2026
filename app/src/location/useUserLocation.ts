// Holds the user's current position from exactly one source at a time: live GPS or the
// draggable demo marker. Switching source stops the other one, so the two never mix
// (context.md section 14, "Demo and failure behavior").
// The permission request and position watching follow the feat-rs branch's App.js.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { DEMO_START, LocationEvent, LocationSource, MAX_FIX_AGE_MS } from './geo';

export type LocationStatus =
  | { kind: 'off' }
  | { kind: 'requesting' } // waiting for the permission answer or the first reading
  | { kind: 'denied'; canAskAgain: boolean } // canAskAgain false means only Settings can fix it
  | { kind: 'error'; message: string }
  | { kind: 'active' };

export function useUserLocation() {
  const [source, setSource] = useState<LocationSource | null>(null);
  const [event, setEvent] = useState<LocationEvent | null>(null);
  const [status, setStatus] = useState<LocationStatus>({ kind: 'off' });
  const [now, setNow] = useState(() => Date.now());
  const subscription = useRef<Location.LocationSubscription | null>(null);
  // Bumped on every start/stop. An async step that finishes after a newer start/stop
  // sees a different number and throws its result away. Same guard as feat-rs.
  const generation = useRef(0);

  const stopWatching = () => {
    subscription.current?.remove();
    subscription.current = null;
  };

  const stop = useCallback(() => {
    generation.current += 1;
    stopWatching();
    setSource(null);
    setEvent(null);
    setStatus({ kind: 'off' });
  }, []);

  const startLive = useCallback(async () => {
    const mine = ++generation.current;
    stopWatching();
    setSource('live');
    setEvent(null); // never show a demo position labelled as live
    setStatus({ kind: 'requesting' });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (mine !== generation.current) return;
      if (!permission.granted) {
        setStatus({ kind: 'denied', canAskAgain: permission.canAskAgain });
        return;
      }
      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5 },
        (fix) => {
          if (mine !== generation.current) return;
          setEvent({
            latitude: fix.coords.latitude,
            longitude: fix.coords.longitude,
            accuracyM: fix.coords.accuracy,
            timestamp: fix.timestamp,
            source: 'live',
          });
          setStatus({ kind: 'active' });
        },
        () => {
          if (mine !== generation.current) return;
          setStatus({ kind: 'error', message: 'Location updates stopped. Check Location Services and try again.' });
        },
      );
      if (mine === generation.current) subscription.current = watcher;
      else watcher.remove();
    } catch {
      if (mine === generation.current) {
        setStatus({ kind: 'error', message: 'Couldn’t start location. Check Location Services and try again.' });
      }
    }
  }, []);

  // Moves the simulated user. Only the position is simulated; nothing else is faked.
  const moveDemo = useCallback((p: { latitude: number; longitude: number }) => {
    setEvent({ latitude: p.latitude, longitude: p.longitude, accuracyM: 0, timestamp: Date.now(), source: 'demo' });
  }, []);

  const startDemo = useCallback(() => {
    generation.current += 1;
    stopWatching();
    setSource('demo');
    setStatus({ kind: 'active' });
    moveDemo(DEMO_START);
  }, [moveDemo]);

  // Re-check freshness every few seconds, because a live watch that goes quiet sends
  // nothing, and the age would otherwise never update on screen.
  useEffect(() => {
    if (source !== 'live') return;
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [source]);

  useEffect(() => () => {
    generation.current += 1;
    stopWatching();
  }, []);

  const ageMs = event ? Math.max(0, now - event.timestamp) : null;
  const stale = event?.source === 'live' && ageMs !== null && ageMs > MAX_FIX_AGE_MS;

  return { source, event, status, stale, ageMs, startLive, startDemo, moveDemo, stop };
}
