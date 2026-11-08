import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { isRunningInExpoGo, requireOptionalNativeModule } from 'expo';
import { BEACON_MAJOR, BEACON_UUID } from './beacons';

const ranger = Platform.OS === 'ios' && !isRunningInExpoGo()
  ? requireOptionalNativeModule('MerchantBeacons')
  : null;

export function useBeaconRanging(enabled) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [status, setStatus] = useState('starting');
  const [beacons, setBeacons] = useState([]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    setForeground(AppState.currentState === 'active');
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (!ranger || !enabled || !foreground) return;

    let lastReadingTimer;
    let disposed = false;
    const stateListener = ranger.addListener('onStatus', ({ status }) => {
      setStatus(status);
      if (status !== 'scanning') {
        clearTimeout(lastReadingTimer);
        setBeacons([]);
      }
    });
    const beaconListener = ranger.addListener('onBeacons', ({ beacons }) => {
      clearTimeout(lastReadingTimer);
      setBeacons(beacons);
      lastReadingTimer = setTimeout(() => setBeacons([]), 5000);
    });

    setStatus('starting');
    setBeacons([]);
    ranger.start(BEACON_UUID, BEACON_MAJOR).catch(() => {
      if (!disposed) setStatus('unavailable');
    });

    return () => {
      disposed = true;
      clearTimeout(lastReadingTimer);
      stateListener.remove();
      beaconListener.remove();
      ranger.stop().catch(() => {});
    };
  }, [enabled, foreground]);

  if (!ranger) return { status: 'unsupported', beacons: [] };
  if (!enabled) return { status: 'idle', beacons: [] };
  if (!foreground) return { status: 'paused', beacons: [] };
  return { status, beacons };
}
