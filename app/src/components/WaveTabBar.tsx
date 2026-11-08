import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { c } from '../theme';
import { useReducedMotion, useTimed } from '../motion';
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
      <View style={s.waves} pointerEvents="none">
        <WaveLayer d="M0,28 C160,8 360,56 580,22 C780,-8 970,44 1200,16 L1200,120 L0,120 Z" fill="#2A6F7C" opacity={0.55} amp={10} ms={9000} />
        <WaveLayer d="M0,46 C190,20 400,68 620,38 C820,12 1010,58 1200,32 L1200,120 L0,120 Z" fill="#206774" opacity={0.85} amp={8} ms={11000} reverse />
        <WaveLayer d="M0,64 C220,44 420,80 640,56 C850,34 1040,70 1200,52 L1200,120 L0,120 Z" fill={c.nav} amp={5} ms={13000} />
      </View>
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
                <Dot on={focused} />
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
  waves: { height: 40, marginBottom: -1, overflow: 'hidden' },
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { backgroundColor: c.nav },
  inner: { flexDirection: 'row', justifyContent: 'space-around', height: 64, maxWidth: 512, width: '100%', alignSelf: 'center' },
  item: { minWidth: 64, height: 48, alignItems: 'center', justifyContent: 'center', gap: 2, alignSelf: 'center' },
  dot: { position: 'absolute', top: -6, width: 24, height: 4, borderRadius: 2, backgroundColor: c.secondaryFixed },
});

function Dot({ on }: { on: boolean }) {
  const v = useTimed(on ? 1 : 0, 150);
  return <Animated.View style={[s.dot, { opacity: v, transform: [{ scaleX: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }]} />;
}

// One wave layer drifts a few px side to side (and a hair up/down) on a slow sine loop.
// Layer is 112% wide so the sway never shows an edge. Transform-only; off under reduced motion.
function WaveLayer({ d, fill, opacity = 1, amp, ms, reverse = false }: {
  d: string; fill: string; opacity?: number; amp: number; ms: number; reverse?: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      t.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(t, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, ms, t]);
  const a = reverse ? amp : -amp;
  return (
    <Animated.View
      style={{
        position: 'absolute', top: 0, bottom: 0, left: '-6%', width: '112%',
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [a, -a] }) },
          { translateY: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -1.5, 0] }) },
        ],
      }}
    >
      <Svg width="100%" height={40} viewBox="0 0 1200 120" preserveAspectRatio="none">
        <Path d={d} fill={fill} opacity={opacity} />
      </Svg>
    </Animated.View>
  );
}
