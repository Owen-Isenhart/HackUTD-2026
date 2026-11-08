import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { api } from '../finance/financeApi';
import { Button, Icon, IconCircle, IconName, Pill, Row, T } from '../components/ui';
import { c, radius, shadow, space } from '../theme';
import { PressScale } from '../motion';
import CampusMap from '../components/CampusMap';
import { useAppSummary } from '../finance/useAppSummary';
import { useNearby, type NearbyStore } from '../finance/useNearby';
import { useUserLocation } from '../location/useUserLocation';
import { distanceInMeters } from '../location/geo';

const MAP_H = 380;
const UTD = { latitude: 32.98666, longitude: -96.74888 };
const NEAR_UTD_M = 8000; // farther than this, show the campus instead of the user's position

const ICON: Record<string, IconName> = {
  dining: 'silverware-fork-knife', coffee: 'coffee-outline', groceries: 'basket-outline', fuel: 'gas-station-outline',
  retail: 'shopping-outline', electronics: 'cellphone', travel: 'airplane',
};
const LABEL: Record<string, string> = {
  dining: 'Dining', coffee: 'Coffee', groceries: 'Groceries', fuel: 'Fuel', retail: 'Retail', electronics: 'Tech', travel: 'Travel',
};
const icon = (cat: string) => ICON[cat] ?? 'storefront-outline';
const label = (cat: string) => LABEL[cat] ?? 'Other';
const far = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1609).toFixed(1)} mi`);
const topOffer = (s: NearbyStore) => s.offers.find((o) => o.source === 'tiger') ?? s.offers.find((o) => o.source === 'demo') ?? s.offers[0];
const hasDeal = (s: NearbyStore) => s.offers.some((o) => o.source !== 'card');
const shortReward = (title: string) => {
  const m = /(\d+%\s*(?:back|off)|\$\d+\s*off|free [a-z0-9 -]+?(?= with| on|$)|bogo)/i.exec(title);
  return m ? m[0].replace(/^\w/, (x) => x.toUpperCase()) : 'Offer';
};

export default function DealsScreen() {
  const loc = useUserLocation();
  // Answers only for Alex Taylor's account; for anyone else it fails and the button stays hidden.
  const [demoAllowed, setDemoAllowed] = useState(false);
  useEffect(() => { api('/api/v1/demo-location').then(() => setDemoAllowed(true), () => setDemoAllowed(false)); }, []);
  const summary = useAppSummary();
  const [cat, setCat] = useState('All');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [width, setWidth] = useState(360);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  // Ask for GPS as soon as the tab opens.
  const asked = useRef(false);
  const { startLive } = loc;
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    startLive();
  }, [startLive]);

  const live = loc.event?.source === 'live' ? { latitude: loc.event.latitude, longitude: loc.event.longitude } : null;
  const nearCampus = !!live && distanceInMeters(live, UTD) <= NEAR_UTD_M;
  const queryAt = useMemo(
    () => (nearCampus && live ? live : UTD),
    // Re-center only when the rounded position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nearCampus, live && live.latitude.toFixed(4), live && live.longitude.toFixed(4)],
  );
  const nearby = useNearby(queryAt);
  const stores = useMemo(() => nearby.data?.stores ?? [], [nearby.data]);

  const cats = ['All', ...new Set(stores.filter(hasDeal).map((s) => label(s.category)))];
  const filtered = stores.filter((s) => (cat === 'All' || label(s.category) === cat)
    && (!query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase())));
  const perks = filtered.filter(hasDeal);
  const cardW = Math.min(width * 0.9, 320);
  const best = nearby.data?.best ?? null;
  const pins = filtered.map((s) => ({
    id: s.id, latitude: s.latitude, longitude: s.longitude, icon: icon(s.category), hasOffer: hasDeal(s),
    label: `${shortReward(topOffer(s).title)} • ${s.name.split(/[ (]/)[0]}`,
  }));

  const select = (id: string) => {
    setSel(id);
    const i = perks.findIndex((s) => s.id === id);
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
            value={query}
            onChangeText={setQuery}
            placeholder="Search UTD rewards, cafes, merchants..."
            placeholderTextColor={c.outline}
            style={s.search}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          {cats.map((name) => {
            const on = cat === name;
            const n = stores.filter((x) => hasDeal(x) && (name === 'All' || label(x.category) === name)).length;
            return (
              <Pressable key={name} onPress={() => setCat(name)} style={[s.chip, on && { backgroundColor: c.secondary }]}>
                <T v="labelMd" style={{ color: on ? c.onSecondary : c.onSurfaceVariant }}>{name}</T>
                <T v="labelSm" style={{ color: on ? c.onSecondary : c.onSurfaceVariant, opacity: 0.7 }}>{n}</T>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View>
        <CampusMap center={queryAt} stores={pins} selected={sel} onSelect={select} position={live} height={MAP_H} />
        <View style={s.tools} pointerEvents="box-none">
          <Pressable
            accessibilityLabel={loc.source === 'live' ? 'Stop live GPS' : 'Use live GPS'}
            style={[s.tool, loc.source === 'live' && { backgroundColor: c.secondary }]}
            onPress={loc.source === 'live' ? loc.stop : loc.startLive}
          >
            <Icon name="crosshairs-gps" size={19} color={loc.source === 'live' ? c.onSecondary : c.primary} />
          </Pressable>
        </View>
        <Row style={s.badge}>
          <Icon name={nearCampus ? 'crosshairs-gps' : 'school-outline'} size={14} />
          <T v="labelSm" style={{ color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 }}>
            {nearCampus ? 'Live GPS' : 'UT Dallas'}
          </T>
        </Row>
      </View>

      {demoAllowed ? (
        <Button label="Demo location: move around UT Dallas" icon="map-marker-radius" onPress={() => router.push('/demo-location')} />
      ) : null}
      <LocationLine loc={loc} live={live} nearCampus={nearCampus} />
      {nearby.error ? <T v="bodySm" style={{ color: c.error }}>{nearby.error}</T> : null}

      <View style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="headlineSm" style={{ color: c.primary }}>Best choice here</T>
          {best ? <Pill label={best.source === 'nemotron' ? 'Nemotron' : 'Closest'} bg={c.secondaryContainer} color={c.onSecondaryContainer} /> : null}
        </Row>
        <Pressable onPress={() => best && select(best.storeId)} style={s.storeRow}>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <T v="labelMd" style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>
              {best?.title ?? (nearby.data ? 'No offers nearby' : 'Finding stores near you…')}
            </T>
            {best ? <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{best.text}</T> : null}
            {summary.data?.recommendation ? (
              <T v="labelSm" style={{ color: c.secondary, marginTop: 4 }}>
                Money tip: {summary.data.recommendation.title}
              </T>
            ) : null}
          </View>
        </Pressable>
      </View>

      <View style={{ gap: space.xs }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 6 }}>
            <T v="headlineSm" style={{ color: c.primary }}>Featured Perks</T>
            <Pill label="Near You" bg={c.secondaryContainer} color={c.onSecondaryContainer} />
          </Row>
          <T v="labelMd" style={{ color: c.secondary }}>{perks.length} offers</T>
        </Row>
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardW + space.md}
          decelerationRate="fast"
          contentContainerStyle={{ gap: space.md, paddingVertical: 4 }}
        >
          {perks.map((st) => {
            const o = topOffer(st);
            const card = st.offers.find((x) => x.source === 'card');
            return (
              <PressScale key={st.id} onPress={() => select(st.id)} scaleTo={0.985} outerStyle={{ width: cardW }} style={[s.dealCard, sel === st.id && shadow.card]}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space.sm }}>
                  <Row style={{ gap: 10, flexShrink: 1 }}>
                    <IconCircle name={icon(st.category)} bg={c.surfaceContainer} />
                    <View style={{ flexShrink: 1 }}>
                      <T v="bodyLg" numberOfLines={1} style={{ fontFamily: 'Manrope_600SemiBold', color: c.primary }}>{st.name}</T>
                      <T v="bodySm" numberOfLines={1} style={{ color: c.onSurfaceVariant }}>{far(st.distanceM)} away • {st.address}</T>
                    </View>
                  </Row>
                  <View style={s.reward}>
                    <T v="labelSm" style={{ color: c.onSecondary, fontFamily: 'Manrope_600SemiBold' }}>{shortReward(o.title)}</T>
                  </View>
                </Row>
                <Row style={s.offer}>
                  <View style={{ flexShrink: 1, paddingRight: 8 }}>
                    <T v="labelMd" numberOfLines={2} style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>{o.title}</T>
                    <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{o.detail}</T>
                  </View>
                </Row>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row style={{ gap: 6, flexShrink: 1 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: o.source === 'tiger' ? c.tertiaryFixedDim : c.outlineVariant }} />
                    <T v="labelSm" numberOfLines={1} style={{ color: c.onSurfaceVariant }}>
                      {o.source === 'tiger' ? 'Saved offer (Tiger Data)' : 'Demo offer'}
                      {st.visits90d ? ` • ${st.visits90d} visits` : ''}
                      {card ? ` • +${card.title.split(' ')[0]} card` : ''}
                    </T>
                  </Row>
                  <Button label="Directions" small onPress={() => {
                    const q = `${st.latitude},${st.longitude}`;
                    void Linking.openURL(Platform.OS === 'ios' ? `maps://?daddr=${q}` : `geo:${q}?q=${q}(${encodeURIComponent(st.name)})`);
                  }} />
                </Row>
              </PressScale>
            );
          })}
        </ScrollView>
      </View>

      <Row style={s.promise}>
        <IconCircle name="shield-check-outline" size={32} bg="rgba(32,103,116,0.15)" />
        <View style={{ flexShrink: 1 }}>
          <T v="labelMd" style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>SavorOne Cashback</T>
          <T v="bodySm" style={{ color: c.onSurfaceVariant }}>
            3% back on dining, coffee and groceries, 1% everywhere else. Campus offers marked demo are samples, not live promotions.
          </T>
        </View>
      </Row>
    </Screen>
  );
}

function LocationLine({ loc, live, nearCampus }: { loc: ReturnType<typeof useUserLocation>; live: { latitude: number; longitude: number } | null; nearCampus: boolean }) {
  const { status } = loc;
  let text = 'Getting your location…', warn = false, settings = false;
  if (status.kind === 'denied') {
    warn = true;
    settings = !status.canAskAgain && Platform.OS !== 'web';
    text = 'Location permission was denied, so the map shows UT Dallas. Allow location to see stores around you.';
  } else if (status.kind === 'error') {
    warn = true;
    text = status.message;
  } else if (status.kind === 'off') {
    text = 'Location is off. Tap the GPS button to see stores around you. Showing UT Dallas.';
  } else if (live && !nearCampus) {
    text = `You're ${(distanceInMeters(live, UTD) / 1609).toFixed(0)} mi from UT Dallas, so the map shows campus.`;
  } else if (live) {
    const acc = loc.event?.accuracyM == null ? '' : ` · ±${Math.round(loc.event.accuracyM)} m`;
    text = `Live GPS${acc} · sorted by distance from you`;
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

const s = StyleSheet.create({
  storeRow: {
    justifyContent: 'space-between', gap: space.sm, backgroundColor: c.surfaceLowest,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10,
  },
  searchWrap: { flexDirection: 'row', alignItems: 'center' },
  search: {
    flex: 1, height: 44, paddingLeft: 40, paddingRight: 16, backgroundColor: c.surfaceLowest,
    borderRadius: radius.lg, fontFamily: 'Manrope_400Regular', fontSize: 14, color: c.onSurface, ...shadow.sm,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: c.surfaceContainer,
  },
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
