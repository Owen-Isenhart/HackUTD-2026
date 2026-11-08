import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';
import { Screen } from '../components/Screen';
import { Button, Card, Icon, Pill, Row, SectionTitle, T } from '../components/ui';
import { DataState, Tag } from '../components/DataState';
import { c, radius, shadow, space, tnum } from '../theme';
import { api, FinanceApiError } from '../finance/financeApi';
import { useApi, waitForRun } from '../finance/useApi';
import { usd } from '../finance/labels';

type Day = { date: string; lowCents: number; middleCents: number; highCents: number };
type Forecast = {
  method: string; asOf: string; status?: string; startingBalanceCents: number | null; minimumBalanceLowCents: number | null;
  safeToSpendCents: number | null; reserveCents?: number; missingSources?: string[]; daily?: Day[];
  bands?: { daily?: Day[]; method?: string } | null; adoption?: string;
};
type Plan = { id: string; version: number; category: string; status: string; amountCents: number | null; dueDate: string | null; missing: string[]; evidence: string; source: string };
type Plans = { horizonDays: number; committedCents: number; reservedPendingCents: number; expectedInflowCents: number; upcoming: Plan[]; pendingClarifications: Plan[]; expectedInflows: Plan[] };

const MISSING: Record<string, string> = {
  amount: 'amount', date: 'date', your_confirmation: 'whether you’re in', review: 'a quick review', possibly_cancelled: 'whether it was cancelled',
};
const SOURCE: Record<string, string> = { friend_texts: 'from a friend', your_email: 'from your email', your_texts: 'from you' };
const MISSING_SOURCE: Record<string, string> = {
  checking_balance: 'no checking balance', unbounded_obligation: 'a plan without an amount', truncated_ledger: 'incomplete bank history',
};

export default function UpcomingScreen() {
  const forecast = useApi<Forecast>('/api/v1/finance/forecast');
  const plans = useApi<Plans>('/api/text-obligations');
  const [syncing, setSyncing] = useState(false);
  const refresh = async () => {
    setSyncing(true);
    try {
      const run = await api('/api/v1/finance/sync', 'POST', {});
      await waitForRun(run.runId);
    } catch { /* the reload below shows any error */ }
    setSyncing(false);
    void forecast.reload();
    void plans.reload();
  };
  return (
    <Screen title="Upcoming Cashflow">
      <DataState state={forecast.state} onRetry={forecast.reload}>
        {(f) => <ForecastCard f={f} />}
      </DataState>
      <Button label={syncing ? 'Refreshing your data…' : 'Refresh from the bank'} small onPress={syncing ? undefined : refresh} />
      {plans.state.kind !== 'unavailable' ? (
        <DataState state={plans.state} onRetry={plans.reload}>
          {(p) => <PlansSection plans={p} onChanged={() => { void plans.reload(); void forecast.reload(); }} />}
        </DataState>
      ) : null}
    </Screen>
  );
}

function ForecastCard({ f }: { f: Forecast }) {
  const daily = f.bands?.daily ?? f.daily ?? [];
  const [day, setDay] = useState<string | null>(null);
  const strip = daily.slice(0, 14);
  const picked = strip.find((d) => d.date === day);
  const missing = (f.missingSources ?? []).map((m) => MISSING_SOURCE[m] ?? m.replace(/_/g, ' '));
  return (
    <>
      <View style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: c.primaryContainer, padding: space.lg, gap: 8, ...shadow.card }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full }}>
            <Icon name="water" size={16} color={c.tertiaryFixedDim} />
            <T v="labelSm" style={{ color: c.surfaceLow, textTransform: 'uppercase', letterSpacing: 0.8 }}>Next {daily.length || 30} days</T>
          </Row>
          <T v="labelSm" style={{ color: c.secondaryFixed }}>{f.status === 'stale' ? 'Updating…' : `As of ${new Date(f.asOf).toLocaleString()}`}</T>
        </Row>
        <T v="labelMd" style={{ color: c.surfaceHighest, textTransform: 'uppercase', letterSpacing: 1 }}>Safe to spend</T>
        <T v="headlineLgMobile" style={[{ color: c.surface }, tnum]}>{f.safeToSpendCents === null ? 'Needs a check' : usd(f.safeToSpendCents)}</T>
        {f.safeToSpendCents === null ? (
          <T v="bodySm" style={{ color: c.errorContainer }}>
            {missing.length ? `Can’t say yet: ${missing.join(', ')}.` : 'Some plans need an amount or date before anything counts as affordable.'}
          </T>
        ) : null}
        <Row style={{ gap: 8, marginTop: 8, alignItems: 'stretch' }}>
          <Metric label="Checking now" amt={f.startingBalanceCents} />
          <Metric label="Lowest likely balance" amt={f.minimumBalanceLowCents} />
        </Row>
      </View>

      {daily.length > 1 ? (
        <Card style={{ gap: space.sm }}>
          <SectionTitle title="Balance range" sub="Low, middle and high estimate for each day" />
          <BandChart daily={daily} />
          <Tag text={f.bands ? 'Experimental range from your own past weeks. It may include synthetic demo history.' : `Method: ${f.method.replace(/_/g, ' ')}`} />
        </Card>
      ) : null}

      {strip.length ? (
        <View style={{ gap: 4 }}>
          <Row style={{ gap: 8, paddingHorizontal: 4 }}>
            <Icon name="calendar-today" size={18} />
            <T v="headlineSm" style={{ color: c.primary }}>Next 14 days</T>
          </Row>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 8, paddingHorizontal: 4 }}>
            {strip.map((d, i) => {
              const before = i ? strip[i - 1].middleCents : f.startingBalanceCents ?? d.middleCents;
              const change = d.middleCents - before;
              const on = day === d.date;
              const dot = change < -500 ? c.error : change > 500 ? c.onTertiaryFixedVariant : 'transparent';
              const date = new Date(`${d.date}T12:00:00Z`);
              return (
                <Pressable key={d.date} onPress={() => setDay(on ? null : d.date)}
                  style={{ width: 52, height: 72, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.primary : c.surfaceLowest, ...shadow.sm }}>
                  <T v="labelSm" style={{ color: on ? c.surfaceHighest : c.onSurfaceVariant }}>{date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase()}</T>
                  <T v="headlineSm" style={{ color: on ? c.surface : c.onSurface }}>{d.date.slice(8)}</T>
                  <View style={{ width: 6, height: 6, borderRadius: 3, marginTop: 4, backgroundColor: dot }} />
                </Pressable>
              );
            })}
          </ScrollView>
          {picked ? (
            <T v="bodySm" style={{ color: c.onSurfaceVariant, paddingHorizontal: 4 }}>
              {picked.date}: likely {usd(picked.middleCents)} (between {usd(picked.lowCents)} and {usd(picked.highCents)})
            </T>
          ) : <Tag text="Red dot: balance likely falls that day. Green: likely rises. Tap a day for its range." />}
        </View>
      ) : null}
    </>
  );
}

function BandChart({ daily }: { daily: Day[] }) {
  const W = 300, H = 120;
  const values = daily.flatMap((d) => [d.lowCents, d.highCents]);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (i: number) => (i / (daily.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;
  const line = (k: keyof Day) => daily.map((d, i) => `${x(i)},${y(d[k] as number)}`).join(' ');
  const area = `M ${daily.map((d, i) => `${x(i)} ${y(d.highCents)}`).join(' L ')} L ${[...daily].reverse().map((d, i) => `${x(daily.length - 1 - i)} ${y(d.lowCents)}`).join(' L ')} Z`;
  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Path d={area} fill="rgba(32,103,116,0.18)" />
        <Polyline points={line('middleCents')} fill="none" stroke={c.secondary} strokeWidth={2} />
      </Svg>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{usd(min)}</T>
        <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{usd(max)}</T>
      </Row>
    </View>
  );
}

function Metric({ label, amt }: { label: string; amt: number | null }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.lg, padding: space.sm }}>
      <T v="labelSm" style={{ color: c.surfaceHighest }}>{label}</T>
      <T v="mono" style={[{ color: c.surface, marginTop: 4 }, tnum]}>{usd(amt)}</T>
    </View>
  );
}

// Plans the backend read from the user's texts and forwarded email. Team account only.
function PlansSection({ plans, onChanged }: { plans: Plans; onChanged: () => void }) {
  const [syncing, setSyncing] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
        <Row style={{ gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.error }} />
          <T v="headlineSm" style={{ color: c.primary }}>Plans from your texts</T>
        </Row>
        <T v="mono" style={[{ color: c.error }, tnum]}>- {usd(plans.committedCents + plans.reservedPendingCents)}</T>
      </Row>
      {plans.pendingClarifications.length ? (
        <T v="bodySm" style={{ color: c.error, paddingHorizontal: 4 }}>
          {plans.pendingClarifications.length} plan{plans.pendingClarifications.length === 1 ? '' : 's'} need a quick check before anything counts as affordable.
        </T>
      ) : null}
      {plans.pendingClarifications.map((p) => <PlanEditor key={`${p.id}:${p.version}`} plan={p} onChanged={onChanged} />)}
      {plans.upcoming.map((p) => (
        <Card key={p.id} style={{ padding: space.md, gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="labelLg" style={{ color: c.primary }}>{p.category} · {p.dueDate ?? 'no date'}</T>
            <T v="mono" style={[{ color: c.error }, tnum]}>- {usd(p.amountCents)}</T>
          </Row>
          <T v="bodySm" style={{ color: c.onSurfaceVariant }}>“{p.evidence}” · {SOURCE[p.source] ?? p.source}</T>
        </Card>
      ))}
      {plans.expectedInflows.length ? (
        <T v="bodySm" style={{ color: c.onTertiaryFixedVariant, paddingHorizontal: 4 }}>
          Owed to you: {usd(plans.expectedInflowCents)} (not counted until it arrives)
        </T>
      ) : null}
      {!plans.upcoming.length && !plans.pendingClarifications.length ? (
        <T v="bodySm" style={{ color: c.onSurfaceVariant, paddingHorizontal: 4 }}>No upcoming money plans found in your texts or email.</T>
      ) : null}
      <Button label={syncing ? 'Checking…' : 'Check texts and email now'} small textColor={c.primary} style={{ backgroundColor: c.surfaceContainer }}
        onPress={syncing ? undefined : async () => {
          setSyncing(true);
          try { await api('/api/texts/sync', 'POST', {}); } catch { /* shown on reload */ }
          setSyncing(false);
          onChanged();
        }} />
    </View>
  );
}

function PlanEditor({ plan, onChanged }: { plan: Plan; onChanged: () => void }) {
  const [amount, setAmount] = useState(plan.amountCents ? (plan.amountCents / 100).toFixed(2) : '');
  const [dueDate, setDueDate] = useState(plan.dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cents = Math.round(Number(amount) * 100);
  const valid = Number.isSafeInteger(cents) && cents > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dueDate);
  const save = async (action: 'confirm' | 'dismiss') => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/text-obligations/${plan.id}`, 'PUT', action === 'dismiss'
        ? { confirmed: true, action, version: plan.version }
        : { confirmed: true, action, version: plan.version, amountCents: cents, dueDate });
      onChanged();
    } catch (e) {
      setError(e instanceof FinanceApiError && e.status === 409 ? 'This plan changed. Showing the latest.' : 'Couldn’t save this plan. Try again.');
      if (e instanceof FinanceApiError && e.status === 409) onChanged();
    }
    setBusy(false);
  };
  const input = { backgroundColor: c.surfaceLow, borderRadius: radius.md, padding: 10, fontFamily: 'Manrope_400Regular', color: c.onSurface } as const;
  return (
    <Card style={{ padding: space.md, gap: 8 }}>
      <Row style={{ gap: 6 }}>
        <Pill label="Needs a check" bg={c.errorContainer} color={c.error} />
        <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{SOURCE[plan.source] ?? plan.source}</T>
      </Row>
      <T v="bodySm" style={{ color: c.primary }}>“{plan.evidence}”</T>
      <T v="bodySm" style={{ color: c.onSurfaceVariant }}>Needs {plan.missing.map((m) => MISSING[m] ?? m).join(', ')}</T>
      <TextInput accessibilityLabel="Your share in dollars" placeholder="Your share, e.g. 40.00" placeholderTextColor={c.outline}
        keyboardType="decimal-pad" value={amount} onChangeText={setAmount} editable={!busy} style={input} />
      <TextInput accessibilityLabel="Date as YYYY-MM-DD" placeholder="Date, YYYY-MM-DD" placeholderTextColor={c.outline}
        autoCapitalize="none" value={dueDate} onChangeText={setDueDate} editable={!busy} style={input} />
      <Row style={{ gap: 8 }}>
        <Button label="Confirm plan" small onPress={busy || !valid ? undefined : () => save('confirm')} style={!valid ? { opacity: 0.5 } : undefined} />
        <Button label="Not my plan" small textColor={c.primary} style={{ backgroundColor: c.surfaceContainer }} onPress={busy ? undefined : () => save('dismiss')} />
      </Row>
      {error ? <T v="bodySm" style={{ color: c.error }}>{error}</T> : null}
    </Card>
  );
}
