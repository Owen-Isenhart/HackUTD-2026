import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { api } from "../finance/financeApi";
import { Page, Action, Box, money } from "./PipelineControls";
type Row = {
  id: string;
  brand_key: string | null;
  kind: string;
  direction: string;
  occurred_at: string;
  amount_cents: number;
  provenance: string;
  screen_flags: string[];
};
export default function FinanceHistoryScreen() {
  const [rows, setRows] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState("");
  const load = (next?: string) => {
    void api(
      "/api/finance-transactions?limit=100" +
        (next ? "&cursor=" + encodeURIComponent(next) : ""),
    )
      .then((r) => {
        setRows((a) => (next ? [...a, ...r.transactions] : r.transactions));
        setCursor(r.nextCursor);
      })
      .catch((e) => setError(String(e)));
  };
  useEffect(() => load(), []);
  return (
    <Page title="Your spending">
      <Action
        label="View and edit budgets"
        onPress={() => router.push("/budgets")}
      />
      <Text>
        Sandbox bank data. Synthetic demo purchases do not change your sandbox
        balance.
      </Text>
      {rows.map((r) => (
        <Box key={r.id}>
          <Text>
            {r.brand_key || r.kind} ·{" "}
            {new Date(r.occurred_at).toLocaleDateString()}
          </Text>
          <Text>
            {r.direction === "inflow" ? "+" : "−"}
            {money(Number(r.amount_cents))}
          </Text>
          <Text>
            {r.provenance === "synthetic_persona"
              ? "Synthetic demo history"
              : "Sandbox bank data"}
          </Text>
          {r.screen_flags?.length ? (
            <Text>Excluded from baselines: {r.screen_flags.join(", ")}</Text>
          ) : null}
        </Box>
      ))}
      {cursor ? (
        <Action label="Load more history" onPress={() => load(cursor)} />
      ) : null}
      <Text>{error}</Text>
    </Page>
  );
}
