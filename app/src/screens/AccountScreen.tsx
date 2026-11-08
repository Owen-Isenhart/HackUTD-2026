import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { Card, Icon, IconCircle, IconName, Pill, Row, T, Toggle } from '../components/ui';
import { c, radius, shadow, space, tnum } from '../theme';
import { profile } from '../mock/sample';

function Group({ icon, title, right, children }: { icon: IconName; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: 2 }}>
        <Row style={{ gap: 6 }}>
          <Icon name={icon} size={18} />
          <T v="labelLg" style={{ color: c.primary }}>{title}</T>
        </Row>
        {right}
      </Row>
      {children}
    </View>
  );
}

function Item({ icon, title, sub, right, bg = c.surfaceContainer, color = c.onSurfaceVariant, badge }: {
  icon: IconName; title: string; sub: string; right: React.ReactNode; bg?: string; color?: string; badge?: string;
}) {
  return (
    <Row style={{ justifyContent: 'space-between', padding: space.md }}>
      <Row style={{ gap: 16, flexShrink: 1, paddingRight: 8 }}>
        <IconCircle name={icon} bg={bg} color={color} />
        <View style={{ flexShrink: 1 }}>
          <Row style={{ gap: 8 }}>
            <T v="labelMd" style={{ color: c.onSurface }}>{title}</T>
            {badge ? <Pill label={badge} bg={c.surfaceHigh} color={c.onSurfaceVariant} /> : null}
          </Row>
          <T v="bodySm" numberOfLines={1} style={{ color: c.onSurfaceVariant }}>{sub}</T>
        </View>
      </Row>
      {right}
    </Row>
  );
}

const Divider = () => <View style={{ height: 1, backgroundColor: 'rgba(236,232,224,0.6)', marginHorizontal: space.md }} />;

export default function AccountScreen() {
  const [face, setFace] = useState(true);
  const [alerts, setAlerts] = useState(true);
  const [locked, setLocked] = useState(false);

  return (
    <Screen title="Account">
      <Card style={{ padding: space.md, gap: space.md }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Row style={{ gap: space.md }}>
            <View>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.primaryContainer, alignItems: 'center', justifyContent: 'center' }}>
                <T v="headlineSm" style={{ color: c.primaryFixed }}>ER</T>
              </View>
              <View style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: c.tertiaryFixedDim, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check-decagram" size={10} color={c.onTertiaryFixed} />
              </View>
            </View>
            <View>
              <Row style={{ gap: 6 }}>
                <T v="headlineSm" style={{ color: c.primary }}>{profile.name}</T>
                <Pill label="PRO" bg="rgba(172,237,252,0.4)" color={c.onSecondaryFixedVariant} />
              </Row>
              <Row style={{ gap: 4, marginTop: 2 }}>
                <Icon name="water-outline" size={14} />
                <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{profile.tier}</T>
              </Row>
            </View>
          </Row>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceContainer, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="tune-variant" size={18} color={c.onSurfaceVariant} />
          </View>
        </Row>
        <Row style={{ justifyContent: 'space-between', backgroundColor: c.surfaceLow, borderRadius: radius.md, padding: space.md }}>
          <View>
            <Row style={{ gap: 6 }}>
              <Icon name="bank-outline" size={16} />
              <T v="labelSm" style={{ color: c.onSurfaceVariant }}>{profile.checking}</T>
            </Row>
            <T v="headlineMd" style={[{ color: c.primary, marginTop: 2 }, tnum]}>{profile.balance}</T>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Row style={{ gap: 2, backgroundColor: c.surfaceLowest, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full }}>
              <Icon name="arrow-top-right" size={13} />
              <T v="labelSm" style={{ color: c.secondary }}>+1.8% Yield</T>
            </Row>
            <T v="labelSm" style={{ color: c.onSurfaceVariant }}>Routing 091000019</T>
          </View>
        </Row>
      </Card>

      <Group icon="credit-card-outline" title="Sovereign Obsidian Card" right={<T v="labelSm" style={{ color: c.secondary }}>Manage Limits</T>}>
        <View style={{ aspectRatio: 1.586, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: c.primaryContainer, padding: space.lg, justifyContent: 'space-between', ...shadow.card }}>
          <LinearGradient colors={['transparent', 'rgba(26,46,53,0.8)', c.primary]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', inset: 0 }} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Row style={{ gap: 12 }}>
              <LinearGradient colors={['#edd59e', '#c7a760', '#b08b3e']} style={{ width: 36, height: 28, borderRadius: 4 }} />
              <Icon name="contactless-payment" size={22} color={c.surfaceHighest} />
            </Row>
            <View style={{ alignItems: 'flex-end' }}>
              <T v="labelSm" style={{ color: c.secondaryFixed, textTransform: 'uppercase', letterSpacing: 2 }}>Stillwater</T>
              <T v="labelSm" style={{ color: c.onPrimaryContainer, fontSize: 9, textTransform: 'uppercase' }}>Debit Black</T>
            </View>
          </Row>
          <Row style={{ gap: 12 }}>
            {['••••', '••••', '••••'].map((x, i) => <T key={i} v="mono" style={{ color: '#fff', letterSpacing: 2 }}>{x}</T>)}
            <T v="mono" style={{ color: '#fff', letterSpacing: 2 }}>4892</T>
          </Row>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <T v="labelSm" style={{ color: c.onPrimaryContainer, fontSize: 10, textTransform: 'uppercase' }}>Cardholder</T>
              <T v="labelMd" style={{ color: '#fff' }}>{profile.cardholder}</T>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T v="labelSm" style={{ color: c.onPrimaryContainer, fontSize: 10, textTransform: 'uppercase' }}>Valid Thru</T>
              <T v="labelMd" style={{ color: '#fff' }}>{profile.expiry}</T>
            </View>
          </Row>
        </View>
        <Row style={{ gap: 8 }}>
          {[
            { k: 'lock', icon: (locked ? 'lock' : 'lock-open-variant-outline') as IconName, label: locked ? 'Card Locked' : 'Lock Card', col: locked ? c.error : c.secondary, press: () => setLocked(!locked) },
            { k: 'view', icon: 'eye-outline' as IconName, label: 'View Details', col: c.secondary },
            { k: 'lim', icon: 'tune-variant' as IconName, label: 'Card Limits', col: c.secondary },
          ].map((a) => (
            <Pressable key={a.k} onPress={a.press} style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, backgroundColor: c.surfaceLowest, borderRadius: radius.md, ...shadow.sm }}>
              <Icon name={a.icon} size={20} color={a.col} />
              <T v="labelSm">{a.label}</T>
            </Pressable>
          ))}
        </Row>
      </Group>

      <Group icon="shield-lock-outline" title="Security & Access">
        <View style={{ backgroundColor: c.surfaceLowest, borderRadius: radius.lg, overflow: 'hidden', ...shadow.sm }}>
          <Item icon="face-recognition" title="Biometric Face ID" sub="Fast authentication for transfers & vault unlock" bg="rgba(169,234,249,0.4)" color={c.secondary} right={<Toggle value={face} onChange={setFace} />} />
          <Divider />
          <Item icon="bell-ring-outline" title="Deal & Cashback Alerts" sub="Real-time merchant perks & dividend notices" right={<Toggle value={alerts} onChange={setAlerts} />} />
          <Divider />
          <Item icon="airplane-takeoff" title="Global Travel Mode" badge="Inactive" sub="Zero FX markup in 140+ world currencies" right={<Icon name="chevron-right" size={20} color={c.outlineVariant} />} />
        </View>
      </Group>

      <Group icon="swap-horizontal" title="Connected Accounts" right={<Row style={{ gap: 2 }}><Icon name="plus" size={14} /><T v="labelSm" style={{ color: c.secondary }}>Link External</T></Row>}>
        {profile.linked.map((l, i) => (
          <Row key={l.name} style={{ justifyContent: 'space-between', backgroundColor: c.surfaceLowest, borderRadius: radius.lg, padding: space.md, ...shadow.sm }}>
            <Row style={{ gap: 12, flexShrink: 1 }}>
              <IconCircle name={l.icon} bg={i ? '#ebf1f2' : '#f2ece9'} color={i ? c.secondary : c.primary} />
              <View style={{ flexShrink: 1 }}>
                <T v="labelMd" numberOfLines={1}>{l.name}</T>
                <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{l.sub}</T>
              </View>
            </Row>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <T v="mono" style={[{ color: c.primary }, tnum]}>{l.amt}</T>
              {i === 0
                ? <Pill label={l.badge} bg={c.tertiaryContainer} color={c.tertiaryFixedDim} />
                : <T v="labelSm" style={{ color: c.secondary }}>{l.badge}</T>}
            </View>
          </Row>
        ))}
      </Group>

      <Row style={{ justifyContent: 'space-between', backgroundColor: c.surfaceLow, borderRadius: radius.lg, padding: space.md }}>
        <Row style={{ gap: 12, flexShrink: 1 }}>
          <IconCircle name="file-document-outline" bg={c.surfaceLowest} />
          <View style={{ flexShrink: 1 }}>
            <T v="labelMd" style={{ color: c.primary }}>Statements & Tax Reports</T>
            <T v="bodySm" style={{ color: c.onSurfaceVariant }}>Form 1099-INT & Q3 Ledgers ready</T>
          </View>
        </Row>
        <Row style={{ gap: 4, backgroundColor: c.surfaceLowest, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md }}>
          <Icon name="download" size={16} />
          <T v="labelSm" style={{ color: c.secondary }}>Get PDF</T>
        </Row>
      </Row>

      <Group icon="face-agent" title="Private Client Services">
        <View style={{ backgroundColor: c.surfaceLowest, borderRadius: radius.lg, overflow: 'hidden', ...shadow.sm }}>
          <Item icon="room-service-outline" title="Dedicated Concierge" sub="Marcus Vance • Available 24/7" bg="rgba(172,237,252,0.3)" color={c.secondary} right={<Icon name="message-outline" size={20} color={c.outlineVariant} />} />
          <Divider />
          <Item icon="shield-check-outline" title="Privacy & Banking Disclosures" sub="FDIC Insurance & Data Governance" right={<Icon name="chevron-right" size={20} color={c.outlineVariant} />} />
        </View>
      </Group>

      <View style={{ gap: 8, alignItems: 'center', marginTop: space.md }}>
        <Pressable style={{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 12, borderRadius: radius.lg, backgroundColor: 'rgba(255,218,214,0.4)' }}>
          <Icon name="logout" size={18} color={c.error} />
          <T v="labelMd" style={{ color: c.error }}>Sign Out of Stillwater Bank</T>
        </Pressable>
        <T v="labelSm" style={{ color: c.onSurfaceVariant, opacity: 0.7, textAlign: 'center' }}>
          App Version 4.12.0 • Stillwater Trust & Private Banking N.A.
        </T>
      </View>
    </Screen>
  );
}
