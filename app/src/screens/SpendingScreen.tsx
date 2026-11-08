import React, { useMemo, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';
import { useReveal } from '../motion';
import { Screen } from '../components/Screen';
import { Button, Card, Icon, IconCircle, IconName, Pill, Row, SectionTitle, T } from '../components/ui';
import { DataState, Tag } from '../components/DataState';
import { c, radius, space, tnum } from '../theme';
import { useApi } from '../finance/useApi';
import { categoryTotals, sourceWords, usd } from '../finance/labels';

type Purchase = { id: string; date: string; occurredAt: string | null; amountCents: number; merchant: string | null; category: string | null; provenance: string };
type Profile = { asOf: string; timeZone: string; transactions: Purchase[]; spend: { monthToDate: { totalCents: number; count: number } } };
type Budget = { category: string; period: 'week' | 'month'; limitCents: number; spentCents: number; source: string };

const R = 60;
const CIRC = 2 * Math.PI * R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const CATEGORY: Record<string, { color: string; icon: IconName }> = {
  dining: { color: '#206774', icon: 'silverware-fork-knife' },
  coffee: { color: '#629e82', icon: 'coffee-outline' },
  groceries: { color: '#041920', icon: 'basket-outline' },
  fuel: { color: '#90d1df', icon: 'gas-station-outline' },
  retail: { color: '#b4cad3', icon: 'shopping-outline' },
  travel: { color: '#c7a760', icon: 'airplane' },
  electronics: { color: '#6b7f86', icon: 'laptop' },
  other: { color: '#dddad2', icon: 'dots-horizontal' },
};
const cat = (name: string) => CATEGORY[name] ?? CATEGORY.other;
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const PAGE = 25;

export default function SpendingScreen() {
  const profile = useApi<Profile>('/api/finance-profile');
  const budgets = useApi<{ budgets: Budget[] }>('/api/v1/budgets');
  return (
    <Screen title="Current Spending">
      <DataState state={profile.state} onRetry={profile.reload}>
        {(p) => <Spending profile={p} budgets={budgets} />}
      </DataState>
    </Screen>
  );
}

function Spending({ profile, budgets }: { profile: Profile; budgets: ReturnType<typeof useApi<{ budgets: Budget[] }>> }) {
  const rows = useMemo(() => [...(profile.transactions ?? [])].sort((a, b) => b.date.localeCompare(a.date) || (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '')), [profile]);
  const months = useMemo(() => [...new Set(rows.map((r) => r.date.slice(0, 7)))], [rows]);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const month = months[index];
  const reveal = useReveal(450);
  if (!month) return <T v="bodySm" style={{ color: c.onSurfaceVariant }}>No purchases in your sandbox history yet.</T>;

  const totals = categoryTotals(rows, month);
  const total = totals.reduce((a, t) => a + t.cents, 0);
  const isCurrent = month === profile.asOf.slice(0, 7);
  const days = isCurrent ? Number(profile.asOf.slice(8, 10)) : daysIn(month);
  // Compare with the month before only when that whole month is in the history.
  const prev = months[index + 1];
  const prevComplete = prev && months.length > index + 2;
  const prevTotal = prevComplete ? categoryTotals(rows, prev).reduce((a, t) => a + t.cents, 0) : null;
  const synthetic = rows.some((r) => r.provenance === 'synthetic_persona');
  // Each ring segment's length and where it starts, computed before rendering.
  const segments = totals.map((t) => (total ? (t.cents / total) * CIRC : 0));
  const starts = segments.map((_, i) => segments.slice(0, i).reduce((a, b) => a + b, 0));

  return (
    <>
      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
          <Pressable disabled={index >= months.length - 1} onPress={() => setIndex(index + 1)} accessibilityLabel="Earlier month">
            <Icon name="chevron-left" color={index >= months.length - 1 ? c.outlineVariant : c.secondary} />
          </Pressable>
          <Row style={{ gap: 6, backgroundColor: c.surfaceContainer, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full }}>
            <Icon name="calendar-month-outline" size={18} />
            <T v="labelMd" style={{ color: c.primary }}>{monthName(month)}</T>
          </Row>
          <Pressable disabled={index === 0} onPress={() => setIndex(index - 1)} accessibilityLabel="Later month">
            <Icon name="chevron-right" color={index === 0 ? c.outlineVariant : c.secondary} />
          </Pressable>
        </Row>
        <T v="labelSm" style={{ color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 }}>{isCurrent ? 'Spent this month so far' : 'Spent this month'}</T>
        <T v="displayMobile" style={[{ color: c.primary }, tnum]}>{usd(total)}</T>
        {prevTotal !== null && prevTotal > 0 ? (
          <T v="labelMd" style={{ color: c.onSurfaceVariant }}>{usd(prevTotal)} in {monthName(prev!)}</T>
        ) : null}
        <Row style={{ justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(230,226,218,0.5)' }}>
          <T v="bodySm" style={{ color: c.onSurfaceVariant }}>Daily average: <T v="bodySm" style={[{ color: c.primary, fontFamily: 'Manrope_700Bold' }, tnum]}>{usd(Math.round(total / Math.max(1, days)))}</T></T>
          <Pill label={synthetic ? 'Sandbox + synthetic' : 'Sandbox data'} bg="rgba(172,237,252,0.5)" color={c.secondary} />
        </Row>
      </Card>

      {totals.length ? (
        <Card style={{ alignItems: 'center' }}>
          <View style={{ alignSelf: 'stretch' }}><SectionTitle title="Spending by category" sub={monthName(month)} /></View>
          <View style={{ width: 208, height: 208, marginVertical: 12, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width="100%" height="100%" viewBox="0 0 160 160" style={{ transform: [{ rotate: '-90deg' }] }}>
              {totals.map((t, i) => (
                <AnimatedCircle key={t.category} cx={80} cy={80} r={R} fill="none" stroke={cat(t.category).color} strokeWidth={16}
                  strokeDasharray={[reveal.interpolate({ inputRange: [0, 1], outputRange: [0, segments[i]] }), CIRC] as any} strokeDashoffset={-starts[i]} />
              ))}
            </Svg>
            <View style={{ position: 'absolute', alignItems: 'center' }}>
              <T v="labelSm" style={{ color: c.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 1 }}>Outflow</T>
              <T v="headlineMd" style={[{ color: c.primary }, tnum]}>{usd(total)}</T>
              <T v="labelSm" style={{ color: c.secondary }}>{totals.length} categories</T>
            </View>
          </View>
          <View style={{ alignSelf: 'stretch', gap: 14 }}>
            {totals.map((t) => (
              <View key={t.category} style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row style={{ gap: 10 }}>
                    <IconCircle name={cat(t.category).icon} size={32} bg={c.surfaceContainer} color={c.primaryContainer} />
                    <T v="labelLg" style={{ color: c.primary }}>{title(t.category)}</T>
                  </Row>
                  <View style={{ alignItems: 'flex-end' }}>
                    <T v="labelLg" style={[{ color: c.primary }, tnum]}>{usd(t.cents)}</T>
                    <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{t.pct}%</T>
                  </View>
                </Row>
                <View style={{ height: 8, backgroundColor: c.surfaceContainer, borderRadius: 4, overflow: 'hidden' }}>
                  <Animated.View style={{ width: `${t.pct}%`, height: '100%', backgroundColor: cat(t.category).color, borderRadius: 4, transformOrigin: 'left', transform: [{ scaleX: reveal }] }} />
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card style={{ gap: 14 }}>
        <SectionTitle title="Budgets" sub="Enforced on every recommendation" right={
          <Pressable onPress={() => router.push('/budgets')}><T v="labelMd" style={{ color: c.secondary }}>Edit</T></Pressable>
        } />
        <DataState state={budgets.state} onRetry={budgets.reload}>
          {(b) => b.budgets.length ? b.budgets.map((x) => {
            const pct = x.limitCents ? Math.min(100, Math.round((x.spentCents / x.limitCents) * 100)) : 100;
            const over = x.spentCents > x.limitCents;
            return (
              <View key={x.category} style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T v="labelLg" style={{ color: c.primary }}>{title(x.category)} · per {x.period}</T>
                  <T v="labelMd" style={[{ color: over ? c.error : c.primary }, tnum]}>{usd(x.spentCents)} of {usd(x.limitCents)}</T>
                </Row>
                <View style={{ height: 8, backgroundColor: c.surfaceContainer, borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{ width: `${pct}%`, height: '100%', backgroundColor: over ? c.error : cat(x.category).color, borderRadius: 4 }} />
                </View>
                <Tag text={sourceWords(x.source)} />
              </View>
            );
          }) : <T v="bodySm" style={{ color: c.onSurfaceVariant }}>No budgets yet. They are set after your history is imported.</T>}
        </DataState>
      </Card>

      <Card style={{ gap: 14 }}>
        <SectionTitle title="Recent purchases" sub={`${rows.length} in your history`} />
        {rows.slice(0, shown).map((t) => (
          <Row key={t.id} style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 12, flexShrink: 1 }}>
              <IconCircle name={cat(t.category ?? 'other').icon} bg="#f2ece9" />
              <View style={{ flexShrink: 1 }}>
                <T v="labelLg" numberOfLines={1} style={{ color: c.primary }}>{title((t.merchant ?? 'Unknown merchant').replace(/_/g, ' '))}</T>
                <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{t.date} · {sourceWords(t.provenance)}</T>
              </View>
            </Row>
            <T v="labelLg" style={[{ color: c.error, fontFamily: 'Manrope_600SemiBold' }, tnum]}>-{usd(t.amountCents)}</T>
          </Row>
        ))}
        {rows.length > shown ? (
          <Button label={`Show ${Math.min(PAGE, rows.length - shown)} more`} textColor={c.primary} style={{ backgroundColor: c.surfaceContainer }} onPress={() => setShown(shown + PAGE)} />
        ) : null}
        {synthetic ? <Tag text="Synthetic demo purchases do not change your sandbox balance." /> : null}
      </Card>
    </>
  );
}
