import React from 'react';
import { ActivityIndicator } from 'react-native';
import { Screen } from './Screen';
import { Button, Card, T } from './ui';
import { c } from '../theme';

export function SummaryLoading({ title, error, onRetry }: { title: string; error: string | null; onRetry: () => void }) {
  return (
    <Screen title={title}>
      <Card style={{ alignItems: 'center', gap: 12 }}>
        {error ? (
          <>
            <T v="bodyMd" style={{ color: c.error, textAlign: 'center' }}>{error}</T>
            <Button label="Try again" small onPress={onRetry} />
          </>
        ) : (
          <>
            <ActivityIndicator color={c.secondary} />
            <T v="bodySm" style={{ color: c.onSurfaceVariant, textAlign: 'center' }}>Loading your Nessie accounts…</T>
          </>
        )}
      </Card>
    </Screen>
  );
}
