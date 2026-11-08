import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { c } from '../theme';
import { Icon, IconName, T } from './ui';

const ICONS: Record<string, { icon: IconName; label: string }> = {
  Deals: { icon: 'compass-outline', label: 'Deals' },
  Spending: { icon: 'wallet-outline', label: 'Spending' },
  Upcoming: { icon: 'calendar-clock-outline', label: 'Upcoming' },
  Account: { icon: 'account-outline', label: 'Account' },
};

// Water-wave nav from the Stitch design: 3 layered wave paths over a dark slab.
export function WaveTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={s.wrap} pointerEvents="box-none">
      <Svg width="100%" height={40} viewBox="0 0 1200 120" preserveAspectRatio="none" style={{ marginBottom: -1 }}>
        <Path d="M0,28 C160,8 360,56 580,22 C780,-8 970,44 1200,16 L1200,120 L0,120 Z" fill="#2A6F7C" opacity={0.55} />
        <Path d="M0,46 C190,20 400,68 620,38 C820,12 1010,58 1200,32 L1200,120 L0,120 Z" fill="#206774" opacity={0.85} />
        <Path d="M0,64 C220,44 420,80 640,56 C850,34 1040,70 1200,52 L1200,120 L0,120 Z" fill={c.nav} />
      </Svg>
      <View style={[s.bar, { paddingBottom: insets.bottom }]}>
        <View style={s.inner}>
          {state.routes.map((route, i) => {
            const focused = state.index === i;
            const meta = ICONS[route.name];
            const col = focused ? '#fff' : 'rgba(255,255,255,0.75)';
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                onPress={() => {
                  const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
                }}
                style={s.item}
              >
                {focused ? <View style={s.dot} /> : null}
                <Icon name={meta.icon} size={24} color={col} />
                <T v="labelSm" style={{ color: col, fontFamily: focused ? 'Manrope_600SemiBold' : 'Manrope_500Medium' }}>
                  {meta.label}
                </T>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { backgroundColor: c.nav },
  inner: { flexDirection: 'row', justifyContent: 'space-around', height: 64, maxWidth: 512, width: '100%', alignSelf: 'center' },
  item: { minWidth: 64, height: 48, alignItems: 'center', justifyContent: 'center', gap: 2, alignSelf: 'center' },
  dot: { position: 'absolute', top: -6, width: 24, height: 4, borderRadius: 2, backgroundColor: c.secondaryFixed },
});
