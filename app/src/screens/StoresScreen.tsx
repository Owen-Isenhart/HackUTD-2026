import React, { useEffect, useState } from "react";
import { Text, Switch, Linking } from "react-native";
import * as Clipboard from "expo-clipboard";
import { api } from "../finance/financeApi";
import { Page, Box, Action } from "./PipelineControls";
type Store = {
  brand_key: string;
  selected: boolean;
  version: number;
  reasons: string[];
  stats: { visits180: number };
  branches: { name: string }[];
};
type Enrollment = {
  id: string;
  version: number;
  simulated: boolean;
  state: string;
  reason: string;
  program_id: string;
  signup_status: string;
  opted_out_at?: string | null;
};
// Only known merchant and Capital One sites open from the app: the domains in
// services/deals/mobile/api.ts plus the stores in migration 006_loyalty_catalog.sql.
const MERCHANT_DOMAINS = [
  "chipotle.com",
  "panerabread.com",
  "chick-fil-a.com",
  "jcpenney.com",
  "macys.com",
  "starbucks.com",
  "tacobell.com",
  "capitalone.com",
  "capitaloneoffers.com",
  "capitaloneshopping.com",
];
function safeMerchantUrl(url: string) {
  const m = /^https:\/\/([^/:@?#]+)(?:[/?#]|$)/i.exec(url ?? "");
  const host = m?.[1].toLowerCase();
  return (
    !!host && MERCHANT_DOMAINS.some((d) => host === d || host.endsWith("." + d))
  );
}
function Signup({ e, reload }: { e: Enrollment; reload: () => void }) {
  const [flow, setFlow] = useState<any>(null),
    [error, setError] = useState("");
  const act = (path: string, body: unknown) => {
    void api("/v1/deals/enrollments/" + e.id + path, "POST", body)
      .then(reload)
      .catch((e) => setError(String(e)));
  };
  return (
    <Box>
      <Text>{e.program_id}</Text>
      <Text>
        {e.simulated
          ? "Simulated signup (demo)"
          : e.state === "needs_user_input"
            ? "Needs you: open the signup page"
            : e.state === "unsupported"
              ? "No supported signup path"
              : e.signup_status === "confirmed"
                ? "Enrolled (confirmed by merchant evidence)"
                : "Waiting for merchant verification"}
      </Text>
      {!e.simulated && e.state !== "unsupported" ? (
        <>
          <Action
            label="Show signup steps"
            onPress={() => {
              void api("/v1/deals/enrollments/" + e.id + "/flow")
                .then(setFlow)
                .catch((e) => setError(String(e)));
            }}
          />
          {flow ? (
            <>
              <Text>{flow.promotionalAddress}</Text>
              <Text>Already a member?</Text>
              {(["yes", "no", "unknown"] as const).map((existingMembership) => (
                <Action
                  key={existingMembership}
                  label={
                    { yes: "Yes", no: "No", unknown: "Not sure" }[
                      existingMembership
                    ]
                  }
                  onPress={() => {
                    if (existingMembership === "unknown") {
                      setError(
                        "Check your existing membership at the store before creating an account.",
                      );
                      return;
                    }
                    act("/existing-membership", {
                      expectedVersion: flow.version,
                      existingMembership,
                    });
                  }}
                />
              ))}
              <Action
                label="Copy email"
                onPress={() => {
                  void Clipboard.setStringAsync(flow.promotionalAddress);
                }}
              />
              <Action
                label="Open signup page"
                onPress={() => {
                  if (safeMerchantUrl(flow.url)) void Linking.openURL(flow.url);
                  else
                    setError("This signup link needs review before opening.");
                }}
              />
              <Action
                label="I’ve submitted"
                onPress={() =>
                  act("/attempt", {
                    expectedVersion: flow.version,
                    outcome: "submitted",
                    existingMembershipChecked: true,
                  })
                }
              />
            </>
          ) : null}
        </>
      ) : null}
      {e.opted_out_at ? (
        <Action label="Resume promotions" onPress={() => act("/resume", {})} />
      ) : e.state === "enrolled" ? (
        <Action label="Stop promotions" onPress={() => act("/opt-out", {})} />
      ) : null}
      {e.opted_out_at ? (
        <Text>
          Promotions stopped here. Unsubscribe at the store to stop its email; a
          later purchase does not undo this.
        </Text>
      ) : null}
      <Text>{error}</Text>
    </Box>
  );
}
export default function StoresScreen({
  onContinue,
}: {
  onContinue?: () => void;
}) {
  const [stores, setStores] = useState<Store[]>([]),
    [enrollments, setEnrollments] = useState<Enrollment[]>([]),
    [error, setError] = useState("");
  const load = () => {
    void api("/api/v1/stores")
      .then((r) => setStores(r.stores))
      .catch((e) => setError(String(e)));
    void api("/v1/deals/enrollments")
      .then(setEnrollments)
      .catch((e) => setError(String(e)));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <Page title="Stores and signups">
      <Text>
        Frequent stores are selected automatically. Synthetic owners get
        simulated signups only.
      </Text>
      {stores.map((s) => (
        <Box key={s.brand_key}>
          <Text>
            {s.brand_key.replace(/_/g, " ")} · {s.stats.visits180} visits in 180
            days
          </Text>
          <Text>
            {s.reasons
              .map(
                (r) =>
                  ({
                    routine_member: "Part of your routine",
                    visits_180d_ge_2: "Visited at least twice",
                    seen_once: "Seen once, not selected",
                    no_program: "No supported program",
                    paid_membership: "Paid membership excluded",
                    user_choice: "Your choice",
                  })[r] || r,
              )
              .join(" · ")}
          </Text>
          <Text>{s.branches[0]?.name || "Branch not available"}</Text>
          <Switch
            value={s.selected}
            accessibilityLabel={"Select " + s.brand_key}
            onValueChange={(selected) => {
              void api("/api/v1/stores/" + s.brand_key, "PUT", {
                selected,
                version: s.version,
              })
                .then(load)
                .catch((e) => setError(String(e)));
            }}
          />
        </Box>
      ))}
      {enrollments.map((e) => (
        <Signup key={e.id + ":" + e.version} e={e} reload={load} />
      ))}
      <Text accessibilityLiveRegion="polite">{error}</Text>
      {onContinue ? (
        <Action label="Finish onboarding" onPress={onContinue} />
      ) : null}
    </Page>
  );
}
