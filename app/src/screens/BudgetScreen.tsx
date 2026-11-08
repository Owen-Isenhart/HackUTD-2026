import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { api } from "../finance/financeApi";
import { Page, Action, Field, Box, money } from "./PipelineControls";
type Budget = {
  category: string;
  version: number;
  period: string;
  limitCents: number;
  spentCents: number;
  source: string;
  evidence: {
    income: number | null;
    fixed: number;
    scale: number;
    normal: Record<string, number>;
    flags: string[];
  };
};
function BudgetRow({ b, reload }: { b: Budget; reload: () => void }) {
  const [value, setValue] = useState(String(b.limitCents / 100)),
    [error, setError] = useState("");
  return (
    <Box>
      <Text>
        {b.category} · {b.period} · version {b.version}
      </Text>
      <Text>
        {money(b.limitCents)} limit · {money(b.spentCents)} spent
      </Text>
      <Text>
        {b.source === "user"
          ? "Set by you"
          : "Set automatically from your history"}
      </Text>
      {b.source === "derived" ? (
        <Text>
          Median monthly history:{" "}
          {money(b.evidence.normal?.[b.category] || b.limitCents)}. Scale:{" "}
          {Math.round((b.evidence.scale || 1) * 100)}%.{" "}
          {b.evidence.flags?.map(flag=>({income_unknown:"Not enough payroll history to estimate income",spending_above_income:"This budget reduces usual spending by 40%, but does not close the full income gap"}[flag]||flag)).join(". ")}. Includes labeled synthetic purchases
          when enabled.
        </Text>
      ) : null}
      <Field
        label="New limit in dollars"
        value={value}
        numeric
        onChangeText={setValue}
      />
      <Action
        label="Save my limit"
        onPress={() => {
          const cents = Math.round(Number(value) * 100);
          if (!Number.isFinite(cents) || cents < 0) {
            setError("Enter a valid amount");
            return;
          }
          void api("/api/v1/budgets/" + b.category, "PUT", {
            version: b.version,
            limitCents: cents,
            period: b.period,
          })
            .then(reload)
            .catch((e) => setError(String(e)));
        }}
      />
      {b.source === "user" ? (
        <Action
          label="Use automatic budget again"
          onPress={() => {
            void api("/api/v1/budgets/" + b.category + "/user", "DELETE", {
              version: b.version,
            })
              .then(reload)
              .catch((e) => setError(String(e)));
          }}
        />
      ) : null}
      <Text>{error}</Text>
    </Box>
  );
}
export default function BudgetScreen({
  onContinue,
}: {
  onContinue?: () => void;
}) {
  const [budgets, setBudgets] = useState<Budget[]>([]),
    [error, setError] = useState("");
  const load = () => {
    void api("/api/v1/budgets")
      .then((r) => setBudgets(r.budgets))
      .catch((e) => setError(String(e)));
  };
  useEffect(load, []);
  return (
    <Page title="Your budget">
      <Text>
        Budgets are enforced from the start. You can change them at any time.
        User edits survive automatic updates.
      </Text>
      <Text>{error}</Text>
      {budgets.map((b) => (
        <BudgetRow key={b.category + ":" + b.version} b={b} reload={load} />
      ))}
      {onContinue ? (
        <Action label="Continue to stores" onPress={onContinue} />
      ) : null}
    </Page>
  );
}
