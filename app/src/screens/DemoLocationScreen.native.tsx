// Demo location (Alex Taylor only). The map starts at your real GPS position. Drag the pin, or
// long-press the map, to move; the backend treats the new spot as where you are. Every store within
// 5 miles of UT Dallas has a ring. Entering a ring looks up that store's deals and places a call.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import MapView, { Circle, Marker, type LatLng } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Screen } from '../components/Screen';
import { Button, Card, Pill, Row, SectionTitle, T } from '../components/ui';
import { c, space } from '../theme';
import { api, FinanceApiError } from '../finance/financeApi';
import { callWords } from '../finance/labels';

type Deal = { id: string; kind: 'capital_one' | 'store_email'; title: string; label: string; sample: boolean; channels: string[] };
type Store = { id: string; name: string; category: string; lat: number; lon: number; ringM: number; deals: Deal[] };
type DemoMap = {
  center: { lat: number; lon: number }; areaM: number; calls: boolean;
  position: { lat: number; lon: number } | null; stores: Store[];
};
type Notice = { title: string; body: string };
type Move = { inside: Store[]; entered: string[]; call: { id: string | null; state: string } | null; notice: Notice | null };

// Banners show even while the app is open, which is when the demo moves happen.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});
// A local notification posted by the app itself. Works in Expo Go; it is not a server push.
const showNotice = (n: Notice) => Notifications.scheduleNotificationAsync({ content: { title: n.title, body: n.body }, trigger: null }).catch(() => {});

const CALL_WORDS: Record<string, string> = {
  calls_off: 'No call: the server has no phone number set for demo calls.',
  too_soon: 'No call: another demo call started less than a minute ago.',
};

// A small grey label for anything that is not real data.
const Note = ({ text }: { text: string }) => <T v="labelSm" style={{ color: c.onSurfaceVariant, fontStyle: 'italic' }}>{text}</T>;

type Load = { kind: 'loading' } | { kind: 'ready'; data: DemoMap } | { kind: 'error'; message: string };

export default function DemoLocationScreen() {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  // State changes only in the request's callbacks, never synchronously in the effect.
  const load = useCallback(() => api('/api/v1/demo-location').then(
    (data: DemoMap) => setState({ kind: 'ready', data }),
    (e) => setState({ kind: 'error', message: e instanceof FinanceApiError && e.status === 403
      ? 'Only Alex Taylor’s account can use the demo location.'
      : 'Couldn’t load the demo location. Check that the finance backend is running.' }),
  ), []);
  useEffect(() => { void load(); }, [load]);
  return (
    <Screen title="Demo location">
      {state.kind === 'ready' ? <DemoMapView data={state.data} /> : state.kind === 'loading'
        ? <T v="bodySm" style={{ color: c.onSurfaceVariant }}>Loading the stores around UT Dallas…</T>
        : (
          <Card style={{ gap: space.sm }}>
            <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{state.message}</T>
            <Button small label="Try again" onPress={() => { setState({ kind: 'loading' }); void load(); }} />
          </Card>
        )}
    </Screen>
  );
}

function DemoMapView({ data }: { data: DemoMap }) {
  const utd = { latitude: data.center.lat, longitude: data.center.lon };
  const [pos, setPos] = useState<LatLng | null>(null);
  const [gps, setGps] = useState<LatLng | null>(null);
  const [result, setResult] = useState<Move | null>(null);
  const [error, setError] = useState('');
  const latest = useRef(0);

  const move = useCallback((p: LatLng) => {
    setPos(p);
    const mine = ++latest.current;
    api('/api/v1/demo-location', 'POST', { lat: p.latitude, lon: p.longitude }).then(
      (r: Move) => {
        if (r.notice) void showNotice(r.notice); // every newly entered ring, even if a later move overtakes it
        if (mine === latest.current) { setResult(r); setError(''); }
      },
      () => { if (mine === latest.current) setError('Couldn’t save this position. Check the finance backend.'); },
    );
  }, []);

  // Start at the real GPS position; fall back to the last saved demo position, then UT Dallas.
  useEffect(() => {
    let live = true;
    (async () => {
      let here: LatLng | null = null;
      await Notifications.requestPermissionsAsync().catch(() => null); // a refusal only means no banners
      try {
        if ((await Location.requestForegroundPermissionsAsync()).granted) {
          const fix = (await Location.getLastKnownPositionAsync({ maxAge: 60_000 }))
            ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
          here = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
        }
      } catch { /* use the fallback below */ }
      if (!live) return;
      if (here) setGps(here);
      move(here ?? (data.position ? { latitude: data.position.lat, longitude: data.position.lon } : utd));
    })();
    return () => { live = false; };
    // Runs once on open: later moves come from dragging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insideIds = new Set(result?.inside.map((s) => s.id) ?? []);
  return (
    <>
      <View style={{ height: 420, borderRadius: 16, overflow: 'hidden', backgroundColor: c.surfaceContainer }}>
        {pos ? (
          <MapView
            style={{ flex: 1 }}
            initialRegion={{ ...pos, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
            onLongPress={(e) => move(e.nativeEvent.coordinate)}
          >
            <Circle center={utd} radius={data.areaM} strokeColor="rgba(32,103,116,0.6)" strokeWidth={2} fillColor="rgba(32,103,116,0.04)" />
            {data.stores.map((s) => {
              const inside = insideIds.has(s.id);
              return (
                <React.Fragment key={s.id}>
                  <Circle
                    center={{ latitude: s.lat, longitude: s.lon }} radius={s.ringM} strokeWidth={2}
                    strokeColor={inside ? '#2e7d32' : 'rgba(32,103,116,0.9)'}
                    fillColor={inside ? 'rgba(46,125,50,0.25)' : 'rgba(144,209,223,0.25)'}
                  />
                  <Marker
                    coordinate={{ latitude: s.lat, longitude: s.lon }} title={s.name}
                    description={s.deals.map((d) => d.title).join(' · ') || 'No deals'}
                    pinColor={inside ? 'green' : 'teal'} tracksViewChanges={false}
                  />
                </React.Fragment>
              );
            })}
            <Marker
              coordinate={pos} draggable title="You (demo location)" pinColor="navy" zIndex={1000}
              onDragEnd={(e) => move(e.nativeEvent.coordinate)}
            />
          </MapView>
        ) : (
          <T v="bodySm" style={{ color: c.onSurfaceVariant, padding: space.md }}>Finding your location…</T>
        )}
      </View>

      <Card style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="labelLg" style={{ color: c.primary }}>Where the app thinks you are</T>
          <Pill label="Demo location" bg={c.tertiaryContainer} color={c.tertiaryFixed} />
        </Row>
        <T v="bodySm" style={{ color: c.onSurfaceVariant }}>
          Drag the dark pin, or long-press the map, to move. Each store within 5 miles of UT Dallas has a ring; stepping
          inside one checks that store’s deals and calls you about them.
        </T>
        {pos ? <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{pos.latitude.toFixed(5)}, {pos.longitude.toFixed(5)}</T> : null}
        {gps ? <Button small label="Back to my GPS location" icon="crosshairs-gps" onPress={() => move(gps)} /> : null}
        {error ? <T v="bodySm" style={{ color: c.error }}>{error}</T> : null}
      </Card>

      <Card style={{ gap: space.sm }}>
        <SectionTitle title="Stores you’re in front of" sub={result?.inside.length ? undefined : 'Not inside any store ring'} />
        {result?.inside.map((s) => (
          <View key={s.id} style={{ gap: 4 }}>
            <T v="labelLg" style={{ color: c.primary }}>{s.name}</T>
            {s.deals.length ? s.deals.map((d) => (
              <View key={d.id} style={{ gap: 2 }}>
                <T v="bodySm" style={{ color: c.onSurface }}>
                  {d.kind === 'capital_one' ? 'Capital One offer' : 'Store email'}: {d.title}
                  {d.channels.includes('in_store') ? '' : ' (online or pickup only)'}
                </T>
                <Note text={d.label} />
              </View>
            )) : <T v="bodySm" style={{ color: c.onSurfaceVariant }}>No deals here.</T>}
          </View>
        ))}
        {result?.notice ? <T v="bodySm" style={{ color: c.secondary }}>Notification sent: {result.notice.body}</T> : null}
        {result?.call ? (
          <T v="bodySm" style={{ color: c.secondary }}>
            {CALL_WORDS[result.call.state] ?? callWords(result.call.state)}
          </T>
        ) : null}
        {!data.calls ? <Note text="Demo calls are off on this server, so moving here won’t ring your phone." /> : null}
      </Card>
    </>
  );
}
