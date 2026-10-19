import { tr } from '../i18n.ts';
import type { CallOutcome, DmEvent } from '../../../shared/dm.ts';
import type { PhoneCallAction } from '../../../shared/ipc.ts';
import { play } from '../community/sound.ts';
import { useCommunity } from '../community/store.ts';
import { VoiceCall, type CallTransport } from '../community/voice.ts';
import { resumeAudio } from '../community/peer-audio.ts';
import { WebCodecsRelay } from '../community/relay-audio.ts';
import { useRiver } from '../store.ts';
import {
  callRoomOf,
  isPrivateCall,
  newCallId,
  resetPhoneAudio,
  ringTone,
  stopRingTone,
  useDmCall,
} from './call-common.ts';
import {
  acceptGroupRing,
  declineGroupRing,
  handleGroupRing,
  leaveGroupCall,
  useGroupCall,
} from './group-call.ts';
import { useDm } from './store.ts';

export { useDmCall } from './call-common.ts';

/**
 * 1:1 calls from a direct conversation. Media goes directly between the two
 * computers (WebRTC, DTLS-SRTP); call setup travels inside libsignal-encrypted
 * direct messages that the server relays but never stores.
 */
const RING_TIMEOUT_MS = 45_000;
/** An answered call that has not connected after this long ends (instead of "Connecting…" forever). */
export const CONNECT_TIMEOUT_MS = 30_000;
/**
 * A connected call that has heard nothing from the other side for this long — no direct
 * connection, no voice through the server — is over: they are gone (2.11.3).
 */
export const CALL_LOST_MS = 50_000;
/** How often a connected call checks that the other side is still there. */
const LOST_CHECK_MS = 5000;

/** The current call, for the call history. */
let current: {
  peer: string;
  callId: string;
  direction: 'in' | 'out';
  video: boolean;
  connectedAt: number | null;
} | null = null;

function logCall(
  entry: {
    peer: string;
    callId: string;
    direction: 'in' | 'out';
    video: boolean;
    connectedAt: number | null;
  },
  outcome?: Exclude<CallOutcome, 'answered' | 'missed'>,
): void {
  const durationSec = entry.connectedAt ? Math.round((Date.now() - entry.connectedAt) / 1000) : 0;
  const answered = entry.connectedAt !== null;
  void window.river.dm.action({
    a: 'logCall',
    peer: entry.peer,
    direction: entry.direction,
    video: entry.video,
    answered,
    durationSec,
    callId: entry.callId,
    ...(outcome && !answered ? { outcome } : {}),
  });
}
let timeoutTimer: number | undefined;
let connectTimer: number | undefined;
let lostTimer: number | undefined;

/** Ends the call if it is still connecting after CONNECT_TIMEOUT_MS. */
function watchConnect(callId: string): void {
  window.clearTimeout(connectTimer);
  connectTimer = window.setTimeout(() => {
    const active = useDmCall.getState().active;
    if (active?.callId !== callId || active.state !== 'connecting') return;
    useCommunity.getState().notify(tr('The call could not connect.'), 'error');
    void endDmCall();
  }, CONNECT_TIMEOUT_MS);
}

/**
 * A connected call whose other side vanished (their phone died, they lost the network, River
 * was closed without hanging up) ends after CALL_LOST_MS without a sound of them, rather than
 * showing "Connected" forever.
 */
function watchLost(callId: string, call: VoiceCall, peer: string): void {
  window.clearInterval(lostTimer);
  let heard = Date.now();
  lostTimer = window.setInterval(() => {
    if (useDmCall.getState().active?.callId !== callId || useCommunity.getState().call !== call) {
      window.clearInterval(lostTimer);
      return;
    }
    heard = Math.max(heard, call.lastHeard(peer));
    if (Date.now() - heard < CALL_LOST_MS) return;
    window.clearInterval(lostTimer);
    useCommunity.getState().notify(tr('The call was lost.'), 'error');
    void endDmCall();
  }, LOST_CHECK_MS);
}

function stopRinging(): void {
  stopRingTone();
  window.clearTimeout(timeoutTimer);
}

function ring(sound: 'ring' | 'ringback'): void {
  stopRinging();
  ringTone(sound);
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
  current = { peer, callId, direction: role === 'caller' ? 'out' : 'in', video, connectedAt: null };
  const live = (): boolean => useDmCall.getState().active?.callId === callId;
  const community = useCommunity;
  const previous = community.getState().call;
  if (useGroupCall.getState().active) {
    // One call at a time: a group call is left for this one (2.18).
    await leaveGroupCall();
  } else if (previous && !isPrivateCall(previous.channelId)) {
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
      // Connected only once sound can really flow: a direct connection that is up, or their voice
      // arriving through the server (the relay merely being on proves nothing).
      const connected = call.remotes().some((r) => r.state === 'connected' || (r.relayed && r.relayFlowing));
      const active = useDmCall.getState().active;
      if (connected && !wasConnected && active?.callId === callId) {
        wasConnected = true;
        window.clearTimeout(connectTimer);
        play('callConnected');
        const now = Date.now();
        if (current?.callId === callId) current.connectedAt = now;
        useDmCall.setState({ active: { ...active, state: 'connected', connectedAt: now } });
        watchLost(callId, call, peer);
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
  call.nameOf = (id) => useDm.getState().conversations.find((x) => x.riverId === id)?.name ?? tr('Someone');
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
    resetPhoneAudio();
    if (role === 'callee') {
      // We answered but cannot take part (microphone refused): the caller hears the call ended
      // (not "declined": nobody said no), and the history says it could not connect.
      void send(peer, callId, 'end').catch(() => undefined);
      if (current) logCall(current, 'failed');
    }
    current = null;
    community
      .getState()
      .notify(
        (err as Error).name === 'NotAllowedError'
          ? tr('River could not use your microphone. Allow microphone access in your system settings.')
          : (err as Error).message || tr('The call could not start.'),
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
  if (video) {
    // The camera refused (in use, no permission): the call goes on as a voice call, and says so.
    await call.setCamera(true).catch(() => {
      if (live())
        community
          .getState()
          .notify(tr('River could not start your camera, so this call is voice only for now.'), 'error');
    });
  }
  if (!live()) return false;
  if (role === 'callee') call.updateParticipants([me, peer]);
  return true;
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
  // Their call may have won a glare meanwhile (both called at once): that one rings no more here.
  if (useDmCall.getState().active?.callId !== callId) return;
  timeoutTimer = window.setTimeout(() => {
    if (useDmCall.getState().active?.callId === callId && useDmCall.getState().active?.state === 'ringing') {
      useCommunity.getState().notify(tr('No answer.'));
      void endDmCall();
    }
  }, RING_TIMEOUT_MS);
}

export async function acceptDmCall(withVideo: boolean): Promise<void> {
  const incoming = useDmCall.getState().incoming;
  if (!incoming) return;
  // A group call ringing (2.18): joining it is group-call.ts's.
  if (incoming.group) return acceptGroupRing(withVideo);
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
  if (incoming.group) {
    declineGroupRing();
    return;
  }
  void window.river.dm.action({
    a: 'logCall',
    peer: incoming.peer,
    direction: 'in',
    video: incoming.video,
    answered: false,
    durationSec: 0,
    outcome: 'declined',
    callId: incoming.callId,
  });
  stopRinging();
  useDmCall.setState({ incoming: null });
  void send(incoming.peer, incoming.callId, 'decline').catch(() => undefined);
}

/**
 * Ends the 1:1 call (hung up, declined or busy on the other side, lost, timed out). `outcome`
 * says why a call that never connected ended, for the call history.
 */
export async function endDmCall(outcome?: 'declined' | 'busy'): Promise<void> {
  stopRinging();
  window.clearTimeout(connectTimer);
  window.clearInterval(lostTimer);
  const hadCall = current !== null || useDmCall.getState().active !== null;
  if (current) logCall(current, outcome);
  current = null;
  const call = useCommunity.getState().call;
  useDmCall.setState({ active: null });
  if (hadCall) resetPhoneAudio();
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
    // Measured from the answer: River's window may take a while to open from a locked phone.
    answerWanted = { callId: e.callId, at: Date.now() };
  }
}

export function handleCallEvent(e: Extract<DmEvent, { t: 'call' }>): void {
  const { active, incoming } = useDmCall.getState();
  const name = useDm.getState().conversations.find((c) => c.riverId === e.peer)?.name ?? tr('They');
  /** Our own call to this person, still ringing on their side. */
  const calling =
    active?.callId === e.callId &&
    active.peer === e.peer &&
    active.state === 'ringing' &&
    current?.callId === e.callId &&
    current.direction === 'out';
  switch (e.kind) {
    case 'invite': {
      // The same call again (River's window found it ringing as it opened): nothing new.
      if (active?.callId === e.callId || incoming?.callId === e.callId) return;
      // A group call ringing (2.18), perhaps answered on the phone's call screen already.
      if (e.group) {
        const answered = answerWanted?.callId === e.callId && Date.now() - answerWanted.at < RING_TIMEOUT_MS;
        if (answered) answerWanted = null;
        handleGroupRing(e, answered);
        return;
      }
      // Both called each other at once (glare): the call with the lower ID goes on, on both sides.
      if (
        active &&
        active.peer === e.peer &&
        active.state === 'ringing' &&
        current?.direction === 'out' &&
        !incoming
      ) {
        // Ours wins: they answer ours; theirs is ignored here.
        if (active.callId < e.callId) return;
        // Theirs wins: ours goes quietly (no "call ended", no record of it), theirs is answered.
        stopRinging();
        current = null;
        useDmCall.setState({ active: null, incoming: { peer: e.peer, callId: e.callId, video: e.video } });
        void acceptDmCall(active.video);
        return;
      }
      // Only another 1:1 call (or a group call, 2.18) makes you busy; in a voice channel the call
      // rings, and accepting leaves voice.
      if (active || incoming || useGroupCall.getState().active) {
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
          logCall({ ...ringing, direction: 'in', connectedAt: null });
          useCommunity.getState().notify(tr('Missed call from {name}.', { name }));
        }
      }, RING_TIMEOUT_MS);
      return;
    }
    case 'accept': {
      // Only while our call rings: after one of their devices answered, another device's answer
      // (or a late one from the mailbox) changes nothing.
      if (!calling || !active) return;
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
      // Only while our call rings: one of their devices declining after another answered does
      // not end the call that is on.
      if (!calling) return;
      useCommunity
        .getState()
        .notify(
          e.kind === 'busy'
            ? tr('{name} is in another call.', { name })
            : tr('{name} declined the call.', { name }),
        );
      void endDmCall(e.kind === 'busy' ? 'busy' : 'declined');
      return;
    case 'elsewhere':
      // Answered or declined on another of your devices: quiet here, nothing missed.
      if (incoming?.callId === e.callId) {
        stopRinging();
        useDmCall.setState({ incoming: null });
      }
      return;
    case 'end':
      if (incoming?.callId === e.callId) {
        stopRinging();
        useDmCall.setState({ incoming: null });
        // "end" carries no video flag: the invite said whether it was a video call.
        logCall({ ...incoming, direction: 'in', connectedAt: null });
        useCommunity.getState().notify(tr('Missed call from {name}.', { name }));
      } else if (active?.callId === e.callId && active.peer === e.peer) {
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
