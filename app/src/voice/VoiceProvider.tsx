// Gives the whole app one voice assistant, controlled by tapping Nessie in the nav bar (see
// WaveTabBar.tsx). While it is active Nessie pops up and a caption says what is happening.
// If no key is configured the first tap shows a small box to type the voice service key into.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { c } from '../theme';
import { captureScreenFacts, isPopped, routeForTab, statusCaption, type ScreenFacts, type VoiceStatus } from './voiceSession';
import { isExpoGo } from './runtime';

// Expo Go cannot load LiveKit's native WebRTC, so it uses one-shot HTTP turns instead. Only the
// chosen module is evaluated, so Expo Go never touches the LiveKit native code.
/* eslint-disable @typescript-eslint/no-require-imports */
const useAssistant: typeof import('./useVoiceAssistant').useVoiceAssistant = isExpoGo
  ? require('./useExpoVoice').useExpoVoice
  : require('./useVoiceAssistant').useVoiceAssistant;
/* eslint-enable @typescript-eslint/no-require-imports */

declare const process: { env: Record<string, string | undefined> };
const VOICE_API_URL = (process.env.EXPO_PUBLIC_VOICE_API_URL ?? '').replace(/\/+$/, '');
const VOICE_USER_ID = process.env.EXPO_PUBLIC_VOICE_USER_ID ?? 'demo-user';
// Demo shortcut: EXPO_PUBLIC_* values are built into the served JavaScript. Fine for a local demo;
// leave it unset to type the key in the box instead (kept in memory only).
const DEMO_KEY = (process.env.EXPO_PUBLIC_VOICE_API_KEY ?? '').trim();

type VoiceControl = { status: VoiceStatus; popped: boolean; toggle: () => void };
const VoiceContext = createContext<VoiceControl | null>(null);
const CaptureFactsContext = createContext<((tab: string, facts: readonly string[]) => void) | null>(null);

/** The voice control for Nessie, or null when the app has no VoiceProvider (she then pops up on her own). */
export const useVoice = () => useContext(VoiceContext);

/** Capture display-safe facts from a screen after its backend data is ready. */
export function useCaptureVoiceFacts(tab: string, facts: readonly string[]) {
  const capture = useContext(CaptureFactsContext);
  useEffect(() => { capture?.(tab, facts); }, [capture, tab, facts]);
}

type Props = { currentTab: string | null; onNavigate: (tab: string) => void; children: React.ReactNode };

export function VoiceProvider({ currentTab, onNavigate, children }: Props) {
  const [typed, setTyped] = useState('');
  const [screenFacts, setScreenFacts] = useState<ScreenFacts>({});
  const capture = useCallback((tab: string, facts: readonly string[]) => {
    if (facts.length) setScreenFacts((previous) => captureScreenFacts(previous, tab, facts));
  }, []);
  const route = currentTab ? routeForTab(currentTab) : null;
  const { status, error, needsKey, toggle, reply } = useAssistant({
    baseUrl: VOICE_API_URL, userId: VOICE_USER_ID, getKey: () => DEMO_KEY, currentTab, onNavigate,
    currentFacts: route ? screenFacts[route] : undefined,
  });
  const control = useMemo<VoiceControl>(
    () => ({ status, popped: isPopped(status), toggle: () => { void toggle(); } }),
    [status, toggle],
  );
  const caption = statusCaption(status);

  return (
    <VoiceContext.Provider value={control}>
      <CaptureFactsContext.Provider value={capture}>{children}</CaptureFactsContext.Provider>
      <View pointerEvents="box-none" style={s.overlay}>
        {!VOICE_API_URL && needsKey ? (
          <Text style={s.error}>Set EXPO_PUBLIC_VOICE_API_URL in app/.env.local and restart.</Text>
        ) : null}
        {needsKey && VOICE_API_URL ? (
          <View style={s.panel}>
            <Text style={s.hint}>Voice service key</Text>
            <TextInput
              style={s.input} value={typed} onChangeText={setTyped} placeholder="paste the key" placeholderTextColor="#8aa"
              autoCapitalize="none" autoCorrect={false} secureTextEntry
            />
            <Pressable
              accessibilityRole="button" disabled={!typed.trim()} style={[s.go, !typed.trim() && s.off]}
              onPress={() => { void toggle(typed).then(() => setTyped('')); }}
            >
              <Text style={s.goText}>Start talking</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
        {reply ? (
          <View style={s.bubble}><Text style={s.bubbleText}>{reply}</Text></View>
        ) : null}
        {caption ? (
          <View style={[s.pill, status === 'listening' && s.pillListening]}>
            <View style={[s.dot, status === 'listening' && s.dotListening]} />
            <Text style={s.pillText}>{caption}</Text>
          </View>
        ) : null}
      </View>
    </VoiceContext.Provider>
  );
}

// Sits above Nessie's popped-up head (she rises about 200px above the nav bar).
const s = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 300, alignItems: 'center', gap: 8 },
  bubble: { maxWidth: 300, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(10,23,32,0.15)' },
  bubbleText: { color: '#0A1720', fontSize: 15, lineHeight: 20 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: 'rgba(10,23,32,0.88)' },
  pillListening: { backgroundColor: '#C0392B' },
  pillText: { color: '#fff', fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#7fd6e0' },
  dotListening: { backgroundColor: '#fff' },
  panel: { width: 260, padding: 12, borderRadius: 14, backgroundColor: '#0A1720', gap: 8 },
  hint: { color: '#cfe', fontSize: 12 },
  input: { backgroundColor: '#13303f', color: '#fff', borderRadius: 8, paddingHorizontal: 10, height: 40 },
  go: { backgroundColor: c.secondary, borderRadius: 8, height: 40, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.4 },
  goText: { color: '#fff', fontWeight: '700' },
  error: { maxWidth: 280, color: '#fff', backgroundColor: '#C0392B', padding: 8, borderRadius: 8, fontSize: 12 },
});
