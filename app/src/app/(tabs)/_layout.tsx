import React, { useEffect, useState } from "react";
import { Tabs, Redirect, router, useSegments } from "expo-router";
import { ActivityIndicator } from "react-native";
import { getSession, onSessionChanged } from "../../finance/session";
import { WaveTabBar } from "../../components/WaveTabBar";
import { VoiceProvider } from "../../voice/VoiceProvider";

const tabPaths = {
  Deals: "/(tabs)/Deals",
  Spending: "/(tabs)/Spending",
  Upcoming: "/(tabs)/Upcoming",
  Account: "/(tabs)/Account",
} as const;

function isTab(name: string | undefined): name is keyof typeof tabPaths {
  return name !== undefined && Object.hasOwn(tabPaths, name);
}

function openTab(tab: string) {
  if (isTab(tab)) router.navigate(tabPaths[tab]);
}

export default function TabLayout() {
  const segments: readonly string[] = useSegments();
  const routeName = segments[1];
  const [valid, setValid] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => {
      void getSession().then((t) => setValid(!!t));
    };
    check();
    return onSessionChanged(check);
  }, []);
  if (valid === null) return <ActivityIndicator />;
  if (!valid) return <Redirect href="/" />;
  return (
    <VoiceProvider currentTab={isTab(routeName) ? routeName : null} onNavigate={openTab}>
      <Tabs
        tabBar={(p) => <WaveTabBar {...p} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="Deals" />
        <Tabs.Screen name="Spending" />
        <Tabs.Screen name="Upcoming" />
        <Tabs.Screen name="Account" />
      </Tabs>
    </VoiceProvider>
  );
}
