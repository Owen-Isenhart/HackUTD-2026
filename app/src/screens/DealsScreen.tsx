import React, { useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { Screen } from '../components/Screen';
import { Button, Card, Icon, IconCircle, Pill, Row, T } from '../components/ui';
import { c, radius, shadow, space } from '../theme';
import { PressScale, useTimed } from '../motion';
import { dealCategories, deals } from '../mock/sample';

const MAP_H = 380;

function Pin({ d, on, onPress }: { d: (typeof deals)[number]; on: boolean; onPress: () => void }) {
  const scale = useTimed(on ? 1.05 : 1, 200);
  return (
    <Pressable
      onPress={onPress}
      style={{ position: 'absolute', left: `${(d.pin.x / 400) * 100}%`, top: (d.pin.y / 480) * MAP_H, zIndex: on ? 30 : 20 }}
    >
      <Animated.View style={{ alignItems: 'center', transform: [{ translateX: -60 }, { translateY: -30 }, { scale }] }}>
        <View style={[s.pin, { backgroundColor: on ? c.primary : c.surfaceLowest }]}>
          <Icon name={d.icon} size={13} color={on ? c.secondaryFixed : c.secondary} />
          <T v="labelSm" style={{ color: on ? c.onPrimary : c.primary, fontFamily: 'Manrope_600SemiBold' }}>
            {d.reward} • {d.merchant.split(' ')[0]}
          </T>
        </View>
        <View style={[s.tail, { backgroundColor: on ? c.primary : c.surfaceLowest }]} />
      </Animated.View>
    </Pressable>
  );
}

export default function DealsScreen() {
  const [sel, setSel] = useState(1);
  const [cat, setCat] = useState('All');
  const { width } = useWindowDimensions();
  const cardW = Math.min(width * 0.84, 320);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const shown = deals.filter((d) => cat === 'All' || d.cat === cat);

  const select = (id: number) => {
    setSel(id);
    const i = shown.findIndex((d) => d.id === id);
    if (i >= 0) scroller.current?.scrollTo({ x: i * (cardW + space.md), animated: true });
  };

  return (
    <Screen title="Nearby Deals">
      <View style={{ gap: space.sm }}>
        <View style={s.searchWrap}>
          <View style={{ position: 'absolute', left: 14, zIndex: 1 }}>
            <Icon name="magnify" size={20} />
          </View>
          <TextInput
            placeholder="Search local rewards, cafes, merchants..."
            placeholderTextColor={c.outline}
            style={s.search}
          />
          <View style={{ position: 'absolute', right: 12 }}>
            <Icon name="microphone-outline" size={18} color={c.outline} />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          {dealCategories.map((name) => {
            const on = cat === name;
            const n = name === 'All' ? deals.length : deals.filter((d) => d.cat === name).length;
            return (
              <Pressable key={name} onPress={() => setCat(name)} style={[s.chip, on && { backgroundColor: c.secondary }]}>
                <T v="labelMd" style={{ color: on ? c.onSecondary : c.onSurfaceVariant }}>{name}</T>
                <T v="labelSm" style={{ color: on ? c.onSecondary : c.onSurfaceVariant, opacity: 0.7 }}>{n}</T>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={s.map}>
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
          <Circle cx={155} cy={280} r={14} fill="#206774" opacity={0.2} />
          <Circle cx={155} cy={280} r={7} fill="#206774" stroke="#fff" strokeWidth={2} />
        </Svg>

        {shown.map((d) => (
          <Pin key={d.id} d={d} on={sel === d.id} onPress={() => select(d.id)} />
        ))}

        <View style={s.tools}>
          {(['crosshairs-gps', 'format-list-bulleted', 'tune-variant'] as const).map((n) => (
            <Pressable key={n} style={s.tool} onPress={n === 'crosshairs-gps' ? () => select(1) : undefined}>
              <Icon name={n} size={19} color={c.primary} />
            </Pressable>
          ))}
        </View>
        <Row style={s.badge}>
          <Icon name="waves" size={14} />
          <T v="labelSm" style={{ color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 }}>Lake Basin Area</T>
        </Row>
      </View>

      <View style={{ gap: space.xs }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 6 }}>
            <T v="headlineSm" style={{ color: c.primary }}>Featured Perks</T>
            <Pill label="Near You" bg={c.secondaryContainer} color={c.onSecondaryContainer} />
          </Row>
          <Row>
            <T v="labelMd" style={{ color: c.secondary }}>View all {deals.length}</T>
            <Icon name="chevron-right" size={16} />
          </Row>
        </Row>
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardW + space.md}
          decelerationRate="fast"
          contentContainerStyle={{ gap: space.md, paddingVertical: 4 }}
        >
          {shown.map((d) => (
            <PressScale key={d.id} onPress={() => select(d.id)} scaleTo={0.985} outerStyle={{ width: cardW }} style={[s.dealCard, sel === d.id && shadow.card]}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space.sm }}>
                <Row style={{ gap: 10, flexShrink: 1 }}>
                  <IconCircle name={d.icon} bg={c.surfaceContainer} />
                  <View style={{ flexShrink: 1 }}>
                    <T v="bodyLg" numberOfLines={1} style={{ fontFamily: 'Manrope_600SemiBold', color: c.primary }}>{d.merchant}</T>
                    <T v="bodySm" numberOfLines={1} style={{ color: c.onSurfaceVariant }}>{d.dist} away • {d.area}</T>
                  </View>
                </Row>
                <View style={s.reward}>
                  <T v="labelSm" style={{ color: c.onSecondary, fontFamily: 'Manrope_600SemiBold' }}>{d.reward}</T>
                </View>
              </Row>
              <Row style={s.offer}>
                <View style={{ flexShrink: 1, paddingRight: 8 }}>
                  <T v="labelMd" numberOfLines={1} style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>{d.title}</T>
                  <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{d.sub}</T>
                </View>
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ gap: 6, flexShrink: 1 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.tertiaryFixedDim }} />
                  <T v="labelSm" numberOfLines={1} style={{ color: c.onSurfaceVariant }}>{d.note}</T>
                </Row>
                <Button label={d.cta} small />
              </Row>
            </PressScale>
          ))}
        </ScrollView>
      </View>

      <Row style={[s.promise]}>
        <IconCircle name="shield-check-outline" size={32} bg="rgba(32,103,116,0.15)" />
        <View style={{ flexShrink: 1 }}>
          <T v="labelMd" style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>Effortless Local Cashback</T>
          <T v="bodySm" style={{ color: c.onSurfaceVariant }}>Rewards land silently into your Primary Checking within 24 hours of swipe.</T>
        </View>
      </Row>
    </Screen>
  );
}

const s = StyleSheet.create({
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
