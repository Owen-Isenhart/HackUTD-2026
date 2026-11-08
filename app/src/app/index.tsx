import React, { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { router } from "expo-router";
import SignInScreen from "../screens/SignInScreen";
import { getSession, onSessionChanged } from "../finance/session";

// Sign in with the Nessie sandbox name and card last four, then go straight to
// the four tabs. The bank import runs on the server; the tabs wait for it.
export default function Entry() {
  const [state, setState] = useState<"loading" | "identify">("loading");
  useEffect(() => {
    const check = async () => {
      if (await getSession()) router.replace("/(tabs)/Deals");
      else setState("identify");
    };
    void check();
    return onSessionChanged(() => {
      void check();
    });
  }, []);
  if (state === "loading") return <ActivityIndicator />;
  return <SignInScreen onContinue={() => router.replace("/(tabs)/Deals")} />;
}
