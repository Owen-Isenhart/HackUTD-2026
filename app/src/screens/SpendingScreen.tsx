import React from 'react';
import { Animated, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useReveal } from '../motion';
import { Screen } from '../components/Screen';
import { Button, Card, Icon, IconCircle, Pill, Row, SectionTitle, T } from '../components/ui';
import { c, radius, space, tnum } from '../theme';
import { money, spendCategories, transactions } from '../mock/sample';

const R = 60;
const CIRC = 2 * Math.PI * R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const total = spendCategories.reduce((a, x) => a + x.amt, 0);

export default function SpendingScreen() {
  let offset = 0;
  const reveal = useReveal(450);
  return (
    <Screen title="Current Spending">
      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
          <Row style={{ gap: 6, backgroundColor: c.surfaceContainer, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full }}>
            <Icon name="calendar-month-outline" size={18} />
            <T v="labelMd" style={{ color: c.primary }}>October 2024</T>
            <Icon name="chevron-down" size={16} color={c.onSurfaceVariant} />
          </Row>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.surfaceContainer, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chart-line" size={18} />
          </View>
        </Row>
        <T v="labelSm" style={{ color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 }}>Total Disbursed This Month</T>
        <T v="displayMobile" style={[{ color: c.primary }, tnum]}>{money(total)}</T>
        <Row style={{ gap: 4, marginTop: 2 }}>
          <Icon name="arrow-down" size={16} color={c.onTertiaryContainer} />
          <T v="labelMd" style={{ color: c.onTertiaryContainer, fontFamily: 'Manrope_600SemiBold' }}>8.4% less</T>
          <T v="labelMd" style={{ color: c.onSurfaceVariant, fontFamily: 'Manrope_400Regular' }}>than September pace</T>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(230,226,218,0.5)' }}>
          <Row style={{ gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.secondary }} />
            <T v="bodySm" style={{ color: c.onSurfaceVariant }}>Daily Average: <T v="bodySm" style={[{ color: c.primary, fontFamily: 'Manrope_700Bold' }, tnum]}>{money(total / 31)}</T></T>
          </Row>
          <Pill label="On Target" bg="rgba(172,237,252,0.5)" color={c.secondary} />
        </Row>
      </Card>

      <Card style={{ alignItems: 'center' }}>
        <View style={{ alignSelf: 'stretch' }}>
          <SectionTitle title="Spending Flow" sub="Tranquil distribution by category" right={<Icon name="water-outline" />} />
        </View>
        <View style={{ width: 208, height: 208, marginVertical: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width="100%" height="100%" viewBox="0 0 160 160" style={{ transform: [{ rotate: '-90deg' }] }}>
            {spendCategories.map((cat) => {
              const len = (cat.pct / 100) * CIRC;
              const el = (
                <AnimatedCircle
                  key={cat.name}
                  cx={80} cy={80} r={R}
                  fill="none" stroke={cat.color} strokeWidth={16}
                  strokeDasharray={[reveal.interpolate({ inputRange: [0, 1], outputRange: [0, len] }), CIRC] as any}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
          </Svg>
          <View style={{ position: 'absolute', alignItems: 'center' }}>
            <T v="labelSm" style={{ color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 }}>Outflow</T>
            <T v="headlineMd" style={[{ color: c.primary }, tnum]}>${Math.round(total).toLocaleString()}</T>
            <T v="labelSm" style={{ color: c.secondary }}>{spendCategories.length} Categories</T>
          </View>
        </View>
        <Row style={{ flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {spendCategories.slice(0, 5).map((cat) => (
            <Row key={cat.name} style={{ gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cat.color }} />
              <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{cat.short}</T>
            </Row>
          ))}
        </Row>
      </Card>

      <Card style={{ gap: 16 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="headlineSm" style={{ color: c.primary }}>Category Allocation</T>
          <T v="labelMd" style={{ color: c.secondary }}>View All</T>
        </Row>
        {spendCategories.map((cat) => (
          <View key={cat.name} style={{ gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row style={{ gap: 10, flexShrink: 1 }}>
                <IconCircle name={cat.icon} size={32} bg={c.surfaceContainer} color={c.primaryContainer} />
                <View style={{ flexShrink: 1 }}>
                  <T v="labelLg" numberOfLines={1} style={{ color: c.primary }}>{cat.name}</T>
                  <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{cat.sub}</T>
                </View>
              </Row>
              <View style={{ alignItems: 'flex-end', paddingLeft: 8 }}>
                <T v="labelLg" style={[{ color: c.primary }, tnum]}>{money(cat.amt)}</T>
                <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{cat.pct}%</T>
              </View>
            </Row>
            <View style={{ height: 8, backgroundColor: c.surfaceContainer, borderRadius: 4, overflow: 'hidden' }}>
              <Animated.View style={{ width: `${cat.pct}%`, height: '100%', backgroundColor: cat.color, borderRadius: 4, transformOrigin: 'left', transform: [{ scaleX: reveal }] }} />
            </View>
          </View>
        ))}
      </Card>

      <Row style={{ gap: 12, backgroundColor: c.surfaceContainer, borderRadius: radius.lg, padding: space.md }}>
        <IconCircle name="spa-outline" bg={c.surfaceLowest} />
        <View style={{ flexShrink: 1 }}>
          <T v="labelMd" style={{ color: c.primary, fontFamily: 'Manrope_600SemiBold' }}>Mindful Financial Rhythm</T>
          <T v="bodySm" style={{ color: c.onSurfaceVariant }}>You have stayed under your daily baseline for 19 consecutive days this autumn.</T>
        </View>
      </Row>

      <Card style={{ gap: 14 }}>
        <SectionTitle title="Recent Transactions" sub="Last activity across Stillwater accounts" />
        {transactions.map((t) => (
          <Row key={t.name} style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 12, flexShrink: 1 }}>
              <IconCircle name={t.icon} bg="#f2ece9" />
              <View style={{ flexShrink: 1 }}>
                <T v="labelLg" numberOfLines={1} style={{ color: c.primary }}>{t.name}</T>
                <Row style={{ gap: 6 }}>
                  <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{t.when}</T>
                  <Pill label={t.cat} bg={c.surfaceContainer} color={c.secondary} style={{ borderRadius: 4, paddingVertical: 0 }} />
                </Row>
              </View>
            </Row>
            <T v="labelLg" style={[{ color: c.error, fontFamily: 'Manrope_600SemiBold' }, tnum]}>-{money(Math.abs(t.amt))}</T>
          </Row>
        ))}
        <Button label="Download October Spending Statement" icon="receipt-text-outline" textColor={c.primary} style={{ backgroundColor: c.surfaceContainer }} />
      </Card>
    </Screen>
  );
}
