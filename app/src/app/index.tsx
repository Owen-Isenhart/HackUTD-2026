import React, { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { router } from "expo-router";
import SignInScreen from "../screens/SignInScreen";
import OnboardingProgressScreen from "../screens/OnboardingProgressScreen";
import { getSession, onSessionChanged } from "../finance/session";
import { api } from "../finance/financeApi";
export default function Entry() {
  const [state, setState] = useState<"loading" | "identify" | "onboard">(
    "loading",
  );
  useEffect(() => {
    const check = async () => {
      try {
        if (!(await getSession())) {
          setState("identify");
          return;
        }
        const o = await api("/api/v1/onboarding");
        if (o.step === "done") router.replace("/(tabs)/Deals");
        else setState("onboard");
      } catch {
        setState("identify");
      }
    };
    void check();
    return onSessionChanged(() => {
      void check();
    });
  }, []);
  if (state === "loading") return <ActivityIndicator />;
  if (state === "identify")
    return <SignInScreen onContinue={() => setState("onboard")} />;
  return (
    <OnboardingProgressScreen
      onComplete={() => router.replace("/(tabs)/Deals")}
    />
  );
}
