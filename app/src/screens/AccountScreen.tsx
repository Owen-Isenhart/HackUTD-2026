import React, { useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Button, Card, Icon, IconCircle, IconName, Pill, Row, T } from '../components/ui';
import { DataState, Tag } from '../components/DataState';
import { c, radius, shadow, space, tnum } from '../theme';
import { api, FinanceApiError } from '../finance/financeApi';
import { saveSession } from '../finance/session';
import { useApi, waitForRun } from '../finance/useApi';
import { sourceWords, usd } from '../finance/labels';

type Profile = { asOf: string; balanceCents: number | null; accountType: string; source: string };
type Routine = { id: string; brand_key: string | null; purpose: string; kind: string; provenance: string[]; evidence: string };
type DealsStatus = {
  profile: { consent_at: string | null; revoked_at: string | null };
  identity: { address: string; disabled_at: string | null } | null;
  sources: { product: string; status: string; reason: string | null; last_success_at: string | null }[];
  jobs: { id: string; kind: string; state: string; last_error: string | null }[];
};
type AlertSettings = { channel: string; version: number; channels: string[] };

const CHANNEL_WORDS: Record<string, string> = { off: 'Off', call: 'Phone call', imessage: 'iMessage' };

function confirm(title: string, message: string, ok: string, run: () => void) {
  if (Platform.OS === 'web') { if (globalThis.confirm?.(`${title}\n\n${message}`)) run(); return; }
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: ok, style: 'destructive', onPress: run }]);
}

function Group({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ gap: 6, paddingHorizontal: 2 }}>
        <Icon name={icon} size={18} />
        <T v="labelLg" style={{ color: c.primary }}>{title}</T>
      </Row>
      <View style={{ backgroundColor: c.surfaceLowest, borderRadius: radius.lg, padding: space.md, gap: space.md, ...shadow.sm }}>{children}</View>
    </View>
  );
}

function Link({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: 12, flexShrink: 1 }}>
          <IconCircle name={icon} bg={c.surfaceContainer} />
          <View style={{ flexShrink: 1 }}>
            <T v="labelMd" style={{ color: c.onSurface }}>{title}</T>
            <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{sub}</T>
          </View>
        </Row>
        <Icon name="chevron-right" size={20} color={c.outlineVariant} />
      </Row>
    </Pressable>
  );
}

export default function AccountScreen() {
  const profile = useApi<Profile>('/api/finance-profile');
  const routines = useApi<{ routines: Routine[] }>('/api/v1/routines');
  const deals = useApi<DealsStatus>('/v1/deals/status');
  const alerts = useApi<AlertSettings>('/api/v1/settings');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    setNote('');
    try { await fn(); if (done) setNote(done); } catch (e) {
      setNote(e instanceof FinanceApiError && e.status === 409 ? 'That setting changed elsewhere. Showing the latest.' : 'That didn’t work. Try again.');
    }
    setBusy('');
  };
  const refresh = () => act('sync', async () => {
    const run = await api('/api/v1/finance/sync', 'POST', {});
    await waitForRun(run.runId);
    await Promise.all([profile.reload(), routines.reload()]);
  }, 'Your data is up to date.');
  const setChannel = (a: AlertSettings, channel: string) => act('alerts', async () => {
    try { await api('/api/v1/settings', 'PUT', { channel, version: a.version, confirmed: true }); } finally { await alerts.reload(); }
  }, channel === 'off' ? 'Automatic alerts are off.' : `Alerts will come by ${CHANNEL_WORDS[channel] ?? channel}.`);
  const signOut = () => act('signout', async () => {
    try { await api('/api/v1/session', 'DELETE'); } finally { await saveSession(null); router.replace('/'); }
  });

  return (
    <Screen title="Account">
      <Card style={{ padding: space.md, gap: space.md }}>
        <DataState state={profile.state} onRetry={profile.reload}>
          {(p) => (
            <Row style={{ justifyContent: 'space-between', backgroundColor: c.surfaceLow, borderRadius: radius.md, padding: space.md }}>
              <View>
                <Row style={{ gap: 6 }}>
                  <Icon name="bank-outline" size={16} />
                  <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{p.accountType ? `${p.accountType[0].toUpperCase()}${p.accountType.slice(1)} account` : 'Account'}</T>
                </Row>
                <T v="headlineMd" style={[{ color: c.primary, marginTop: 2 }, tnum]}>{usd(p.balanceCents)}</T>
                <Tag text={`Updated ${new Date(p.asOf).toLocaleString()}`} />
              </View>
              <Pill label={sourceWords(p.source)} bg={c.tertiaryContainer} color={c.tertiaryFixedDim} />
            </Row>
          )}
        </DataState>
        <Button label={busy === 'sync' ? 'Refreshing…' : 'Refresh from the bank'} small onPress={busy ? undefined : refresh} />
        <Tag text="This is a Nessie sandbox account found by name and card digits. It is not bank sign-in." />
      </Card>

      <Group icon="wallet-outline" title="Your money">
        <Link icon="chart-donut" title="Budgets" sub="Enforced limits per category" onPress={() => router.push('/budgets')} />
        <Link icon="storefront-outline" title="Stores and signups" sub="Selected stores and their rewards programs" onPress={() => router.push('/stores')} />
      </Group>

      <Group icon="head-lightbulb-outline" title="Your routines">
        <DataState state={routines.state} onRetry={routines.reload}>
          {(r) => r.routines.length ? r.routines.map((x) => (
            <View key={x.id} style={{ gap: 2 }}>
              <T v="labelMd" style={{ color: c.primary }}>{(x.brand_key ?? x.purpose).replace(/_/g, ' ')}</T>
              <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{x.evidence}</T>
              <Tag text={x.kind === 'stated' ? 'Stated by you' : x.provenance.includes('synthetic_persona') ? 'Synthetic demo history' : 'Sandbox bank data'} />
            </View>
          )) : <T v="bodySm" style={{ color: c.onSurfaceVariant }}>No routines found yet.</T>}
        </DataState>
      </Group>

      <Group icon="email-outline" title="Store rewards email">
        <DataState state={deals.state} onRetry={deals.reload}>
          {(d) => {
            const on = !!d.profile.consent_at && !d.profile.revoked_at;
            const failed = d.jobs.filter((j) => j.state === 'dead');
            return (
              <View style={{ gap: space.sm }}>
                <T v="bodySm" style={{ color: c.onSurfaceVariant }}>
                  {on && d.identity ? `Private address: ${d.identity.address}` : 'Off. Turn it on during onboarding to receive store offers.'}
                </T>
                {d.sources.map((s) => (
                  <T key={s.product} v="bodySm" style={{ color: s.status === 'ready' ? c.onSurfaceVariant : c.error }}>
                    {s.product.replace(/_/g, ' ')}: {s.status.replace(/_/g, ' ')}{s.reason ? ` (${s.reason.replace(/_/g, ' ')})` : ''}
                  </T>
                ))}
                {failed.map((j) => (
                  <Row key={j.id} style={{ justifyContent: 'space-between' }}>
                    <T v="bodySm" style={{ color: c.error, flexShrink: 1 }}>Failed: {j.kind.replace(/_/g, ' ')}</T>
                    <Button label="Retry" small onPress={() => act('job', async () => { await api(`/v1/deals/jobs/${j.id}/retry`, 'POST', {}); await deals.reload(); })} />
                  </Row>
                ))}
                {on ? (
                  <Button label="Turn off store email" small textColor={c.error} style={{ backgroundColor: 'rgba(255,218,214,0.4)' }}
                    onPress={() => confirm('Turn off store email?', 'This stops new store emails and removes offer content kept here. Loyalty accounts and earned rewards stay yours. Unsubscribing at each store still needs to be done there.', 'Turn off',
                      () => act('deals', async () => { await api('/v1/deals/consent', 'DELETE'); await deals.reload(); }, 'Store email is off.'))} />
                ) : null}
              </View>
            );
          }}
        </DataState>
      </Group>

      {alerts.state.kind !== 'unavailable' ? (
        <Group icon="bell-ring-outline" title="Nearby alerts (team account)">
          <DataState state={alerts.state} onRetry={alerts.reload}>
            {(a) => (
              <View style={{ gap: space.sm }}>
                <T v="bodySm" style={{ color: c.onSurfaceVariant }}>
                  Now: {CHANNEL_WORDS[a.channel] ?? a.channel}. Alerts go to the opted-in demo phone configured on the server.
                </T>
                <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                  {a.channels.map((ch) => (
                    <Button key={ch} label={CHANNEL_WORDS[ch] ?? ch} small
                      textColor={ch === a.channel ? c.onPrimary : c.primary}
                      style={ch === a.channel ? undefined : { backgroundColor: c.surfaceContainer }}
                      onPress={busy || ch === a.channel ? undefined : () => setChannel(a, ch)} />
                  ))}
                </Row>
                {a.channels.length < 2 ? <Tag text="The server has no call or iMessage channel enabled." /> : null}
              </View>
            )}
          </DataState>
        </Group>
      ) : null}

      {note ? <T v="bodySm" style={{ color: c.secondary, textAlign: 'center' }}>{note}</T> : null}

      <Pressable onPress={busy ? undefined : signOut}
        style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.lg, backgroundColor: 'rgba(255,218,214,0.4)', marginTop: space.md }}>
        <Icon name="logout" size={18} color={c.error} />
        <T v="labelMd" style={{ color: c.error }}>Sign out</T>
      </Pressable>
    </Screen>
  );
}
