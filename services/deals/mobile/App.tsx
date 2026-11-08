import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import { DealsScreen } from "./DealsScreen";
import type { Session } from "./api";
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:3001"),
    [token, setToken] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync("deals-session");
        if (saved && active) setSession(JSON.parse(saved));
      } catch {
        if (active) setError("Saved session unavailable. Sign in again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function signIn() {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && __DEV__))
        throw new Error("Use an HTTPS server address.");
      if (url.username || url.password || url.search || url.hash)
        throw new Error(
          "Use a server address without credentials or query parameters.",
        );
      if (!token.trim()) throw new Error("Enter your session token.");
      const next = {
        baseUrl: url.href.replace(/\/$/, ""),
        token: token.trim(),
      };
      await SecureStore.setItemAsync("deals-session", JSON.stringify(next), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      setToken("");
      setSession(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
    }
  }
  async function signOut() {
    await SecureStore.deleteItemAsync("deals-session");
    setSession(null);
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.safe}>
        {loading ? (
          <ActivityIndicator accessibilityLabel="Loading saved session" />
        ) : session ? (
          <DealsScreen
            key={session.token}
            session={session}
            onSignOut={signOut}
          />
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={s.fill}
          >
            <ScrollView
              contentContainerStyle={s.login}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.brand}>NESSIESSENTIAL</Text>
              <Text style={s.title}>Good deals.{"\n"}Clear terms.</Text>
              <Text style={s.description}>
                Connect your private deals workspace to review offers, manage
                merchant rewards, and see what is ready to use.
              </Text>
              <Text style={s.label}>Server address</Text>
              <TextInput
                accessibilityLabel="Server address"
                autoCapitalize="none"
                autoCorrect={false}
                value={baseUrl}
                onChangeText={setBaseUrl}
                style={s.input}
                keyboardType="url"
              />
              <Text style={s.label}>Session token</Text>
              <TextInput
                accessibilityLabel="Session token"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                value={token}
                onChangeText={setToken}
                style={s.input}
              />
              <Text style={s.note}>
                Use the session supplied by your team’s backend. Provider
                credentials belong on the server.
              </Text>
              {!!error && (
                <Text accessibilityRole="alert" style={s.error}>
                  {error}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={signIn}
                style={s.button}
              >
                <Text style={s.buttonText}>Open my deals →</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F7F1" },
  fill: { flex: 1 },
  login: {
    padding: 28,
    paddingTop: 58,
    gap: 12,
    maxWidth: 560,
    alignSelf: "center",
    width: "100%",
  },
  brand: {
    fontSize: 12,
    letterSpacing: 2.3,
    color: "#376A58",
    fontWeight: "800",
  },
  title: {
    fontSize: 42,
    lineHeight: 47,
    color: "#163D32",
    fontWeight: "700",
    marginVertical: 20,
  },
  description: {
    fontSize: 17,
    lineHeight: 26,
    color: "#5A6860",
    marginBottom: 24,
  },
  label: { fontSize: 13, fontWeight: "700", color: "#263F35" },
  input: {
    backgroundColor: "white",
    borderColor: "#D3DDD4",
    borderWidth: 1,
    borderRadius: 12,
    padding: 15,
    fontSize: 15,
    color: "#163D32",
  },
  note: { fontSize: 12, lineHeight: 18, color: "#68756D", marginBottom: 12 },
  error: { color: "#9F342C", lineHeight: 21 },
  button: {
    padding: 18,
    backgroundColor: "#1B5E46",
    borderRadius: 14,
    alignItems: "center",
  },
  buttonText: { color: "white", fontSize: 16, fontWeight: "700" },
});
