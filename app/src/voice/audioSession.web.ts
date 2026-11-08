// Browsers: no audio session to manage, but a browser does NOT play a remote LiveKit voice by itself.
// Each remote audio track must be attached to an <audio> element, or the assistant is silent.
import { RoomEvent, Track, type RemoteTrack, type Room } from 'livekit-client';
import { voiceLog, voiceWarn } from './voiceLog';

export const startAudioSession = async () => {};
export const stopAudioSession = async () => {};

export function attachRemoteAudio(room: Room): () => void {
  const onSubscribed = (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach() as HTMLAudioElement;
    el.style.display = 'none';
    el.autoplay = true;
    document.body.appendChild(el);
    voiceLog('assistant audio attached; playing it through the browser');
    void el.play().catch((e) => voiceWarn('browser blocked audio playback until you click the page:', e?.message ?? e));
  };
  const onUnsubscribed = (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove());
  };
  const onPlayback = () => voiceLog('browser audio playback allowed:', room.canPlaybackAudio);
  room.on(RoomEvent.TrackSubscribed, onSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
  room.on(RoomEvent.AudioPlaybackStatusChanged, onPlayback);
  return () => {
    room.off(RoomEvent.TrackSubscribed, onSubscribed);
    room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    room.off(RoomEvent.AudioPlaybackStatusChanged, onPlayback);
  };
}
