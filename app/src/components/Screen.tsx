import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { c, radius, space } from '../theme';
import { Icon, Row, T } from './ui';

// DESIGN.md: scroll areas keep 88px bottom padding for the floating nav.
export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <View style={[s.header, { paddingTop: insets.top }]}>
        <Row style={{ height: 64, paddingHorizontal: 12, justifyContent: 'space-between' }}>
          <View>
            <T v="labelSm" style={{ color: c.secondary, textTransform: 'uppercase', letterSpacing: 1.6 }}>
              Stillwater Bank
            </T>
            <T v="headlineSm" style={{ color: c.primary }}>{title}</T>
          </View>
          <Row style={{ gap: 4 }}>
            <Pressable style={s.hbtn} accessibilityLabel="Notifications">
              <Icon name="bell-outline" size={22} color={c.onSurfaceVariant} />
            </Pressable>
            <View style={s.avatar}>
              <Icon name="account" size={18} color={c.primaryFixed} />
            </View>
          </Row>
        </Row>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: space.md, paddingBottom: 88 + 48, gap: space.md }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: 'rgba(253,249,241,0.95)' },
  hbtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
  avatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: c.primaryContainer,
    alignItems: 'center', justifyContent: 'center',
  },
});
