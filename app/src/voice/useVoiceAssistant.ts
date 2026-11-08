// Voice assistant over LiveKit, controlled by tapping Nessie. Server: services/calls (Calls.md, "In-app voice").
//
//   toggle()  idle      -> connects, then starts listening
//             listening -> sends what you said (the assistant answers)
//             otherwise -> starts a new turn (this also interrupts the assistant if it is speaking)
//   the agent calls our `navigate` RPC to open a tab; we publish `page`/`visible` attributes whenever
//   the visible tab changes so it knows what the user is looking at.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ParticipantKind, Room, RoomEvent, RpcError, Track, type Participant, type RpcInvocationData } from 'livekit-client';
import { attachRemoteAudio, startAudioSession, stopAudioSession } from './audioSession';
import { voiceLog, voiceWarn } from './voiceLog';
import {
  applyReplyChunk, fetchVoiceSession, nextAction, parseNavigatePayload, screenAttributes, REPLY_TOPIC, type Reply, type VoiceStatus,
} from './voiceSession';

type Options = {
  baseUrl: string;
  userId: string;
  /** Voice service key. Returns '' when the user still has to type it in. */
  getKey: () => string;
  /** Tab the user is on now (null before the navigator is ready). */
  currentTab: string | null;
  currentFacts?: readonly string[];
  /** Called when the agent asks to open a tab; only ever one of the four known tab names. */
  onNavigate: (tab: string) => void;
};

const AGENT_WAIT_MS = 20_000;
const RPC_TIMEOUT_MS = 8_000;
const MAX_LISTEN_MS = 30_000; // never leave the microphone open longer than this
const MAX_THINK_MS = 25_000;  // if no answer starts by then, go back to ready

export function useVoiceAssistant({ baseUrl, userId, getKey, currentTab, currentFacts, onNavigate }: Options) {
  const roomRef = useRef<Room | null>(null);
  const detachAudio = useRef<(() => void) | null>(null);
  const statusRef = useRef<VoiceStatus>('idle');
  const navigateRef = useRef(onNavigate);
  const screenRef = useRef({ currentTab, currentFacts });
  useLayoutEffect(() => {
    navigateRef.current = onNavigate;
    screenRef.current = { currentTab, currentFacts };
  }, [onNavigate, currentTab, currentFacts]);
  const listenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const replyRef = useRef<Reply | null>(null);
  const replyHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatusState] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);

  const setStatus = useCallback((next: VoiceStatus) => {
    if (statusRef.current !== next) voiceLog('status:', statusRef.current, '->', next);
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const clearTimers = () => {
    if (listenTimer.current) clearTimeout(listenTimer.current);
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (speakEndTimer.current) clearTimeout(speakEndTimer.current);
    listenTimer.current = thinkTimer.current = speakEndTimer.current = null;
  };

  const agentOf = (room: Room) => [...room.remoteParticipants.values()].find((p) => p.kind === ParticipantKind.AGENT);

  const publishScreen = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const { currentTab: tab, currentFacts: facts } = screenRef.current;
    const attrs = tab ? screenAttributes(tab, undefined, facts) : {};
    await room.localParticipant.setAttributes({
      page: attrs.page ?? '', visible: attrs.visible ?? '', facts: attrs.facts ?? '',
    });
  }, []);

  const rpc = useCallback(async (method: 'start_turn' | 'end_turn' | 'cancel_turn') => {
    const room = roomRef.current;
    const agent = room ? agentOf(room) : undefined;
    if (!room || !agent) throw new Error('The assistant is not connected.');
    voiceLog('rpc ->', method);
    return room.localParticipant.performRpc({
      destinationIdentity: agent.identity, method, payload: '', responseTimeout: RPC_TIMEOUT_MS,
    });
  }, []);

  const setMicMuted = useCallback(async (muted: boolean) => {
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (pub) await (muted ? pub.mute() : pub.unmute());
  }, []);

  const disconnect = useCallback(async () => {
    clearTimers();
    const room = roomRef.current;
    roomRef.current = null;
    detachAudio.current?.();
    detachAudio.current = null;
    setStatus('idle');
    await room?.disconnect();
    await stopAudioSession();
  }, [setStatus]);

  const endTurn = useCallback(async () => {
    clearTimers();
    try {
      await setMicMuted(true);
      setStatus('thinking');
      thinkTimer.current = setTimeout(() => {
        if (statusRef.current === 'thinking') setStatus('ready');
      }, MAX_THINK_MS);
      await publishScreen().catch(() => {});
      await rpc('end_turn');
    } catch (e) {
      voiceWarn('end turn failed:', e instanceof Error ? e.message : e);
      setError(e instanceof Error ? e.message : 'Could not send what you said.');
      setStatus('ready');
    }
  }, [publishScreen, rpc, setMicMuted, setStatus]);

  const startTurn = useCallback(async () => {
    clearTimers();
    setError(null);
    try {
      await publishScreen().catch(() => {});
      // The agent shows up in the room slightly before its turn handlers are registered; retry briefly.
      for (let attempt = 0; ; attempt++) {
        try {
          await rpc('start_turn'); // also interrupts the assistant if it is speaking
          replyRef.current = null; setReply(null);
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : '';
          if (attempt >= 12 || !/not supported at destination/i.test(msg)) throw e;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      await setMicMuted(false);
      setStatus('listening');
      listenTimer.current = setTimeout(() => { void endTurn(); }, MAX_LISTEN_MS);
    } catch (e) {
      voiceWarn('start turn failed:', e instanceof Error ? e.message : e);
      setError(e instanceof Error ? e.message : 'Could not start listening.');
      setStatus('ready');
    }
  }, [publishScreen, rpc, setMicMuted, setStatus, endTurn]);

  const connect = useCallback(async (apiKey: string): Promise<boolean> => {
    if (roomRef.current) return true;
    setError(null);
    setStatus('connecting');
    try {
      const session = await fetchVoiceSession({ baseUrl, apiKey, userId });
      await startAudioSession();
      voiceLog('session ok, room', session.room);
      const room = new Room();
      roomRef.current = room;
      detachAudio.current = attachRemoteAudio(room); // browsers need this to play the assistant's voice
      // The agent asks us to open a tab. Anything that is not one of the four tabs is refused.
      room.registerRpcMethod('navigate', async (data: RpcInvocationData) => {
        const tab = parseNavigatePayload(data.payload);
        voiceLog('agent asked to open:', data.payload, '->', tab ?? 'refused');
        if (!tab) throw new RpcError(1404, 'unknown screen');
        navigateRef.current(tab);
        return 'ok';
      });
      // The agent heard you stop talking and ended the turn itself: close the mic and wait for the answer.
      room.registerRpcMethod('turn_ended', async () => {
        if (statusRef.current !== 'listening') return 'ignored';
        voiceLog('agent ended the turn (silence)');
        clearTimers();
        await setMicMuted(true);
        setStatus('thinking');
        thinkTimer.current = setTimeout(() => {
          if (statusRef.current === 'thinking') setStatus('ready');
        }, MAX_THINK_MS);
        return 'ok';
      });
      // Nessie stays up while the assistant is speaking, and dives when it finishes.
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const speaking = speakers.some((p) => p.kind === ParticipantKind.AGENT);
        const now = statusRef.current;
        voiceLog('assistant speaking:', speaking);
        if (speaking && (now === 'thinking' || now === 'ready' || now === 'speaking')) {
          if (thinkTimer.current) clearTimeout(thinkTimer.current);
          if (speakEndTimer.current) { clearTimeout(speakEndTimer.current); speakEndTimer.current = null; }
          setStatus('speaking');
        } else if (!speaking && now === 'speaking') {
          // Speech detection drops out between words and sentences: stay up unless it stays quiet.
          if (speakEndTimer.current) clearTimeout(speakEndTimer.current);
          speakEndTimer.current = setTimeout(() => {
            speakEndTimer.current = null;
            if (statusRef.current === 'speaking') setStatus('ready');
            if (replyHideTimer.current) clearTimeout(replyHideTimer.current);
            replyHideTimer.current = setTimeout(() => { replyRef.current = null; setReply(null); }, 4000);
          }, 1200);
        }
      });
      // Her spoken words arrive as a text stream; show them in a speech bubble while she talks.
      room.registerTextStreamHandler(REPLY_TOPIC, async (reader, participantInfo) => {
        if (room.remoteParticipants.get(participantInfo.identity)?.kind !== ParticipantKind.AGENT) return;
        const segment = reader.info.attributes?.['lk.segment_id'] ?? reader.info.id;
        if (replyHideTimer.current) { clearTimeout(replyHideTimer.current); replyHideTimer.current = null; }
        try {
          for await (const chunk of reader) {
            replyRef.current = applyReplyChunk(replyRef.current, segment, chunk);
            setReply(replyRef.current);
          }
        } catch (e) {
          voiceWarn('reply stream failed:', e instanceof Error ? e.message : e);
        }
      });
      // The agent ends an idle session on its own; drop the dead room so the next tap starts a fresh one.
      room.on(RoomEvent.ParticipantDisconnected, (p: Participant) => {
        if (p.kind === ParticipantKind.AGENT && roomRef.current === room) {
          voiceLog('assistant left the room');
          void disconnect();
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) {
          roomRef.current = null;
          clearTimers();
          setStatus('idle');
        }
      });
      await room.connect(session.url, session.token);
      voiceLog('connected to LiveKit');
      await room.startAudio().catch(() => {}); // browsers only play sound after a user gesture; the tap was one
      await room.localParticipant.setMicrophoneEnabled(true);
      await setMicMuted(true); // muted between turns: the agent only hears you while Nessie is listening
      await waitForAgent(room);
      voiceLog('assistant joined the room');
      setStatus('ready');
      return true;
    } catch (e) {
      voiceWarn('connect failed:', e instanceof Error ? e.message : e);
      await disconnect();
      setError(e instanceof Error ? e.message : 'Could not start the assistant.');
      setStatus('error');
      return false;
    }
  }, [baseUrl, userId, disconnect, setMicMuted, setStatus]);

  /** One tap on Nessie. `typedKey` is only used the first time, when no key is configured. */
  const toggle = useCallback(async (typedKey?: string) => {
    const action = nextAction(statusRef.current);
    if (action === 'connect') {
      const key = (typedKey ?? getKey()).trim();
      if (!key) { setNeedsKey(true); return; }
      setNeedsKey(false);
      if (await connect(key)) await startTurn();
    } else if (action === 'start') {
      await startTurn();
    } else if (action === 'end') {
      await endTurn();
    }
  }, [getKey, connect, startTurn, endTurn]);

  // Tell the agent which screen is showing, now and whenever the tab changes.
  useEffect(() => {
    const live = status === 'ready' || status === 'listening' || status === 'thinking' || status === 'speaking';
    if (live) void publishScreen().catch(() => {});
  }, [status, currentTab, currentFacts, publishScreen]);

  useEffect(() => () => { void disconnect(); }, [disconnect]);

  return { status, error, needsKey, toggle, disconnect, reply: reply?.text ?? '' };
}

function waitForAgent(room: Room): Promise<void> {
  return new Promise((resolve, reject) => {
    const present = () => [...room.remoteParticipants.values()].some((p) => p.kind === ParticipantKind.AGENT);
    if (present()) return resolve();
    const timer = setTimeout(() => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      reject(new Error('The assistant did not join. Is the voice service running?'));
    }, AGENT_WAIT_MS);
    const onJoin = () => {
      if (!present()) return;
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      resolve();
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
  });
}
