import React from 'react';
import {
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { c, radius, shadow, space, type } from '../theme';
import { PressScale, useTimed } from '../motion';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 20, color = c.secondary }: { name: IconName; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Row({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export function T({
  v = 'bodyMd',
  style,
  children,
  numberOfLines,
}: {
  v?: keyof typeof type;
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[type[v], style]}>
      {children}
    </Text>
  );
}

export function IconCircle({
  name,
  bg = c.surfaceHigh,
  color = c.secondary,
  size = 40,
}: {
  name: IconName;
  bg?: string;
  color?: string;
  size?: number;
}) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.5} color={color} />
    </View>
  );
}

export function Pill({ label, bg, color, style }: { label: string; bg: string; color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: bg, borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 }, style]}>
      <T v="labelSm" style={{ color }}>{label}</T>
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon,
  style,
  small,
  textColor = c.onPrimary,
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  textColor?: string;
}) {
  return (
    <PressScale
      onPress={onPress}
      style={[
        s.btn,
        small && { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.md },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={small ? 14 : 20} color={textColor} /> : null}
      <T v={small ? 'labelSm' : 'labelLg'} style={{ color: textColor }}>{label}</T>
    </PressScale>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const x = useTimed(value ? 22 : 2, 150);
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: value ? c.secondary : c.surfaceHighest, justifyContent: 'center' }}
    >
      <Animated.View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', transform: [{ translateX: x }] }} />
    </Pressable>
  );
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <View style={{ flexShrink: 1 }}>
        <T v="headlineSm" style={{ color: c.primary }}>{title}</T>
        {sub ? <T v="bodySm" style={{ color: c.onSurfaceVariant }}>{sub}</T> : null}
      </View>
      {right}
    </Row>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: c.surfaceLowest,
    borderRadius: radius.xl,
    padding: space.lg,
    ...shadow.card,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: c.primary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.lg,
  },
});
