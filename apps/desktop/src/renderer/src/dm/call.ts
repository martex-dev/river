import { create } from 'zustand';
import type { DmEvent } from '../../../shared/dm.ts';
import type { PhoneCallAction } from '../../../shared/ipc.ts';
import { play } from '../community/sound.ts';
import { useCommunity } from '../community/store.ts';
import { VoiceCall, type CallTransport } from '../community/voice.ts';
import { resumeAudio } from '../community/peer-audio.ts';
import { WebCodecsRelay } from '../community/relay-audio.ts';
import { useRiver } from '../store.ts';
import { useDm } from './store.ts';

/**
 * 1:1 calls from a direct conversation. Media goes directly between the two
 * computers (WebRTC, DTLS-SRTP); call setup travels inside libsignal-encrypted
 * direct messages that the server relays but never stores.
 */
const RING_TIMEOUT_MS = 45_000;
/** An answered call that has not connected after this long ends (instead of "Connecting…" forever). */
export const CONNECT_TIMEOUT_MS = 30_000;

interface DmCallState {
  incoming: { peer: string; callId: string; video: boolean } | null;
  active: {
    peer: string;
    callId: string;
    video: boolean;
    state: 'ringing' | 'connecting' | 'connected';
    /** When the call first connected (ms), for the call timer. */
    connectedAt?: number;
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
let connectTimer: number | undefined;

/** Ends the call if it is still connecting after CONNECT_TIMEOUT_MS. */
function watchConnect(callId: string): void {
  window.clearTimeout(connectTimer);
  connectTimer = window.setTimeout(() => {
    const active = useDmCall.getState().active;
    if (active?.callId !== callId || active.state !== 'connecting') return;
    useCommunity.getState().notify('The call could not connect.', 'error');
    void endDmCall();
  }, CONNECT_TIMEOUT_MS);
}

function stopRinging(): void {
  window.clearInterval(ringTimer);
  window.clearTimeout(timeoutTimer);
  ringTimer = undefined;
}

/**
 * Android (2.11) rings for an incoming call with the phone's own ringtone and call screen while
 * River is not on screen: no second ring from here then. It rings here again once River is back.
 */
function phoneRingsInstead(): boolean {
  return useRiver.getState().info?.platform === 'android' && document.visibilityState === 'hidden';
}

function ring(sound: 'ring' | 'ringback'): void {
  stopRinging();
  const tick = (): void => {
    if (sound === 'ring' && phoneRingsInstead()) return;
    play(sound);
  };
  tick();
  ringTimer = window.setInterval(tick, sound === 'ring' ? 2200 : 3000);
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

/**
 * Sets up our side of a call. The call shows as active straight away (in the
 * same tick as the click), so a second click, a hang-up or the other side's
 * "end" during the microphone prompt all apply to it. After every wait, a call
 * that was ended meanwhile stops here: no invite or accept goes out, the
 * microphone is released, and the relay room is not reopened.
 */
async function begin(
  peer: string,
  callId: string,
  role: 'caller' | 'callee',
  video: boolean,
): Promise<boolean> {
  const me = useRiver.getState().identity?.riverId;
  if (!me) {
    stopRinging();
    return false;
  }
  // Still inside the click or tap: wake the audio engine now (phones only allow it from a gesture).
  resumeAudio();
  useDmCall.setState({
    active: { peer, callId, video, state: role === 'caller' ? 'ringing' : 'connecting' },
  });
  current = { peer, direction: role === 'caller' ? 'out' : 'in', video, connectedAt: null };
  const live = (): boolean => useDmCall.getState().active?.callId === callId;
  const community = useCommunity;
  const previous = community.getState().call;
  if (previous && !previous.channelId.startsWith('dm:')) {
    // Leaving voice for a call is leaving on purpose: no "Rejoin" offer for it later.
    await community.getState().leaveVoice();
  } else if (previous) {
    community.setState({ call: null });
    await previous.leave();
  }
  if (!live()) return false;
  const voice = useRiver.getState().settings?.voice;
  const iceServers = await window.river.voice.iceServers().catch(() => []);
  if (!live()) return false;
  let wasConnected = false;
  const call = new VoiceCall(
    `dm:${peer}`,
    me,
    () => {
      community.setState({ callVersion: community.getState().callVersion + 1 });
      const connected = call.remotes().some((r) => r.state === 'connected' || r.relayed);
      const active = useDmCall.getState().active;
      if (connected && !wasConnected && active?.callId === callId) {
        wasConnected = true;
        window.clearTimeout(connectTimer);
        play('callConnected');
        const now = Date.now();
        if (current) current.connectedAt = now;
        useDmCall.setState({ active: { ...active, state: 'connected', connectedAt: now } });
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
    // If the two cannot connect directly, voice goes through the server, encrypted end to end.
    new WebCodecsRelay(me, (to, payload) => window.river.voice.relay(to, payload)),
  );
  call.nameOf = (id) => useDm.getState().conversations.find((x) => x.riverId === id)?.name ?? 'Someone';
  call.muted = community.getState().selfMuted;
  call.deafened = community.getState().selfDeafened;
  community.setState({ call, callError: null });
  try {
    await call.start();
  } catch (err) {
    // Hung up meanwhile: endDmCall already cleaned up.
    if (!live()) return false;
    if (community.getState().call === call) community.setState({ call: null });
    useDmCall.setState({ active: null });
    stopRinging();
    if (role === 'callee') {
      // We answered but cannot take part (microphone refused): tell the caller and keep a record.
      void send(peer, callId, 'decline').catch(() => undefined);
      if (current) logCall(current);
    }
    current = null;
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
  // Hung up while the microphone or the invite was pending: start() did not join.
  if (!live() || call.closed) {
    if (!call.closed) void call.leave();
    return false;
  }
  void callRoomOf(callId).then((room) => {
    if (live()) void window.river.voice.callRoom(room);
  });
  if (video) await call.setCamera(true).catch(() => undefined);
  if (!live()) return false;
  if (role === 'callee') call.updateParticipants([me, peer]);
  return true;
}

/** The private relay room for a call: a hash of its secret ID, so the server never learns the ID. */
async function callRoomOf(callId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`river-call-room:${callId}`));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function startDmCall(peer: string, video: boolean): Promise<void> {
  // begin() marks the call active before its first wait, so a double click starts one call.
  if (useDmCall.getState().active || useDmCall.getState().incoming) return;
  if (!useRiver.getState().identity?.riverId) return;
  const callId = newCallId();
  ring('ringback');
  const ok = await begin(peer, callId, 'caller', video);
  if (!ok) {
    if (useDmCall.getState().active === null) stopRinging();
    return;
  }
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
  // begin() makes this call active in this same tick, so an "end" from the caller is never lost.
  useDmCall.setState({ incoming: null });
  const started = begin(incoming.peer, incoming.callId, 'callee', withVideo);
  useDm.getState().select(incoming.peer);
  useRiver.getState().navigate('messages');
  if (await started) watchConnect(incoming.callId);
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
  window.clearTimeout(connectTimer);
  if (current) logCall(current);
  current = null;
  const call = useCommunity.getState().call;
  useDmCall.setState({ active: null });
  if (call?.channelId.startsWith('dm:')) {
    void window.river.voice.callRoom(null);
    useCommunity.setState({ call: null });
    play('callEnded');
    await call.leave();
  }
}

/** A call answered on Android's call screen before this window knew it was ringing. */
let answerWanted: { callId: string; at: number } | null = null;

/**
 * Android (2.11): the phone's own call screen answered or declined a call. Answered: River's
 * window opened for it and answers it here (the full-screen call shows). Declined: the core
 * already told the caller and kept the record; it just stops ringing here.
 */
export function handlePhoneCall(e: PhoneCallAction): void {
  const incoming = useDmCall.getState().incoming;
  if (e.action === 'decline') {
    if (incoming?.callId !== e.callId) return;
    stopRinging();
    useDmCall.setState({ incoming: null });
    return;
  }
  if (incoming?.callId === e.callId) {
    answerWanted = null;
    void acceptDmCall(incoming.video);
  } else if (!useDmCall.getState().active) {
    answerWanted = { callId: e.callId, at: Date.now() };
  }
}

export function handleCallEvent(e: Extract<DmEvent, { t: 'call' }>): void {
  const { active, incoming } = useDmCall.getState();
  const name = useDm.getState().conversations.find((c) => c.riverId === e.peer)?.name ?? 'They';
  switch (e.kind) {
    case 'invite': {
      // The same call again (River's window found it ringing as it opened): nothing new.
      if (active?.callId === e.callId || incoming?.callId === e.callId) return;
      // Only another 1:1 call makes you busy; in a voice channel the call rings, and accepting leaves voice.
      if (active || incoming) {
        void send(e.peer, e.callId, 'busy').catch(() => undefined);
        return;
      }
      const ringing = { peer: e.peer, callId: e.callId, video: e.video };
      useDmCall.setState({ incoming: ringing });
      if (answerWanted?.callId === e.callId && Date.now() - answerWanted.at < RING_TIMEOUT_MS) {
        // Answered on the phone's call screen already: no ringing here, straight into the call.
        answerWanted = null;
        void acceptDmCall(e.video);
        return;
      }
      ring('ring');
      timeoutTimer = window.setTimeout(() => {
        // Nobody answered here. The caller's own timeout ends later, and its "end" then finds no
        // ringing call, so the missed call is recorded now.
        if (useDmCall.getState().incoming?.callId === e.callId) {
          stopRinging();
          useDmCall.setState({ incoming: null });
          logCall({ peer: ringing.peer, direction: 'in', video: ringing.video, connectedAt: null });
          useCommunity.getState().notify(`Missed call from ${name}.`);
        }
      }, RING_TIMEOUT_MS);
      return;
    }
    case 'accept': {
      if (active?.callId !== e.callId || active.peer !== e.peer) return;
      stopRinging();
      useDmCall.setState({ active: { ...active, state: 'connecting' } });
      watchConnect(e.callId);
      const me = useRiver.getState().identity?.riverId;
      const call = useCommunity.getState().call;
      if (me && call) call.updateParticipants([me, e.peer]);
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
        // "end" carries no video flag: the invite said whether it was a video call.
        logCall({ peer: e.peer, direction: 'in', video: incoming.video, connectedAt: null });
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
