// What a section shows while its data is loading, missing or failed. Never a blank or an invented fallback.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { c, space } from '../theme';
import type { LoadState } from '../finance/useApi';
import { Button, Icon, Row, T } from './ui';

export function DataState<T>({ state, onRetry, children }: { state: LoadState<T>; onRetry?: () => void; children: (data: T) => React.ReactNode }) {
  if (state.kind === 'ready' || (state.kind === 'loading' && state.data !== undefined)) return <>{children(state.data as T)}</>;
  if (state.kind === 'loading') return <ActivityIndicator color={c.secondary} style={{ padding: space.md }} />;
  const warn = state.kind === 'error';
  return (
    <View style={{ gap: space.xs }}>
      <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
        <Icon name={warn ? 'alert-circle-outline' : 'information-outline'} size={16} color={warn ? c.error : c.secondary} />
        <T v="bodySm" style={{ color: warn ? c.error : c.onSurfaceVariant, flexShrink: 1 }}>{state.message}</T>
      </Row>
      {warn && onRetry ? <Button label="Try again" small onPress={onRetry} /> : null}
    </View>
  );
}

export function Tag({ text }: { text: string }) {
  return <T v="labelSm" style={{ color: c.outline }}>{text}</T>;
}
