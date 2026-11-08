import React, { useEffect, useRef, useState } from 'react';
import { Animated, Linking, PanResponder, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { Screen } from '../components/Screen';
import { Button, Icon, IconCircle, Pill, Row, T } from '../components/ui';
import { c, radius, shadow, space } from '../theme';
import { PressScale, useTimed } from '../motion';
import { useApi } from '../finance/useApi';
import { DataState } from '../components/DataState';
import { SAMPLE_OFFER_CLASSIFICATION, callFinished, callWords, isCurrentOffer, labelsLine, sourceWords, type DealsOffer } from '../finance/labels';
import { api } from '../finance/financeApi';
import { useUserLocation } from '../location/useUserLocation';
import { DEMO_AREA, coordsToMapFraction, distanceInMeters, mapFractionToCoords } from '../location/geo';
import { useNearbyStores } from '../location/useNearbyStores';
import { NearbyStore } from '../location/nearbyStores';
import { useFinanceRecommendation } from '../finance/useFinanceRecommendation';
import { FINANCE_API_URL, describeSkip, type FinanceRecommendation } from '../finance/financeApi';

// Search radius choices, in metres. The spec leaves the "GPS bubble" size open.
const RADIUS_OPTIONS = [250, 500, 1000, 2000];
const STORES_SHOWN = 15; // rows listed on screen; the full list is in `nearby.stores`

const MAP_H = 380;
const DOT = 14; // diameter of the user marker, in screen points

// Width of the map area in metres, used to draw the GPS accuracy ring to scale.
const MAP_WIDTH_M = distanceInMeters(
  { latitude: (DEMO_AREA.north + DEMO_AREA.south) / 2, longitude: DEMO_AREA.west },
  { latitude: (DEMO_AREA.north + DEMO_AREA.south) / 2, longitude: DEMO_AREA.east },
);

// A nearby store that matches one of your offers or selected stores, pinned at its real position.
function Pin({ x, y, label, on, onPress }: { x: number; y: number; label: string; on: boolean; onPress: () => void }) {
  const scale = useTimed(on ? 1.05 : 1, 200);
  return (
    <Pressable onPress={onPress} style={{ position: 'absolute', left: x, top: y, zIndex: on ? 30 : 20 }}>
      <Animated.View style={{ alignItems: 'center', transform: [{ translateX: -50 }, { translateY: -30 }, { scale }] }}>
        <View style={[s.pin, { backgroundColor: on ? c.primary : c.surfaceLowest, maxWidth: 140 }]}>
          <Icon name="tag-outline" size={13} color={on ? c.secondaryFixed : c.secondary} />
          <T v="labelSm" numberOfLines={1} style={{ color: on ? c.onPrimary : c.primary, fontFamily: 'Manrope_600SemiBold' }}>{label}</T>
        </View>
        <View style={[s.tail, { backgroundColor: on ? c.primary : c.surfaceLowest }]} />
      </Animated.View>
    </Pressable>
  );
}

// Names compared without case, spaces or punctuation: "Taco Bell", "taco_bell" and "TacoBell" match.
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const matches = (store: NearbyStore, key: string) => {
  const k = norm(key);
  return k.length >= 3 && [store.brand, store.name].some((n) => norm(n).startsWith(k) || k.startsWith(norm(n) || '#'));
};

export default function DealsScreen() {
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const offers = useApi<DealsOffer[]>('/v1/deals/offers');
  const messages = useApi<{ id: string; classification: string }[]>('/v1/deals/messages');
  const selections = useApi<{ stores: { brand_key: string; selected: boolean }[] }>('/api/v1/stores');
  const loc = useUserLocation();
  const [radiusM, setRadiusM] = useState(500);
  // Every store within radiusM of the user. `nearby.result` is the data to hand to the
  // recommendation algorithm once it exists.
  const nearby = useNearbyStores(loc.event, radiusM);
  // The same location events go to the finance backend, which picks a routine offer using the optimizer.
  const finance = useFinanceRecommendation(loc.event, nearby.result?.stores ?? []);
  const [mapW, setMapW] = useState(0);
  const here = loc.event ? coordsToMapFraction(loc.event) : null;

  // Dragging the marker in demo mode. The handlers live in a ref, so they read the latest
  // values through these refs instead of the values from the first render.
  const latest = useRef({ mapW, here, moveDemo: loc.moveDemo, demo: loc.source === 'demo' });
  latest.current = { mapW, here, moveDemo: loc.moveDemo, demo: loc.source === 'demo' };
  const dragStart = useRef({ fx: 0, fy: 0 });
  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.demo,
      onMoveShouldSetPanResponder: () => latest.current.demo,
      onPanResponderGrant: () => {
        dragStart.current = latest.current.here ?? { fx: 0.5, fy: 0.5 };
      },
      onPanResponderMove: (_, g) => {
        const { mapW: w, moveDemo } = latest.current;
        if (!w) return;
        moveDemo(mapFractionToCoords(dragStart.current.fx + g.dx / w, dragStart.current.fy + g.dy / MAP_H));
      },
    }),
  ).current;

  const ringPx =
    loc.event?.source === 'live' && loc.event.accuracyM && mapW
      ? Math.min(MAP_H, (loc.event.accuracyM / MAP_WIDTH_M) * mapW * 2)
      : 0;
  // Size cards to the screen's content column (not the window: on web the app is a 430px column).
  const [width, setWidth] = useState(360);
  const cardW = Math.min(width * 0.9, 320);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sampleMessages = new Set((messages.data ?? []).filter((m) => [SAMPLE_OFFER_CLASSIFICATION,'synthetic_fixture'].includes(m.classification)).map((m) => m.id));
  const q = norm(query);
  const shown = (offers.data ?? []).filter((o) => isCurrentOffer(o) && (!q || norm(o.merchant_name).includes(q) || norm(o.terms.title).includes(q)));
  // Pins: nearby stores whose name matches an offer's merchant or one of your selected stores.
  const keys = [
    ...shown.map((o) => ({ key: o.merchant_name.replace(/\b(rewards|offers?)\b/gi, '').trim(), label: o.terms.title ?? o.merchant_name, offerId: o.id })),
    ...(selections.data?.stores ?? []).filter((x) => x.selected).map((x) => ({ key: x.brand_key, label: `${x.brand_key.replace(/_/g, ' ')} · selected`, offerId: null as string | null })),
  ];
  const pins = mapW > 0 ? nearby.stores.flatMap((st) => {
    const hit = keys.find((k) => matches(st, k.key));
    const p = hit && coordsToMapFraction(st);
    return hit && p ? [{ id: st.id, x: p.fx * mapW, y: p.fy * MAP_H, label: hit.label, offerId: hit.offerId }] : [];
  }).slice(0, 12) : [];

  const select = (id: string | null) => {
    setSel(id);
    const i = shown.findIndex((o) => o.id === id);
    if (i >= 0) scroller.current?.scrollTo({ x: i * (cardW + space.md), animated: true });
  };

  return (
    <Screen title="Nearby Deals">
      <View style={{ gap: space.sm }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={s.searchWrap}>
          <View style={{ position: 'absolute', left: 14, zIndex: 1 }}>
            <Icon name="magnify" size={20} />
          </View>
          <TextInput
            placeholder="Search your offers by store or deal..."
            placeholderTextColor={c.outline}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            style={s.search}
          />
        </View>
      </View>

      <View style={s.map} onLayout={(e) => setMapW(e.nativeEvent.layout.width)}>
        <Svg width="100%" height="100%" viewBox="0 0 400 480" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#90d1df" stopOpacity={0.65} />
              <Stop offset="0.5" stopColor="#206774" stopOpacity={0.35} />
              <Stop offset="1" stopColor="#acedfc" stopOpacity={0.55} />
            </LinearGradient>
          </Defs>
          <Rect width={400} height={480} fill="#f7f3eb" />
          <Path d="M-20 80 Q 90 40 180 90 T 420 50 L 420 0 L -20 0 Z" fill="#e6e2da" opacity={0.6} />
          <Path d="M-10 140 C 60 110, 140 130, 220 100 C 300 70, 360 120, 420 95 L 420 0 L -10 0 Z" fill="#ece8e0" opacity={0.6} />
          <Path d="M -10 170 C 80 160 130 195 210 185 C 290 175 330 210 420 190 L 420 370 C 340 380 270 340 190 365 C 110 390 60 360 -10 375 Z" fill="url(#lake)" />
          <Path d="M 120 365 C 130 420 160 440 175 490" stroke="#90d1df" strokeWidth={18} strokeLinecap="round" opacity={0.6} fill="none" />
          <Path d="M 270 180 C 260 120 280 80 295 -10" stroke="#90d1df" strokeWidth={14} strokeLinecap="round" opacity={0.5} fill="none" />
          <Ellipse cx={230} cy={240} rx={28} ry={4.5} fill="#206774" opacity={0.16} />
          <Ellipse cx={245} cy={243} rx={14} ry={2} fill="#206774" opacity={0.22} />
          <Path d="M -20 270 Q 140 290 240 295 T 430 310" stroke="#fff" strokeWidth={5} opacity={0.9} fill="none" />
          <Path d="M 80 -10 L 80 500" stroke="#fff" strokeWidth={4.5} opacity={0.8} />
          <Path d="M 330 -10 L 310 500" stroke="#fff" strokeWidth={4.5} opacity={0.8} />
          <Path d="M -10 410 Q 180 400 420 440" stroke="#fff" strokeWidth={3.5} opacity={0.75} fill="none" />
          <Path d="M 20 60 C 80 80 110 130 90 200" stroke="#c2c7ca" strokeWidth={1.8} strokeDasharray="4 4" opacity={0.6} fill="none" />
          <G fill="#003221" opacity={0.2}>
            <Polygon points="50,150 54,160 46,160" />
            <Polygon points="62,154 66,164 58,164" />
            <Polygon points="175,172 179,182 171,182" />
            <Polygon points="350,375 354,385 346,385" />
          </G>
        </Svg>

        {mapW > 0
          ? nearby.stores.map((st) => {
              const p = coordsToMapFraction(st);
              if (!p) return null;
              return <View key={st.id} pointerEvents="none" style={[s.store, { left: p.fx * mapW - 4, top: p.fy * MAP_H - 4 }]} />;
            })
          : null}

        {pins.map((p) => (
          <Pin key={p.id} x={p.x} y={p.y} label={p.label} on={!!p.offerId && sel === p.offerId} onPress={() => select(p.offerId)} />
        ))}

        {here && mapW > 0 ? (
          <>
            {ringPx > DOT ? (
              <View
                pointerEvents="none"
                style={[s.ring, { width: ringPx, height: ringPx, borderRadius: ringPx / 2, left: here.fx * mapW - ringPx / 2, top: here.fy * MAP_H - ringPx / 2 }]}
              />
            ) : null}
            <View
              {...drag.panHandlers}
              accessibilityLabel={loc.source === 'demo' ? 'Demo position. Drag to move.' : 'Your live position'}
              hitSlop={16}
              style={[
                s.me,
                loc.source === 'demo' && { backgroundColor: c.tertiaryContainer },
                loc.stale && { opacity: 0.45 },
                { left: here.fx * mapW - DOT / 2, top: here.fy * MAP_H - DOT / 2 },
              ]}
            />
          </>
        ) : null}

        <View style={s.tools}>
          <Pressable
            accessibilityLabel={loc.source === 'live' ? 'Stop live GPS' : 'Use live GPS'}
            style={[s.tool, loc.source === 'live' && { backgroundColor: c.secondary }]}
            onPress={loc.source === 'live' ? loc.stop : loc.startLive}
          >
            <Icon name="crosshairs-gps" size={19} color={loc.source === 'live' ? c.onSecondary : c.primary} />
          </Pressable>
          <Pressable
            accessibilityLabel={loc.source === 'demo' ? 'Stop demo position' : 'Use demo position'}
            style={[s.tool, loc.source === 'demo' && { backgroundColor: c.tertiaryContainer }]}
            onPress={loc.source === 'demo' ? loc.stop : loc.startDemo}
          >
            <Icon name="cursor-move" size={19} color={loc.source === 'demo' ? c.tertiaryFixed : c.primary} />
          </Pressable>
        </View>
        <Row style={s.badge}>
          <Icon name={loc.source === 'live' ? 'crosshairs-gps' : loc.source === 'demo' ? 'cursor-move' : 'map-marker-off-outline'} size={14} />
          <T v="labelSm" style={{ color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 }}>
            {loc.source === 'live' ? 'Live GPS' : loc.source === 'demo' ? 'Demo position' : 'Location off'}
          </T>
        </Row>
      </View>

      <LocationStatusLine loc={loc} onMap={!!here} />

      <RecommendationSection finance={finance} hasLocation={!!loc.event} />

      <NearbyStoresSection nearby={nearby} radiusM={radiusM} onRadius={setRadiusM} hasLocation={!!loc.event} />

      <View style={{ gap: space.xs }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="headlineSm" style={{ color: c.primary }}>Your offers</T>
          {shown.length ? <Pill label={String(shown.length)} bg={c.secondaryContainer} color={c.onSecondaryContainer} /> : null}
        </Row>
        <DataState state={offers.state} onRetry={offers.reload}>
          {() => shown.length ? (
            <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardW + space.md}
              decelerationRate="fast" contentContainerStyle={{ gap: space.md, paddingVertical: 4 }}>
              {shown.map((o) => {
                const sample = o.provenance==='synthetic_fixture'||sampleMessages.has(o.message_id);
                return (
                  <PressScale key={o.id} onPress={() => select(sel === o.id ? null : o.id)} scaleTo={0.985} outerStyle={{ width: cardW }} style={[s.dealCard, sel === o.id && shadow.card]}>
                    <Row style={{ gap: 10, marginBottom: space.sm }}>
                      <IconCircle name="tag-outline" bg={c.surfaceContainer} />
                      <View style={{ flexShrink: 1 }}>
                        <T v="bodyLg" numberOfLines={1} style={{ fontFamily: 'Manrope_600SemiBold', color: c.primary }}>{o.merchant_name}</T>
                        <T v="bodySm" numberOfLines={1} style={{ color: c.onSurfaceVariant }}>
                          {o.expires_at ? `Ends ${new Date(o.expires_at).toLocaleDateString()}` : 'No end date given'}
                        </T>
                      </View>
                    </Row>
                    <View style={s.offer}>
                      <T v="labelMd" numberOfLines={2} style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>{o.terms.title ?? 'Offer terms need review'}</T>
                      {o.terms.minSpendMinor ? <T v="labelSm" style={{ color: c.onSurfaceVariant }}>Minimum spend {dollars(o.terms.minSpendMinor)}</T> : null}
                      {o.terms.channels?.length ? <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{o.terms.channels.map((x) => x.replace(/_/g, ' ')).join(', ')}</T> : null}
                    </View>
                    <T v="labelSm" style={{ color: sample ? c.error : c.outline }}>{sample ? sourceWords('sample_offer') : 'From a store email you received'}</T>
                  </PressScale>
                );
              })}
            </ScrollView>
          ) : (
            <T v="bodySm" style={{ color: c.onSurfaceVariant }}>
              {query ? 'No offers match that search.' : 'No current offers yet. They arrive from store emails once your rewards address is on (Account).'}
            </T>
          )}
        </DataState>
      </View>
    </Screen>
  );
}

// One line under the map saying where the position comes from and anything wrong with it.
// The spec asks for denied permission and stale readings to be shown, not hidden.
function LocationStatusLine({ loc, onMap }: { loc: ReturnType<typeof useUserLocation>; onMap: boolean }) {
  const { status, event, source, stale, ageMs } = loc;
  let text: string;
  let warn = false;
  let settings = false;
  if (status.kind === 'off') {
    text = 'Location is off. Tap the GPS button for your live position, or the move button to drag a demo position.';
  } else if (status.kind === 'requesting') {
    text = 'Getting your location…';
  } else if (status.kind === 'denied') {
    warn = true;
    settings = !status.canAskAgain && Platform.OS !== 'web';
    text = 'Location permission was denied. Allow location while using the app to see where you are.';
  } else if (status.kind === 'error') {
    warn = true;
    text = status.message;
  } else if (source === 'demo' && event) {
    text = `Demo mode: only your position is simulated. Drag the dark marker. ${event.latitude.toFixed(5)}, ${event.longitude.toFixed(5)}`;
  } else if (event) {
    const acc = event.accuracyM === null ? 'accuracy unknown' : `±${Math.round(event.accuracyM)} m`;
    const age = ageMs === null ? '' : ` · updated ${Math.round(ageMs / 1000)} s ago`;
    text = `Live GPS · ${acc}${age}`;
    if (stale) {
      warn = true;
      text += ' · this reading may be out of date';
    }
    if (!onMap) {
      warn = true;
      text += ' · you are outside the map area (Richardson / UT Dallas)';
    }
  } else {
    text = 'Waiting for the first GPS reading…';
  }
  return (
    <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
      <Icon name={warn ? 'alert-circle-outline' : 'information-outline'} size={16} color={warn ? c.error : c.secondary} />
      <View style={{ flexShrink: 1, gap: space.xs }}>
        <T v="bodySm" style={{ color: warn ? c.error : c.onSurfaceVariant }}>{text}</T>
        {settings ? <Button label="Open location settings" small onPress={() => Linking.openSettings()} /> : null}
      </View>
    </Row>
  );
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// The finance backend's answer for the current position: a recommended offer, or the reason
// there is none. The demo token is typed here, never built into the app.
function RecommendationSection({ finance, hasLocation }: { finance: ReturnType<typeof useFinanceRecommendation>; hasLocation: boolean }) {
  const { status } = finance;
  const note = (text: string, warn = false) => <T v="bodySm" style={{ color: warn ? c.error : c.onSurfaceVariant }}>{text}</T>;
  let body: React.ReactNode;
  if (!FINANCE_API_URL) {
    body = note('Set EXPO_PUBLIC_FINANCE_API_URL to the finance backend to get recommendations for this location.');
  } else if (status.kind === 'signed-out') {
    body = note('Find your sandbox account to load your profile.');
  } else if (status.kind === 'loading-profile') {
    body = note('Loading your Nessie finance profile…');
  } else if (status.kind === 'error') {
    body = (
      <View style={{ gap: space.xs }}>
        {note(status.message, true)}
        <Row style={{ gap: space.sm }}>
          <Button label="Try again" small onPress={finance.refreshProfile} />
          <Button label="Sign out" small onPress={finance.signOut} />
        </Row>
      </View>
    );
  } else if (!hasLocation) {
    body = note('Profile loaded. Turn on live GPS or the demo position to check for a routine offer here.');
  } else if (!status.answer) {
    body = note('Checking this location against your routines…');
  } else if (status.answer.kind === 'skip') {
    const reload = status.answer.reason === 'refresh_required' || status.answer.reason === 'profile_required';
    body = (
      <View style={{ gap: space.xs }}>
        {note(describeSkip(status.answer.reason))}
        {reload ? <Button label="Refresh profile" small onPress={finance.refreshProfile} /> : null}
      </View>
    );
  } else {
    body = <RecommendationCard key={`${status.answer.recommendation.offer.id}:${status.answer.recommendation.expiresAt}`} r={status.answer.recommendation} />;
  }
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="headlineSm" style={{ color: c.primary }}>Best choice here</T>
        {status.kind === 'ready' && status.checking ? <Pill label="checking" bg={c.secondaryContainer} color={c.onSecondaryContainer} /> : null}
      </Row>
      {body}
      {status.kind === 'ready' ? (
        <Pressable onPress={finance.signOut}>
          <T v="labelSm" style={{ color: c.outline }}>Sign out</T>
        </Pressable>
      ) : null}
    </View>
  );
}

// One recommendation: what to buy, what to pay with, what applies, what it leaves in the budget,
// and labels for anything not real. Hides itself when it expires; can request a call (team account).
function RecommendationCard({ r }: { r: FinanceRecommendation }) {
  const [now, setNow] = useState(() => Date.now());
  const [call, setCall] = useState<{ state: string } | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Poll the call's status until it reaches a final state.
  useEffect(() => {
    if (!call || callFinished(call.state) || !r.callId) return;
    const t = setTimeout(async () => {
      try { const next = await api(`/api/v1/calls/${r.callId}`); setCall({ state: next.status }); } catch { setCall({ state: 'uncertain' }); }
    }, 3000);
    return () => clearTimeout(t);
  }, [call, r.callId]);
  const left = Math.max(0, Math.round((r.expiresAt - now) / 1000));
  if (left === 0 && !call) return <T v="bodySm" style={{ color: c.onSurfaceVariant }}>This recommendation expired. Move or wait a moment to check this place again.</T>;
  const labels = labelsLine(r.labels);
  const requestCall = async () => {
    setAsking(true);
    try {
      const res = await api(`/api/v1/calls/${r.callId}`, 'POST', { confirmed: true });
      setCall({ state: res.status });
    } catch {
      setCall({ state: 'failed' });
    }
    setAsking(false);
  };
  return (
    <View style={[s.storeRow, { flexDirection: 'column', alignItems: 'stretch', gap: 4 }]}>
      <T v="labelMd" style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>{r.offer.merchant}</T>
      <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{r.explanation.text}</T>
      <T v="labelSm" style={{ color: c.secondary }}>
        Pay {dollars(r.payableCents)} · {dollars(r.cashbackCents)} back · {dollars(r.effectiveCostCents)} effective
      </T>
      {r.payWith ? <T v="labelSm" style={{ color: c.primary }}>Pay with: {r.payWith.label}</T> : null}
      {r.applied?.map((a) => (
        <T key={a.kind + a.label} v="labelSm" style={{ color: c.primary }}>
          + {a.label}{a.provenance === 'synthetic_fixture' || a.provenance === 'sample_offer' ? ' (sample offer)' : ''}
        </T>
      ))}
      {r.loyalty ? (
        <T v="labelSm" style={{ color: c.primary }}>
          +{r.loyalty.points} {r.loyalty.program} points{r.loyalty.valued ? '' : ', not counted as cash'}{r.loyalty.simulatedMembership ? ' · simulated signup (demo)' : ''}
        </T>
      ) : null}
      {r.budgetAfter && Object.keys(r.budgetAfter).length ? (
        <T v="labelSm" style={{ color: c.onSurfaceVariant }}>
          Budget left after this: {Object.entries(r.budgetAfter).map(([k, v]) => `${k} ${dollars(v)}`).join(' · ')}
        </T>
      ) : null}
      {labels ? <T v="labelSm" style={{ color: c.error }}>{labels}</T> : null}
      <T v="labelSm" style={{ color: c.outline }}>
        {r.source === 'demo' ? 'Demo position (only your position is simulated). ' : 'From your live position. '}
        Valid for {left} s.
      </T>
      {r.callId ? (
        call ? <T v="bodySm" style={{ color: c.secondary }}>{callWords(call.state)}</T>
          : <Button label={asking ? 'Requesting…' : 'Call me about this'} small onPress={asking ? undefined : requestCall} />
      ) : null}
    </View>
  );
}

const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// Radius picker plus the list of real stores found around the user (OpenStreetMap data).
function NearbyStoresSection({
  nearby,
  radiusM,
  onRadius,
  hasLocation,
}: {
  nearby: ReturnType<typeof useNearbyStores>;
  radiusM: number;
  onRadius: (m: number) => void;
  hasLocation: boolean;
}) {
  const { status, stores } = nearby;
  let message: string | null = null;
  let warn = false;
  if (!hasLocation) message = 'Turn on live GPS or the demo position to find stores around you.';
  else if (status.kind === 'too-approximate') {
    warn = true;
    message = `Your GPS is only accurate to ±${Math.round(status.accuracyM)} m, wider than the ${formatDistance(radiusM)} radius. Pick a larger radius or wait for a better signal.`;
  } else if (status.kind === 'error') {
    warn = true;
    message = `Couldn’t load nearby stores. ${status.message}`;
  } else if (status.kind === 'searching' && stores.length === 0) message = 'Searching for stores…';
  else if (status.kind === 'ready' && stores.length === 0) message = `No stores found within ${formatDistance(radiusM)}.`;

  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="headlineSm" style={{ color: c.primary }}>Stores within {formatDistance(radiusM)}</T>
        {stores.length > 0 ? <Pill label={`${stores.length}${status.kind === 'searching' ? ' · updating' : ''}`} bg={c.secondaryContainer} color={c.onSecondaryContainer} /> : null}
      </Row>
      <Row style={{ gap: 4 }}>
        {RADIUS_OPTIONS.map((m) => {
          const on = m === radiusM;
          return (
            <Pressable key={m} onPress={() => onRadius(m)} style={[s.chip, on && { backgroundColor: c.secondary }]}>
              <T v="labelMd" style={{ color: on ? c.onSecondary : c.onSurfaceVariant }}>{formatDistance(m)}</T>
            </Pressable>
          );
        })}
      </Row>
      {message ? <T v="bodySm" style={{ color: warn ? c.error : c.onSurfaceVariant }}>{message}</T> : null}
      {stores.slice(0, STORES_SHOWN).map((st: NearbyStore) => (
        <Row key={st.id} style={s.storeRow}>
          <View style={{ flexShrink: 1 }}>
            <T v="labelMd" numberOfLines={1} style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>{st.name}</T>
            <T v="labelSm" numberOfLines={1} style={{ color: c.onSurfaceVariant }}>
              {st.category.value.replace(/_/g, ' ')}
              {st.brand && st.brand !== st.name ? ` · ${st.brand}` : ''}
            </T>
          </View>
          <T v="labelMd" style={{ color: c.secondary }}>{formatDistance(st.distanceM)}</T>
        </Row>
      ))}
      {stores.length > STORES_SHOWN ? (
        <T v="labelSm" style={{ color: c.onSurfaceVariant }}>and {stores.length - STORES_SHOWN} more</T>
      ) : null}
      {hasLocation ? <T v="labelSm" style={{ color: c.outline }}>Store data © OpenStreetMap contributors</T> : null}
    </View>
  );
}

const s = StyleSheet.create({
  store: {
    position: 'absolute', width: 8, height: 8, borderRadius: 4, zIndex: 12,
    backgroundColor: c.onTertiaryContainer, borderWidth: 1, borderColor: '#fff',
  },
  storeRow: {
    justifyContent: 'space-between', gap: space.sm, backgroundColor: c.surfaceLowest,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10,
  },
  me: {
    position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2, zIndex: 35,
    backgroundColor: c.secondary, borderWidth: 2, borderColor: '#fff', ...shadow.sm,
  },
  ring: { position: 'absolute', zIndex: 15, backgroundColor: 'rgba(32,103,116,0.18)' },
  searchWrap: { flexDirection: 'row', alignItems: 'center' },
  search: {
    flex: 1, height: 44, paddingLeft: 40, paddingRight: 40, backgroundColor: c.surfaceLowest,
    borderRadius: radius.lg, fontFamily: 'Manrope_400Regular', fontSize: 14, color: c.onSurface, ...shadow.sm,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: c.surfaceContainer,
  },
  map: { height: MAP_H, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.surfaceLow },
  pin: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.full, ...shadow.sm,
  },
  tail: { width: 8, height: 8, transform: [{ rotate: '45deg' }], marginTop: -4, borderRadius: 1 },
  tools: { position: 'absolute', top: 12, right: 12, gap: 8, zIndex: 40 },
  tool: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center', ...shadow.sm,
  },
  badge: {
    position: 'absolute', bottom: 12, left: 12, gap: 6, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.85)', zIndex: 40,
  },
  dealCard: { backgroundColor: c.surfaceLowest, borderRadius: radius.lg, padding: space.md, ...shadow.sm },
  reward: { backgroundColor: c.secondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.md },
  offer: {
    backgroundColor: c.surfaceLow, borderRadius: radius.md, padding: 10, marginBottom: space.sm,
    justifyContent: 'space-between',
  },
  promise: { gap: space.sm, backgroundColor: c.surfaceLow, borderRadius: radius.lg, padding: space.md },
});
