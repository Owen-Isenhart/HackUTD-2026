import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { api } from "../finance/financeApi";
import { Page, Box, Action, money } from "./PipelineControls";
export default function FinanceForecastScreen() {
  const [forecast, setForecast] = useState<any>(null),
    [routines, setRoutines] = useState<any[]>([]),
    [error, setError] = useState("");
  const load = () => {
    void api("/api/v1/finance/forecast")
      .then(setForecast)
      .catch((e) => setError(String(e)));
    void api("/api/v1/routines")
      .then((r) => setRoutines(r.routines))
      .catch((e) => setError(String(e)));
  };
  useEffect(load, []);
  return (
    <Page title="Forecast and routines">
      <Action
        label="Refresh data"
        onPress={() => {
          void api("/api/v1/finance/sync", "POST", {})
            .then(load)
            .catch((e) => setError(String(e)));
        }}
      />
      {forecast ? (
        <Box>
          <Text>
            {forecast.status} · {forecast.method === "weekly_block_bootstrap_v1" ? "Forecast with ranges" : "Current forecast"}
          </Text>
          <Text>
            Checking balance:{" "}
            {forecast.startingBalanceCents === null
              ? "Unavailable"
              : money(forecast.startingBalanceCents)}
          </Text>
          <Text>
            Available after projected commitments:{" "}
            {forecast.safeToSpendCents === null
              ? "Needs clarification"
              : money(forecast.safeToSpendCents)}
          </Text>
          <Text>Savings (separate from spending money): {forecast.savingsBalanceCents==null?"Unavailable":money(forecast.savingsBalanceCents)}</Text>
          {forecast.bands ? (
            <>
              <Text>
                {forecast.method === "weekly_block_bootstrap_v1" ? "Forecast range" : "Experimental range"} · includes synthetic demo history when enabled. {forecast.method !== "weekly_block_bootstrap_v1" ? "Recommendations use the current forecast until this range passes evaluation." : ""}
              </Text>
              {forecast.bands.daily
                .filter((_: unknown, i: number) => i % 7 === 0 || i === 29)
                .map((d: any) => (
                  <Text key={d.date}>
                    {d.date}: {money(d.lowCents)} / {money(d.middleCents)} /{" "}
                    {money(d.highCents)} (low / middle / high)
                  </Text>
                ))}
            </>
          ) : null}
        </Box>
      ) : null}
      {routines.map((r) => (
        <Box key={r.id}>
          <Text>
            {r.brand_key || r.purpose} ·{" "}
            {r.kind === "stated"
              ? "Stated by you"
              : r.provenance.includes("synthetic_persona")
                ? "Synthetic demo history"
                : "Sandbox bank data"}
          </Text>
          <Text>{r.evidence}</Text>
        </Box>
      ))}
      <Text accessibilityLiveRegion="polite">{error}</Text>
    </Page>
  );
}
