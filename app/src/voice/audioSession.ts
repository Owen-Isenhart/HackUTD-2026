// Native (iOS/Android): LiveKit manages the phone's audio session (speaker, microphone routing) and
// plays remote audio by itself, so there is nothing to attach.
import { AudioSession } from '@livekit/react-native';

export const startAudioSession = () => AudioSession.startAudioSession();
export const stopAudioSession = () => AudioSession.stopAudioSession();
export const attachRemoteAudio = (_room: unknown): (() => void) => () => {};
