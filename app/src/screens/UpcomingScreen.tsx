import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen } from '../components/Screen';
import { Button, Card, Icon, IconCircle, Pill, Row, T, Toggle } from '../components/ui';
import { c, radius, shadow, space, tnum } from '../theme';
import { bills, days, incomes, money } from '../mock/sample';

const out = bills.reduce((a, b) => a + b.amt, 0);
const inn = incomes.reduce((a, b) => a + b.amt, 0);

export default function UpcomingScreen() {
  const [day, setDay] = useState('25');
  const [auto, setAuto] = useState(true);

  return (
    <Screen title="Upcoming Cashflow">
      <View style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: c.primaryContainer, padding: space.lg, gap: 8, ...shadow.card }}>
        <View style={{ position: 'absolute', inset: 0, opacity: 0.25 }} pointerEvents="none">
          <Svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="none">
            <Path d="M0 60 Q100 40 200 65 T400 50 L400 160 L0 160 Z" fill="#206774" />
            <Path d="M0 90 Q120 70 240 95 T400 85 L400 160 L0 160 Z" fill="#95d4b5" />
            <Path d="M0 120 Q90 105 210 125 T400 115 L400 160 L0 160 Z" fill="#acedfc" />
          </Svg>
        </View>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full }}>
            <Icon name="water" size={16} color={c.tertiaryFixedDim} />
            <T v="labelSm" style={{ color: c.surfaceLow, textTransform: 'uppercase', letterSpacing: 0.8 }}>Cashflow Equilibrium</T>
          </Row>
          <T v="labelSm" style={{ color: c.secondaryFixed }}>October — November</T>
        </Row>
        <T v="labelMd" style={{ color: c.surfaceHighest, textTransform: 'uppercase', letterSpacing: 1 }}>Projected Net Liquidity</T>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <T v="headlineLgMobile" style={[{ color: c.surface }, tnum]}>+ {money(inn - out)}</T>
          <Row style={{ gap: 2 }}>
            <Icon name="trending-up" size={14} color={c.tertiaryFixedDim} />
            <T v="labelSm" style={{ color: c.tertiaryFixedDim }}>+12.4% safe margin</T>
          </Row>
        </Row>
        <Row style={{ gap: 8, marginTop: 8, alignItems: 'stretch' }}>
          <Metric dot={c.error} label="Committed Outflow" labelColor={c.errorContainer} amt={out} sub={`${bills.length} pending bills`} />
          <Metric dot={c.tertiaryFixedDim} label="Expected Inflow" labelColor={c.tertiaryFixed} amt={inn} sub={`${incomes.length} incoming transfers`} subColor={c.tertiaryFixedDim} />
        </Row>
      </View>

      <View style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Row style={{ gap: 8 }}>
            <Icon name="calendar-today" size={18} />
            <T v="headlineSm" style={{ color: c.primary }}>Payment River</T>
          </Row>
          <T v="labelSm" style={{ color: c.secondary }}>Next 14 Days</T>
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingHorizontal: 4 }}>
          {days.map((d) => {
            const on = day === d.d;
            const dotColor = d.kind === 'out' ? c.error : d.kind === 'in' ? c.onTertiaryFixedVariant : 'transparent';
            return (
              <Pressable
                key={d.d}
                onPress={() => setDay(d.d)}
                style={{
                  width: 52, height: 72, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? c.primary : d.kind === 'in' ? c.secondaryContainer : d.kind === 'none' ? c.surfaceLow : c.surfaceLowest,
                  ...(d.kind !== 'none' ? shadow.sm : {}),
                }}
              >
                <T v="labelSm" style={{ color: on ? c.surfaceHighest : c.onSurfaceVariant }}>{d.dow}</T>
                <T v="headlineSm" style={{ color: on ? c.surface : c.onSurface }}>{d.d}</T>
                <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 4, backgroundColor: dotColor }} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ gap: 8 }}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Row style={{ gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.error }} />
            <T v="headlineSm" style={{ color: c.primary }}>Bills &amp; Debt Due</T>
          </Row>
          <T v="mono" style={[{ color: c.error }, tnum]}>- {money(out)}</T>
        </Row>
        {bills.map((b) => (
          <Card key={b.name} style={{ padding: space.md, gap: 8 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Row style={{ gap: 8, flexShrink: 1 }}>
                <IconCircle name={b.icon} color={c.primary} />
                <View style={{ flexShrink: 1 }}>
                  <T v="labelLg" numberOfLines={1} style={{ color: c.primary }}>{b.name}</T>
                  <Row style={{ gap: 6 }}>
                    <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{b.line}</T>
                    <T v="bodySm" style={{ color: b.tagErr ? c.error : c.onSurfaceVariant, fontFamily: 'Manrope_500Medium' }}>• {b.tag}</T>
                  </Row>
                </View>
              </Row>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="mono" style={[{ color: c.error }, tnum]}>- {money(b.amt)}</T>
                <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{b.acct}</T>
              </View>
            </Row>
            {b.autopay ? (
              <Row style={{ justifyContent: 'space-between', backgroundColor: 'rgba(247,243,235,0.6)', borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Row style={{ gap: 6 }}>
                  <Icon name="autorenew" size={16} />
                  <T v="labelSm">Auto-Pay {auto ? 'Activated' : 'Off'}</T>
                </Row>
                <View style={{ transform: [{ scale: 0.8 }] }}><Toggle value={auto} onChange={setAuto} /></View>
              </Row>
            ) : null}
            {b.pay ? (
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ gap: 6 }}>
                  <Icon name="exclamation-thick" size={16} color={c.error} />
                  <T v="labelSm" style={{ color: c.onSurfaceVariant }}>Manual clearance</T>
                </Row>
                <Button label="Pay Now" small />
              </Row>
            ) : null}
          </Card>
        ))}
      </View>

      <View style={{ gap: 8 }}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Row style={{ gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.onTertiaryFixedVariant }} />
            <T v="headlineSm" style={{ color: c.primary }}>Expected Inflow</T>
          </Row>
          <T v="mono" style={[{ color: c.onTertiaryFixedVariant }, tnum]}>+ {money(inn)}</T>
        </Row>
        {incomes.map((i) => (
          <Card key={i.name} style={{ padding: space.md }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Row style={{ gap: 8, flexShrink: 1 }}>
                <IconCircle name={i.icon} bg={c.tertiaryFixed} color={c.onTertiaryFixed} />
                <View style={{ flexShrink: 1 }}>
                  <T v="labelLg" numberOfLines={1} style={{ color: c.primary }}>{i.name}</T>
                  <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{i.line} • {i.date}</T>
                </View>
              </Row>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <T v="mono" style={[{ color: c.onTertiaryFixedVariant }, tnum]}>+ {money(i.amt)}</T>
                <Pill
                  label={i.status}
                  bg={i.status === 'Verified' ? c.tertiaryFixed : c.surfaceHigh}
                  color={i.status === 'Verified' ? c.onTertiaryFixedVariant : c.onSurfaceVariant}
                />
              </View>
            </Row>
          </Card>
        ))}
      </View>

      <Row style={{ gap: 16, backgroundColor: c.surfaceHigh, borderRadius: radius.lg, padding: space.md }}>
        <IconCircle name="spa-outline" size={48} bg={c.surfaceLowest} />
        <View style={{ flexShrink: 1 }}>
          <T v="labelMd" style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>Tranquil Cash Cushion</T>
          <T v="bodySm" style={{ color: c.onSurfaceVariant }}>
            Your checking account maintains a healthy surplus of {money(inn - out)} past all pending due dates.
          </T>
        </View>
      </Row>

      <Button label="Schedule New Payment / Transfer" icon="plus-circle-outline" />
    </Screen>
  );
}

function Metric({ dot, label, labelColor, amt, sub, subColor }: { dot: string; label: string; labelColor: string; amt: number; sub: string; subColor?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.lg, padding: space.sm, justifyContent: 'space-between' }}>
      <Row style={{ gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
        <T v="labelSm" style={{ color: labelColor }}>{label}</T>
      </Row>
      <View style={{ marginTop: 8 }}>
        <T v="mono" style={[{ color: c.surface }, tnum]}>{money(amt)}</T>
        <T v="bodySm" style={{ color: subColor ?? c.surfaceHighest, opacity: 0.85 }}>{sub}</T>
      </View>
    </View>
  );
}
