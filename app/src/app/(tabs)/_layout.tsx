import React, { useEffect, useState } from "react";
import { Tabs, Redirect } from "expo-router";
import { ActivityIndicator } from "react-native";
import { getSession, onSessionChanged } from "../../finance/session";
import { WaveTabBar } from "../../components/WaveTabBar";
export default function TabLayout() {
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
    <Tabs
      tabBar={(p) => <WaveTabBar {...p} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="Deals" />
      <Tabs.Screen name="Spending" />
      <Tabs.Screen name="Upcoming" />
      <Tabs.Screen name="Account" />
    </Tabs>
  );
}
