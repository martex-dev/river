import { create } from 'zustand';
import type { DmEvent } from '../../../shared/dm.ts';
import { play } from '../community/sound.ts';
import { useCommunity } from '../community/store.ts';
import { VoiceCall, type CallTransport } from '../community/voice.ts';
import { useRiver } from '../store.ts';
import { useDm } from './store.ts';

/**
 * 1:1 calls from a direct conversation. Media goes directly between the two
 * computers (WebRTC, DTLS-SRTP); call setup travels inside libsignal-encrypted
 * direct messages that the server relays but never stores.
 */
const RING_TIMEOUT_MS = 45_000;

interface DmCallState {
  incoming: { peer: string; callId: string; video: boolean } | null;
  active: {
    peer: string;
    callId: string;
    video: boolean;
    state: 'ringing' | 'connecting' | 'connected';
  } | null;
}

export const useDmCall = create<DmCallState>(() => ({ incoming: null, active: null }));

let ringTimer: number | undefined;
/** The current call, for the call history. */
let current: { peer: string; direction: 'in' | 'out'; video: boolean; connectedAt: number | null } | null =
  null;

function logCall(entry: {
  peer: string;
  direction: 'in' | 'out';
  video: boolean;
  connectedAt: number | null;
}): void {
  const durationSec = entry.connectedAt ? Math.round((Date.now() - entry.connectedAt) / 1000) : 0;
  void window.river.dm.action({
    a: 'logCall',
    peer: entry.peer,
    direction: entry.direction,
    video: entry.video,
    answered: entry.connectedAt !== null,
    durationSec,
  });
}
let timeoutTimer: number | undefined;

function stopRinging(): void {
  window.clearInterval(ringTimer);
  window.clearTimeout(timeoutTimer);
  ringTimer = undefined;
}

function ring(sound: 'ring' | 'ringback'): void {
  stopRinging();
  play(sound);
  ringTimer = window.setInterval(() => play(sound), sound === 'ring' ? 2200 : 3000);
}

function newCallId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function send(
  peer: string,
  callId: string,
  kind: 'invite' | 'accept' | 'decline' | 'end' | 'signal' | 'busy',
  extra: { video?: boolean; data?: unknown } = {},
): Promise<void> {
  return window.river.dm.action({ a: 'call', peer, callId, kind, ...extra }).then((r) => {
    if (!r.ok) throw new Error(r.message);
  });
}

function transport(peer: string, callId: string, role: 'caller' | 'callee', video: boolean): CallTransport {
  return {
    join: () => send(peer, callId, role === 'caller' ? 'invite' : 'accept', { video }),
    leave: () => send(peer, callId, 'end').catch(() => undefined),
    signal: (_to, data) => void send(peer, callId, 'signal', { data }).catch(() => undefined),
  };
}

async function begin(
  peer: string,
  callId: string,
  role: 'caller' | 'callee',
  video: boolean,
): Promise<boolean> {
  const me = useRiver.getState().identity?.riverId;
  if (!me) return false;
  await useCommunity.getState().call?.leave();
  const voice = useRiver.getState().settings?.voice;
  const iceServers = await window.river.voice.iceServers().catch(() => []);
  const community = useCommunity;
  let wasConnected = false;
  const call = new VoiceCall(
    `dm:${peer}`,
    me,
    () => {
      community.setState({ callVersion: community.getState().callVersion + 1 });
      const connected = call.remotes().some((r) => r.state === 'connected');
      const active = useDmCall.getState().active;
      if (connected && !wasConnected && active?.callId === callId) {
        wasConnected = true;
        if (current) current.connectedAt = Date.now();
        useDmCall.setState({ active: { ...active, state: 'connected' } });
      }
    },
    {
      iceServers,
      inputDeviceId: voice?.inputDeviceId ?? null,
      noiseSuppression: voice?.noiseSuppression ?? true,
      echoCancellation: voice?.echoCancellation ?? true,
      pushToTalk: voice?.inputMode === 'push-to-talk',
    },
    transport(peer, callId, role, video),
  );
  call.muted = community.getState().selfMuted;
  call.deafened = community.getState().selfDeafened;
  community.setState({ call, callError: null });
  useDmCall.setState({
    active: { peer, callId, video, state: role === 'caller' ? 'ringing' : 'connecting' },
  });
  current = { peer, direction: role === 'caller' ? 'out' : 'in', video, connectedAt: null };
  try {
    await call.start();
  } catch (err) {
    community.setState({ call: null });
    useDmCall.setState({ active: null });
    stopRinging();
    community
      .getState()
      .notify(
        (err as Error).name === 'NotAllowedError'
          ? 'River could not use your microphone. Allow microphone access in your system settings.'
          : (err as Error).message || 'The call could not start.',
        'error',
      );
    return false;
  }
  if (video) await call.setCamera(true).catch(() => undefined);
  if (role === 'callee') call.updateParticipants([me, peer]);
  return true;
}

export async function startDmCall(peer: string, video: boolean): Promise<void> {
  if (useDmCall.getState().active || useDmCall.getState().incoming) return;
  const callId = newCallId();
  ring('ringback');
  const ok = await begin(peer, callId, 'caller', video);
  if (!ok) return;
  timeoutTimer = window.setTimeout(() => {
    if (useDmCall.getState().active?.callId === callId && useDmCall.getState().active?.state === 'ringing') {
      useCommunity.getState().notify('No answer.');
      void endDmCall();
    }
  }, RING_TIMEOUT_MS);
}

export async function acceptDmCall(withVideo: boolean): Promise<void> {
  const incoming = useDmCall.getState().incoming;
  if (!incoming) return;
  stopRinging();
  useDmCall.setState({ incoming: null });
  useDm.getState().select(incoming.peer);
  useRiver.getState().navigate('messages');
  await begin(incoming.peer, incoming.callId, 'callee', withVideo);
}

export function declineDmCall(): void {
  const incoming = useDmCall.getState().incoming;
  if (!incoming) return;
  logCall({ peer: incoming.peer, direction: 'in', video: incoming.video, connectedAt: null });
  stopRinging();
  useDmCall.setState({ incoming: null });
  void send(incoming.peer, incoming.callId, 'decline').catch(() => undefined);
}

export async function endDmCall(): Promise<void> {
  stopRinging();
  if (current) logCall(current);
  current = null;
  const call = useCommunity.getState().call;
  useDmCall.setState({ active: null });
  if (call?.channelId.startsWith('dm:')) {
    useCommunity.setState({ call: null });
    play('selfLeave');
    await call.leave();
  }
}

export function handleCallEvent(e: Extract<DmEvent, { t: 'call' }>): void {
  const { active, incoming } = useDmCall.getState();
  const name = useDm.getState().conversations.find((c) => c.riverId === e.peer)?.name ?? 'They';
  switch (e.kind) {
    case 'invite': {
      if (active || incoming || useCommunity.getState().call) {
        void send(e.peer, e.callId, 'busy').catch(() => undefined);
        return;
      }
      useDmCall.setState({ incoming: { peer: e.peer, callId: e.callId, video: e.video } });
      ring('ring');
      timeoutTimer = window.setTimeout(() => {
        if (useDmCall.getState().incoming?.callId === e.callId) {
          stopRinging();
          useDmCall.setState({ incoming: null });
        }
      }, RING_TIMEOUT_MS);
      return;
    }
    case 'accept': {
      if (active?.callId !== e.callId || active.peer !== e.peer) return;
      stopRinging();
      useDmCall.setState({ active: { ...active, state: 'connecting' } });
      const me = useRiver.getState().identity?.riverId;
      const call = useCommunity.getState().call;
      if (me && call) call.updateParticipants([me, e.peer]);
      play('join');
      return;
    }
    case 'decline':
    case 'busy':
      if (active?.callId !== e.callId) return;
      useCommunity
        .getState()
        .notify(e.kind === 'busy' ? `${name} is in another call.` : `${name} declined the call.`);
      void endDmCall();
      return;
    case 'end':
      if (incoming?.callId === e.callId) {
        stopRinging();
        useDmCall.setState({ incoming: null });
        logCall({ peer: e.peer, direction: 'in', video: e.video, connectedAt: null });
        useCommunity.getState().notify(`Missed call from ${name}.`);
      } else if (active?.callId === e.callId) {
        void endDmCall();
      }
      return;
    case 'signal': {
      const call = useCommunity.getState().call;
      if (active?.callId === e.callId && call?.channelId === `dm:${e.peer}`)
        void call.handleSignal(e.peer, e.data);
      return;
    }
  }
}
