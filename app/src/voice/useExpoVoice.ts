// Tap-to-talk for Expo Go, which cannot load LiveKit's native WebRTC module.
// Same shape as useVoiceAssistant, so VoiceProvider and Nessie's button don't change:
//
//   toggle()  idle/ready -> starts recording (Nessie pops up, "Listening…")
//             listening  -> sends what you said now (it also stops by itself after a short pause)
//             speaking   -> stops her and starts listening again
//
// One turn = record a 16 kHz mono WAV, POST it to the calls service /voice/turn with the user's own
// finance session token, then play the spoken answer and show it in the speech bubble.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AudioQuality, IOSOutputFormat, createAudioPlayer, requestRecordingPermissionsAsync, setAudioModeAsync,
  useAudioRecorder, type AudioPlayer, type RecordingOptions,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { getSession } from '../finance/session';
import { routeForTab, tabForRoute, type VoiceStatus } from './voiceSession';

type Options = {
  baseUrl: string;
  userId: string;
  getKey: () => string;
  currentTab: string | null;
  currentFacts?: readonly string[];
  onNavigate: (tab: string) => void;
};

const WAV: RecordingOptions = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: true,
  android: { extension: '.wav', outputFormat: 'default', audioEncoder: 'default' },
  ios: {
    outputFormat: IOSOutputFormat.LINEARPCM, audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false,
  },
  web: {},
};
const MAX_LISTEN_MS = 15_000;
const SPEECH_DB = -38;   // louder than this counts as talking
const SILENCE_MS = 1_100; // stop this long after the user goes quiet
const REPLY_HIDE_MS = 4_000;

export function useExpoVoice({ baseUrl, currentTab, onNavigate }: Options) {
  const recorder = useAudioRecorder(WAV);
  const [status, setStatusState] = useState<VoiceStatus>('idle');
  const statusRef = useRef<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const needsKey = false;
  const [reply, setReply] = useState('');
  const tabRef = useRef(currentTab);
  const navRef = useRef(onNavigate);
  useLayoutEffect(() => {
    tabRef.current = currentTab;
    navRef.current = onNavigate;
  }, [currentTab, onNavigate]);
  const player = useRef<AudioPlayer | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spokeAt = useRef(0);
  const quietSince = useRef(0);
  const startedAt = useRef(0);

  const setStatus = (s: VoiceStatus) => { statusRef.current = s; setStatusState(s); };
  const stopPoll = () => { if (poll.current) clearInterval(poll.current); poll.current = null; };
  const stopPlayback = () => { player.current?.remove(); player.current = null; };

  useEffect(() => () => { stopPoll(); stopPlayback(); if (hide.current) clearTimeout(hide.current); }, []);

  const send = useCallback(async () => {
    stopPoll();
    if (statusRef.current !== 'listening') return;
    setStatus('thinking');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('Nothing was recorded.');
      const audio = await new File(uri).base64();
      const res = await fetch(`${baseUrl}/voice/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, tab: tabRef.current ? routeForTab(tabRef.current) : null, finance_token: await getSession() }),
      });
      if (res.status === 401) throw new Error('Sign in again so Nessie can see your accounts.');
      if (!res.ok) throw new Error(res.status === 502 ? "I couldn't hear that clearly. Try again." : `Voice service answered ${res.status}.`);
      const turn = (await res.json()) as { reply: string; navigate: string | null; audio: string | null };
      if (hide.current) clearTimeout(hide.current);
      setReply(turn.reply);
      const tab = turn.navigate ? tabForRoute(turn.navigate) : null;
      if (tab) navRef.current(tab);
      if (turn.audio) {
        const out = new File(Paths.cache, `nessie-${Date.now()}.wav`);
        out.write(turn.audio, { encoding: 'base64' });
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        stopPlayback();
        const p = createAudioPlayer({ uri: out.uri });
        player.current = p;
        setStatus('speaking');
        p.addListener('playbackStatusUpdate', (st) => {
          if (!st.didJustFinish) return;
          stopPlayback();
          if (statusRef.current === 'speaking') setStatus('ready');
          hide.current = setTimeout(() => setReply(''), REPLY_HIDE_MS);
        });
        p.play();
      } else {
        setStatus('ready');
        hide.current = setTimeout(() => setReply(''), REPLY_HIDE_MS + 4_000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Voice failed.');
      setStatus('ready');
      setTimeout(() => setError(null), 5_000);
    }
  }, [baseUrl, recorder]);

  const listen = useCallback(async () => {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { setError('Allow microphone access to talk to Nessie.'); setStatus('idle'); return; }
    stopPlayback();
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setStatus('listening');
    startedAt.current = Date.now();
    spokeAt.current = 0;
    quietSince.current = 0;
    // End the turn by itself once the user has spoken and then gone quiet.
    poll.current = setInterval(() => {
      const st = recorder.getStatus();
      const now = Date.now();
      const db = typeof st.metering === 'number' ? st.metering : -160;
      if (db > SPEECH_DB) { spokeAt.current = now; quietSince.current = 0; }
      else if (spokeAt.current && !quietSince.current) quietSince.current = now;
      if ((spokeAt.current && quietSince.current && now - quietSince.current > SILENCE_MS) || now - startedAt.current > MAX_LISTEN_MS)
        void send();
    }, 150);
  }, [recorder, send]);

  // No service key: /voice/turn authenticates with the user's own finance session.
  const toggle = useCallback(async () => {
    if (!baseUrl) { setError('Set EXPO_PUBLIC_VOICE_API_URL in app/.env.local and restart Expo.'); return; }
    const s = statusRef.current;
    if (s === 'listening') return send();
    if (s === 'thinking') return;
    setStatus('connecting');
    try {
      await listen();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the microphone.');
      setStatus('idle');
    }
  }, [baseUrl, listen, send]);

  const disconnect = useCallback(() => { stopPoll(); stopPlayback(); setStatus('idle'); }, []);

  return { status, error, needsKey, toggle, disconnect, reply };
}
