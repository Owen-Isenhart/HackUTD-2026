// Live data for the four tabs, from GET /api/v1/app/summary: the signed-in
// owner's recent Nessie v2 rows, Tiger Data budgets/forecast, and a
// Nemotron-chosen recommendation. One request is shared by every tab.
import { useEffect, useState } from 'react';
import type { IconName } from '../components/ui';
import { api, FinanceApiError } from './financeApi';
import { onSessionChanged } from './session';

export type Deal = {
  id: number; merchant: string; icon: IconName; reward: string; dist: string; area: string;
  title: string; sub: string; note: string; cta: string; pin: { x: number; y: number }; cat: string;
};
export type SpendCategory = { key: string; name: string; sub: string; short: string; icon: IconName; color: string; amt: number; pct: number };
export type Txn = { id: string; name: string; when: string; cat: string; amt: number; icon: IconName };
export type Bill = { name: string; icon: IconName; line: string; tag: string; tagErr: boolean; amt: number; acct: string; date: string; autopay?: boolean; pay?: boolean };
export type Income = { name: string; icon: IconName; line: string; date: string; amt: number; status: string };
export type Day = { key: string; dow: string; d: string; kind: 'today' | 'out' | 'in' | 'none' };
export type Insight = { id: string; title: string; text: string; source: 'nemotron' | 'profile' };
export type AppSummary = {
  asOf: string | null;
  recommendation: Insight | null;
  featuredDealId: number | null;
  deals: Deal[];
  dealCategories: string[];
  spending: {
    monthLabel: string; prevMonthLabel: string; total: number; dailyAverage: number; changePct: number | null;
    status: string; budgetLine: string; categories: SpendCategory[]; transactions: Txn[];
    budgets: { category: string; spent: number; limit: number }[];
  };
  upcoming: { rangeLabel: string; bills: Bill[]; incomes: Income[]; days: Day[]; out: number; inn: number; safeToSpend: number | null; balance: number | null };
  account: {
    name: string; initials: string; tier: string; checking: string; balance: string; cardName: string; cardLast4: string; cardholder: string;
    linked: { name: string; sub: string; amt: string; badge: string; icon: IconName }[];
  };
};

let cache: { at: number; data: AppSummary } | null = null;
let inflight: Promise<AppSummary> | null = null;
const listeners = new Set<() => void>();
onSessionChanged(() => { cache = null; listeners.forEach((fn) => fn()); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The first sign-in queues a bank import; the summary answers 409 until it lands.
async function fetchSummary(): Promise<AppSummary> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await api('/api/v1/app/summary')) as AppSummary;
    } catch (e) {
      if (!(e instanceof FinanceApiError) || e.status !== 409 || attempt >= 40) throw e;
      await sleep(3000);
    }
  }
}
export function loadSummary(force = false): Promise<AppSummary> {
  if (!force && cache && Date.now() - cache.at < 60_000) return Promise.resolve(cache.data);
  inflight ??= fetchSummary()
    .then((data) => { cache = { at: Date.now(), data }; listeners.forEach((fn) => fn()); return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useAppSummary() {
  const [data, setData] = useState<AppSummary | null>(cache?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const run = () => {
      setError(null);
      loadSummary().then((d) => live && setData(d)).catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load your accounts.'));
    };
    const sync = () => { if (cache) setData(cache.data); else run(); };
    listeners.add(sync);
    run();
    return () => { live = false; listeners.delete(sync); };
  }, []);
  return { data, error, reload: () => loadSummary(true).then(setData).catch((e) => setError(String(e?.message ?? e))) };
}
