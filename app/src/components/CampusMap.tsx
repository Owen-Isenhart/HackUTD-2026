import React from 'react';
import { View } from 'react-native';
import { T } from './ui';
import type { CampusMapProps } from './CampusMap.types';
import { c, radius } from '../theme';

// react-native-maps has no web build; the phone app shows the real map.
export default function CampusMap({ height }: CampusMapProps) {
  return (
    <View style={{ height, borderRadius: radius.lg, backgroundColor: c.surfaceLow, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <T v="bodySm" style={{ color: c.onSurfaceVariant, textAlign: 'center' }}>Open the app in Expo Go to see the UT Dallas map.</T>
    </View>
  );
}
