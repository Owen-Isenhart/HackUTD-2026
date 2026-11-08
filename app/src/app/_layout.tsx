import React, { useEffect } from "react";
import { Stack, router } from "expo-router";
import { View, Platform, ActivityIndicator } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from "@expo-google-fonts/manrope";
import { Jost_300Light } from "@expo-google-fonts/jost";
import { c } from "../theme";
import { getSession, onSessionChanged } from "../finance/session";
export default function Layout() {
  useEffect(
    () =>
      onSessionChanged(() => {
        void getSession().then((token) => {
          if (!token) router.replace("/");
        });
      }),
    [],
  );
  const [loaded] = useFonts({
    Jost_300Light,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  if (!loaded) return <ActivityIndicator />;
  return (
    <SafeAreaProvider>
      <View
        style={{ flex: 1, backgroundColor: c.surface, alignItems: "center" }}
      >
        <View
          style={{
            flex: 1,
            width: "100%",
            maxWidth: Platform.OS === "web" ? 430 : undefined,
          }}
        >
          <Stack screenOptions={{ headerShown: false }} />
          <StatusBar style="dark" />
        </View>
      </View>
    </SafeAreaProvider>
  );
}
