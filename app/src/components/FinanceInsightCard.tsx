import React from 'react';
import { Card, SectionTitle, T } from './ui';
import { c, space } from '../theme';

export type FinanceInsight = {
  title: string;
  text: string;
  source: 'nemotron' | 'profile';
};

export function FinanceInsightCard({ insight }: { insight?: FinanceInsight | null }) {
  if (!insight) return null;
  return (
    <Card style={{ gap: space.sm, backgroundColor: c.secondaryContainer }}>
      <SectionTitle title={insight.title} sub={insight.source === 'nemotron' ? 'Selected by Nemotron' : 'From your financial profile'} />
      <T v="bodyMd">{insight.text}</T>
    </Card>
  );
}
