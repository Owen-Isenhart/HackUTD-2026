import React, { useEffect, useState } from "react";
import { Text, Switch } from "react-native";
import { api } from "../finance/financeApi";
import { useUserLocation } from "../location/useUserLocation";
import { Page, Action, Box } from "./PipelineControls";
import QuestionsScreen from "./QuestionsScreen";
import BudgetScreen from "./BudgetScreen";
import StoresScreen from "./StoresScreen";
type Stage = {
  kind: string;
  state: string;
  summary: string;
  last_error: string | null;
};
export default function OnboardingProgressScreen({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState(0),
    [stages, setStages] = useState<Stage[]>([]),
    [error, setError] = useState(""),
    [email, setEmail] = useState(false),
    [gps, setGps] = useState(false);
  const loc = useUserLocation();
  const go = async (next: number) => {
    try {
      if (next > 0) {
        const o = await api("/api/v1/onboarding");
        await api("/api/v1/onboarding", "PUT", {
          version: o.version,
          step: next >= 4 ? "signups" : next >= 3 ? "stores" : "questions",
        });
      }
      setPhase(next);
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void api("/api/v1/onboarding").then((o) => {
      if (o.step === "signups") setPhase(4);
      else if (o.step === "stores") setPhase(3);
      else if (o.step === "questions") setPhase(2);
    });
    void api("/v1/deals/status")
      .then((s) => setEmail(!!s.profile?.consent_at && !s.profile?.revoked_at))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (phase !== 0) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const o = await api("/api/v1/onboarding");
        if (!active) return;
        setStages(o.stages);
        const done =
          o.stages.length &&
          o.stages.every((s: Stage) =>
            ["completed", "skipped", "dead"].includes(s.state),
          );
        if (!done) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (active) setError(String(e));
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [phase]);
  const consent = async (on: boolean) => {
    try {
      await api(
        "/v1/deals/consent",
        on ? "POST" : "DELETE",
        on ? { timezone: "America/Chicago", version: "deals-v1" } : undefined,
      );
      setEmail(on);
    } catch (e) {
      setError(String(e));
    }
  };
  if (phase === 2) return <QuestionsScreen onContinue={() => void go(3)} />;
  if (phase === 3) return <BudgetScreen onContinue={() => void go(4)} />;
  if (phase === 4)
    return (
      <StoresScreen
        onContinue={() => {
          void api("/api/v1/onboarding/complete", "POST", {})
            .then(onComplete)
            .catch((e) => setError(String(e)));
        }}
      />
    );
  const complete =
    stages.length > 0 &&
    stages.every((s) => ["completed", "skipped"].includes(s.state));
  return (
    <Page
      title={phase === 0 ? "Preparing your sandbox account" : "Your choices"}
    >
      {error ? <Text accessibilityLiveRegion="polite">{error}</Text> : null}
      {phase === 0 ? (
        <>
          <Text>
            Sandbox bank data. Generated history, when enabled, is labeled
            synthetic and never changes your bank balance.
          </Text>
          {stages.map((s) => (
            <Box key={s.kind}>
              <Text>
                {s.kind.replace(/_/g, " ")} · {s.state}
              </Text>
              <Text>{s.summary || s.last_error || "Waiting"}</Text>
            </Box>
          ))}
          {stages.some((s) => s.state === "dead") ? (
            <Action
              label="Retry import"
              onPress={() => {
                void api("/api/v1/finance/sync", "POST", {})
                  .then(() => setPhase(-1))
                  .then(() => setPhase(0))
                  .catch((e) => setError(String(e)));
              }}
            />
          ) : null}
          <Action
            label="Continue"
            disabled={!complete}
            onPress={() => void go(1)}
          />
        </>
      ) : (
        <>
          <Box>
            <Text>
              Create a private email address for store rewards, and read store
              emails sent to it.
            </Text>
            <Switch
              accessibilityLabel="Store rewards email consent"
              value={email}
              onValueChange={(on) => {
                void consent(on);
              }}
            />
          </Box>
          <Box>
            <Text>Use my location to suggest deals nearby.</Text>
            <Switch
              accessibilityLabel="Location consent"
              value={gps}
              onValueChange={(on) => {
                setGps(on);
                if (on) void loc.startLive();
                else loc.stop();
              }}
            />
            <Text>{loc.status.kind}</Text>
          </Box>
          <Action label="Continue to questions" onPress={() => void go(2)} />
        </>
      )}
    </Page>
  );
}
