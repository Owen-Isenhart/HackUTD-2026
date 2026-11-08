// Web version: react-native-maps has no web build, so the demo location runs on the phone only.
import React from 'react';
import { Screen } from '../components/Screen';
import { Card, T } from '../components/ui';
import { c } from '../theme';

export default function DemoLocationScreen() {
  return (
    <Screen title="Demo location">
      <Card>
        <T v="bodySm" style={{ color: c.onSurfaceVariant }}>Open the app in Expo Go on your phone to move the demo location.</T>
      </Card>
    </Screen>
  );
}
