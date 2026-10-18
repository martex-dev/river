import { create } from 'zustand';
import type { CallLinkView, DmEvent } from '../../../shared/dm.ts';
import { parseCallLink } from '../../../shared/invite-link.ts';
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
import { useDm } from './store.ts';

/**
 * Group calls (2.18): voice and video calls in a group conversation, and calls through a call
 * link. The media engine is the one community voice channels use (community/voice.ts): a
 * WebRTC mesh up to eight people (DTLS-SRTP between each pair), and above that everyone's voice
 * through the server, sealed end to end with per-call sender keys (relay-audio.ts).
 *
 * - The call's ID is a random secret that travels only inside end-to-end encrypted messages (the
 *   ring, or a call link's "you're in"). Its relay room on the server is a hash of it: the server
 *   learns who is in the call together and tells the people in it (and members watching it from
 *   the group) who is in it — it never learns the ID, a key, or any sound or picture.
 * - Connection setup between two people goes inside libsignal messages (main checks everyone
 *   against the group or the people a call link's host let in), and who the server says is in
 *   the call is checked against the same people here: the server can't add anyone to a call.
 * - The call goes on while anyone is in it. People leave and rejoin from the group's "Join"
 *   bar; when the last one leaves, the call is over.
 */

/** A ring rings this long here. */
export const GROUP_RING_MS = 45_000;
/** You started a call and nobody else came this long: it ends. */
export const NOBODY_CAME_MS = 60_000;
/** Everyone else left and you stayed alone this long: the call ends for you too. */
export const ALONE_MS = 2 * 60_000;
/** Asking to join through a call link gives up after this long without an answer. */
export const KNOCK_WAIT_MS = 2 * 60_000;
/** An empty room this long after the ring (the caller already left): the call is over. */
const EMPTY_GRACE_MS = 5000;
/** Calls kept in mind at once (each is a room the server is asked about). */
const KNOWN_MAX = 16;
const WATCHDOG_MS = 5000;

export interface KnownGroupCall {
  callId: string;
  /** The group; null for a call-link call. */
  groupId: string | null;
  /** A call-link call: its host. */
  host: string | null;
  title: string | null;
  video: boolean;
  /** Who started it (or rang you). */
  from: string | null;
  at: number;
  /** The server said someone is in it (so an empty room after that means it is over). */
  seen: boolean;
}

export interface ActiveGroupCall {
  callId: string;
  groupId: string | null;
  host: string | null;
  title: string | null;
  video: boolean;
  /** `waiting`: nobody else is connected (yet, or any more). */
  state: 'waiting' | 'connected';
  /** You started it, or host its link: an outgoing call in the history. */
  outgoing: boolean;
  joinedAt: number;
  /** When someone else was first connected with you (the call timer). */
  connectedAt?: number;
  /** Most people in it at once, you included. */
  peak: number;
}

export interface Knock {
  link: string;
  from: string;
  name: string;
  contact: boolean;
  at: number;
}

export interface Asking {
  host: string;
  link: string;
  state: 'confirm' | 'asking' | 'denied' | 'gone' | 'unanswered';
}

interface GroupCallState {
  /** Calls this device heard of (rings, call links you were let into, calls you started), by ID. */
  known: Record<string, KnownGroupCall>;
  /** Who is in each call's room (from the server, checked against who may be in it), by call ID. */
  rosters: Record<string, string[]>;
  /** Call-link calls: who may be in them, from their host. */
  allowed: Record<string, string[]>;
  active: ActiveGroupCall | null;
  /** Host: people asking to join one of your call links. */
  knocks: Knock[];
  /** You opened a call link and ask (or are about to ask) to join. */
  asking: Asking | null;
  /** A call link you just made, shown so you can share it. */
  madeLink: CallLinkView | null;
}

export const useGroupCall = create<GroupCallState>(() => ({
  known: {},
  rosters: {},
  allowed: {},
  active: null,
  knocks: [],
  asking: null,
  madeLink: null,
}));

/** Rooms of known calls: room → call ID. */
const rooms = new Map<string, string>();
let ringTimer: number | undefined;
let watchdog: number | undefined;
let knockTimer: number | undefined;
let aloneSince: number | null = null;

const me = (): string => useRiver.getState().identity?.riverId ?? '';
const notify = (text: string, tone: 'info' | 'error' = 'info'): void =>
  useCommunity.getState().notify(text, tone);

function groupOf(groupId: string | null) {
  return groupId ? useDm.getState().conversations.find((c) => c.riverId === groupId) : undefined;
}

/** A person's name as this device knows them (the group's records, contacts). */
export function personName(id: string, groupId: string | null): string {
  if (id === me()) return useRiver.getState().identity?.displayName ?? 'You';
  const fromGroup = groupOf(groupId)?.members.find((m) => m.riverId === id)?.name;
  if (fromGroup) return fromGroup;
  const contact = useDm.getState().conversations.find((c) => c.kind === 'direct' && c.riverId === id)?.name;
  return contact ?? `River ${id.slice(0, 8)}`;
}

/** What a call is called: its group's name, or a call link's title (or its host). */
export function callName(c: { groupId: string | null; host: string | null; title: string | null }): string {
  if (c.groupId) return groupOf(c.groupId)?.name ?? 'Group call';
  if (c.title) return c.title;
  return c.host && c.host !== me() ? `${personName(c.host, null)}'s call` : 'Your call link';
}

/** Who may be in a call: the group's current members, or the people its link's host let in. */
export function mayBeIn(callId: string, id: string): boolean {
  if (id === me()) return true;
  const s = useGroupCall.getState();
  const call = s.known[callId] ?? (s.active?.callId === callId ? s.active : undefined);
  if (!call) return false;
  if (call.groupId) {
    const group = groupOf(call.groupId);
    return !!group && group.state !== 'left' && group.members.some((m) => m.riverId === id);
  }
  return id === call.host || (s.allowed[callId] ?? []).includes(id);
}

/** Who is in a call now, by the server, as far as they may be in it. */
export function inCall(callId: string): string[] {
  return (useGroupCall.getState().rosters[callId] ?? []).filter((id) => mayBeIn(callId, id));
}

let watchQueued = false;
/** Asks the server about the rooms of every known call (who is in them). */
function watch(): void {
  if (watchQueued) return;
  watchQueued = true;
  queueMicrotask(() => {
    watchQueued = false;
    const ids = new Set(Object.keys(useGroupCall.getState().known));
    const list = [...rooms].filter(([, id]) => ids.has(id)).map(([room]) => room);
    void Promise.resolve()
      .then(() => window.river.voice.watchCallRooms(list))
      .catch(() => undefined);
  });
}

/** Keeps a call in mind (and watches its room). */
export async function remember(call: KnownGroupCall): Promise<void> {
  const known = { ...useGroupCall.getState().known };
  const before = known[call.callId];
  known[call.callId] = { ...call, seen: before?.seen ?? call.seen, at: before?.at ?? call.at };
  // The oldest go first (never the call you are in).
  const active = useGroupCall.getState().active?.callId;
  const ids = Object.values(known)
    .filter((c) => c.callId !== active)
    .sort((a, b) => a.at - b.at)
    .map((c) => c.callId);
  while (Object.keys(known).length > KNOWN_MAX && ids.length) delete known[ids.shift()!];
  useGroupCall.setState({ known });
  const room = await callRoomOf(call.callId);
  rooms.set(room, call.callId);
  watch();
}

function forget(callId: string): void {
  const s = useGroupCall.getState();
  if (!s.known[callId]) return;
  const known = { ...s.known };
  delete known[callId];
  const rosters = { ...s.rosters };
  delete rosters[callId];
  useGroupCall.setState({ known, rosters });
  for (const [room, id] of rooms) if (id === callId) rooms.delete(room);
  watch();
}

function setAllowed(callId: string, allowed: string[] | undefined): void {
  if (!allowed) return;
  useGroupCall.setState({ allowed: { ...useGroupCall.getState().allowed, [callId]: allowed } });
  applyRoster(callId);
}

/** The voice engine of the group call this device is in. */
function engine(callId: string): VoiceCall | null {
  const call = useCommunity.getState().call;
  return call?.channelId === `gcall:${callId}` && !call.closed ? call : null;
}

/** Gives the call engine who is in the call (you always are, while you are in it). */
function applyRoster(callId: string): void {
  const call = engine(callId);
  if (!call) return;
  const people = inCall(callId);
  call.updateParticipants(people.includes(call.me) ? people : [...people, call.me]);
}

// ---- from the server and from main ----------------------------------------------------------

/** Who the server says is in a room (one we joined or watch). */
export function handleRoster(e: { room: string; participants: string[] }): void {
  const callId = rooms.get(e.room);
  if (!callId) return;
  const s = useGroupCall.getState();
  useGroupCall.setState({ rosters: { ...s.rosters, [callId]: e.participants } });
  const people = inCall(callId);
  const known = s.known[callId];
  const others = people.filter((id) => id !== me());
  if (known && others.length > 0 && !known.seen)
    useGroupCall.setState({
      known: { ...useGroupCall.getState().known, [callId]: { ...known, seen: true } },
    });
  if (s.active?.callId === callId) {
    applyRoster(callId);
    return;
  }
  // Nobody is in it any more: the call is over.
  if (known && people.length === 0 && (known.seen || Date.now() - known.at > EMPTY_GRACE_MS)) {
    const incoming = useDmCall.getState().incoming;
    if (incoming?.callId === callId) missedRing(incoming);
    forget(callId);
  }
}

/** The server turned us away from a call's room: it is full. */
export function handleRoomFull(): void {
  if (!useGroupCall.getState().active) return;
  notify('That call is full.', 'error');
  void leaveGroupCall(false);
}

/** A group call rings here (main checked the group and who rang). `answered`: on the phone's call screen. */
export function handleGroupRing(e: Extract<DmEvent, { t: 'call' }>, answered = false): void {
  const g = e.group;
  if (!g) return;
  void remember({
    callId: e.callId,
    groupId: g.id,
    host: null,
    title: null,
    video: e.video,
    from: e.peer,
    at: Date.now(),
    seen: false,
  });
  const { active, incoming } = useDmCall.getState();
  // In a call already: no ringing over it; the group shows "Join".
  if (useGroupCall.getState().active || active || incoming) return;
  const ringing = { peer: e.peer, callId: e.callId, video: e.video, group: g };
  useDmCall.setState({ incoming: ringing });
  if (answered) {
    void acceptGroupRing(e.video);
    return;
  }
  ringTone('ring');
  window.clearTimeout(ringTimer);
  ringTimer = window.setTimeout(() => {
    if (useDmCall.getState().incoming?.callId === e.callId) missedRing(ringing);
  }, GROUP_RING_MS);
}

function missedRing(ringing: NonNullable<ReturnType<typeof useDmCall.getState>['incoming']>): void {
  if (!ringing.group) return;
  stopRingTone();
  window.clearTimeout(ringTimer);
  useDmCall.setState({ incoming: null });
  void window.river.dm.action({
    a: 'logCall',
    peer: ringing.group.id,
    kind: 'group',
    direction: 'in',
    video: ringing.video,
    answered: false,
    durationSec: 0,
    callId: ringing.callId,
  });
  notify(`Missed group call in ${ringing.group.name}.`);
}

export function handleGroupCallEvent(e: Extract<DmEvent, { t: 'gcall' | 'knock' | 'knockAnswer' }>): void {
  if (e.t === 'knock') {
    const s = useGroupCall.getState();
    if (s.knocks.some((k) => k.link === e.link && k.from === e.from)) return;
    useGroupCall.setState({ knocks: [...s.knocks, { ...e, at: Date.now() }].slice(-20) });
    play('reaction');
    return;
  }
  if (e.t === 'knockAnswer') {
    const asking = useGroupCall.getState().asking;
    if (asking?.link !== e.link || asking.host !== e.host) return;
    window.clearTimeout(knockTimer);
    useGroupCall.setState({ asking: { ...asking, state: e.answer === 'deny' ? 'denied' : 'gone' } });
    return;
  }
  switch (e.kind) {
    case 'signal': {
      const call = engine(e.callId);
      if (call && mayBeIn(e.callId, e.from)) void call.handleSignal(e.from, e.data);
      return;
    }
    case 'decline':
      if (useGroupCall.getState().active?.callId === e.callId)
        notify(`${personName(e.from, e.groupId ?? null)} can't join now.`);
      return;
    case 'ongoing':
      // A call started in a group while you are in another call: the group shows "Join".
      if (!e.groupId) return;
      void remember({
        callId: e.callId,
        groupId: e.groupId,
        host: null,
        title: null,
        video: e.video ?? false,
        from: e.from,
        at: Date.now(),
        seen: false,
      });
      notify(`${personName(e.from, e.groupId)} started a call in ${groupOf(e.groupId)?.name ?? 'a group'}.`);
      return;
    case 'allow':
      setAllowed(e.callId, e.allowed);
      return;
    case 'admitted': {
      const asking = useGroupCall.getState().asking;
      if (!asking || asking.host !== e.from) return;
      window.clearTimeout(knockTimer);
      useGroupCall.setState({ asking: null });
      const call: KnownGroupCall = {
        callId: e.callId,
        groupId: null,
        host: e.from,
        title: e.title ?? null,
        video: e.video ?? false,
        from: e.from,
        at: Date.now(),
        seen: false,
      };
      useGroupCall.setState({ allowed: { ...useGroupCall.getState().allowed, [e.callId]: e.allowed ?? [] } });
      void remember(call).then(() =>
        enter({ ...call, outgoing: false, ring: false, withVideo: false }).then(() => undefined),
      );
      return;
    }
  }
}

// ---- joining and leaving ----------------------------------------------------------------------

function onChange(call: VoiceCall, callId: string): void {
  const community = useCommunity;
  community.setState({ callVersion: community.getState().callVersion + 1 });
  const active = useGroupCall.getState().active;
  if (active?.callId !== callId) return;
  const remotes = call.remotes();
  const connected = remotes.some((r) => r.state === 'connected' || (r.relayed && r.relayFlowing));
  const peak = Math.max(active.peak, 1 + remotes.length);
  const state = connected ? 'connected' : 'waiting';
  if (state === active.state && peak === active.peak) return;
  const next: ActiveGroupCall = { ...active, state, peak };
  if (connected && !active.connectedAt) {
    next.connectedAt = Date.now();
    // Someone answered: the ringback stops.
    stopRingTone();
    play('callConnected');
  }
  useGroupCall.setState({ active: next });
}

/** Ends the call for you when nobody came, or when you stayed alone after everyone left. */
function watchAlone(callId: string): void {
  window.clearInterval(watchdog);
  aloneSince = null;
  watchdog = window.setInterval(() => {
    const active = useGroupCall.getState().active;
    if (active?.callId !== callId) {
      window.clearInterval(watchdog);
      return;
    }
    const others = inCall(callId).filter((id) => id !== me());
    const now = Date.now();
    if (others.length > 0) {
      aloneSince = null;
      return;
    }
    if (!active.connectedAt) {
      if (now - active.joinedAt > NOBODY_CAME_MS) {
        notify('Nobody joined the call.');
        void leaveGroupCall();
      }
      return;
    }
    aloneSince ??= now;
    if (now - aloneSince > ALONE_MS) {
      notify('Everyone else left the call.');
      void leaveGroupCall();
    }
  }, WATCHDOG_MS);
}

interface Entry {
  callId: string;
  groupId: string | null;
  host: string | null;
  title: string | null;
  video: boolean;
  outgoing: boolean;
  /** Start the call: ring the group once you are in its room. */
  ring: boolean;
  withVideo: boolean;
}

/**
 * Joins a group or call-link call. Like a 1:1 call, the call shows at once (a second click, or
 * hanging up during the microphone prompt, applies to it); after every wait, a call that was
 * left meanwhile stops there.
 */
async function enter(x: Entry): Promise<boolean> {
  const myId = me();
  if (!myId || useGroupCall.getState().active) return false;
  resumeAudio();
  const { callId } = x;
  useGroupCall.setState({
    active: {
      callId,
      groupId: x.groupId,
      host: x.host,
      title: x.title,
      video: x.video,
      state: 'waiting',
      outgoing: x.outgoing,
      joinedAt: Date.now(),
      peak: 1,
    },
  });
  const live = (): boolean => useGroupCall.getState().active?.callId === callId;
  const fail = (message: string): false => {
    if (live()) useGroupCall.setState({ active: null });
    stopRingTone();
    resetPhoneAudio();
    notify(message, 'error');
    return false;
  };
  // One call at a time: a 1:1 call or a voice channel is left first.
  const community = useCommunity;
  if (useDmCall.getState().active) await (await import('./call.ts')).endDmCall();
  const previous = community.getState().call;
  if (previous && !isPrivateCall(previous.channelId)) await community.getState().leaveVoice();
  else if (previous) {
    community.setState({ call: null });
    await previous.leave();
  }
  if (!live()) return false;
  const [iceServers, info] = await Promise.all([
    window.river.voice.iceServers().catch(() => []),
    Promise.resolve()
      .then(() => window.river.voice.relayInfo())
      .catch(() => ({ all: false, groupCalls: false })),
  ]);
  if (!live()) return false;
  if (!info.groupCalls)
    return fail("Your River server doesn't have group calls yet. Ask whoever runs it to update River.");
  const scope = x.groupId ? { groupId: x.groupId } : {};
  if (!x.ring) {
    // Main checks you may take part, and stops it ringing here and on your other devices.
    const r = await window.river.dm.action({
      a: 'groupCall',
      kind: 'join',
      callId,
      ...scope,
      video: x.video,
    });
    if (!r.ok) return fail(r.message);
    if (r.value && !x.groupId) setAllowed(callId, r.value.allowed);
  }
  if (!live()) {
    void window.river.dm.action({ a: 'groupCall', kind: 'leave', callId, ...scope });
    return false;
  }
  const room = await callRoomOf(callId);
  rooms.set(room, callId);
  const voice = useRiver.getState().settings?.voice;
  const transport: CallTransport = {
    join: () => window.river.voice.groupCallRoom(room),
    leave: async () => {
      await window.river.voice.groupCallRoom(null);
    },
    signal: (to, data) =>
      void window.river.dm
        .action({ a: 'groupCall', kind: 'signal', callId, ...scope, to: [to], data })
        .then((r) => {
          if (!r.ok) console.warn(`group call signal to ${to.slice(0, 4)} failed: ${r.message}`);
        }),
  };
  // Above eight people everyone's voice goes through the server (still end to end encrypted).
  const relay = new WebCodecsRelay(myId, {
    to: (to, payload) => window.river.voice.relay(to, payload),
    all: info.all ? (payload) => window.river.voice.relayAll(payload) : null,
  });
  const call: VoiceCall = new VoiceCall(
    `gcall:${callId}`,
    myId,
    () => onChange(call, callId),
    {
      iceServers,
      inputDeviceId: voice?.inputDeviceId ?? null,
      noiseSuppression: voice?.noiseSuppression ?? true,
      echoCancellation: voice?.echoCancellation ?? true,
      pushToTalk: voice?.inputMode === 'push-to-talk',
      sensitivity: voice?.sensitivity ?? null,
    },
    transport,
    relay,
  );
  call.nameOf = (id) => personName(id, x.groupId);
  call.muted = community.getState().selfMuted;
  call.deafened = community.getState().selfDeafened;
  community.setState({ call, callError: null });
  try {
    await call.start();
  } catch (err) {
    if (!live()) return false;
    if (community.getState().call === call) community.setState({ call: null });
    void window.river.dm.action({ a: 'groupCall', kind: 'leave', callId, ...scope });
    return fail(
      (err as Error).name === 'NotAllowedError'
        ? 'River could not use your microphone. Allow microphone access in your system settings.'
        : (err as Error).message || 'The call could not start.',
    );
  }
  if (!live() || call.closed) {
    if (!call.closed) void call.leave();
    return false;
  }
  // Whoever the server already said is in the room.
  applyRoster(callId);
  if (x.ring && x.groupId) {
    ringTone('ringback');
    const r = await window.river.dm.action({
      a: 'groupCall',
      kind: 'ring',
      callId,
      groupId: x.groupId,
      video: x.video,
    });
    if (!r.ok) notify(r.message, 'error');
    // The ringback lasts as long as the ring.
    window.setTimeout(() => {
      if (useGroupCall.getState().active?.callId === callId && !useGroupCall.getState().active?.connectedAt)
        stopRingTone();
    }, GROUP_RING_MS);
  }
  if (!live()) return false;
  if (x.withVideo) {
    await call.setCamera(true).catch(() => {
      if (live())
        notify('River could not start your camera, so you are in the call with voice only.', 'error');
    });
  }
  watchAlone(callId);
  watch();
  return true;
}

/** Starts a call in a group: you join its room, and the group's other members ring. */
export async function startGroupCall(groupId: string, video: boolean): Promise<void> {
  const { active, incoming } = useDmCall.getState();
  if (active || incoming || useGroupCall.getState().active || !me()) return;
  const group = groupOf(groupId);
  if (!group || group.kind !== 'group' || group.state !== 'accepted') return;
  const callId = newCallId();
  const call: KnownGroupCall = {
    callId,
    groupId,
    host: null,
    title: null,
    video,
    from: me(),
    at: Date.now(),
    seen: false,
  };
  useDm.getState().select(groupId);
  // enter() shows the call as active in this same tick: a double click starts one call.
  const entering = enter({ ...call, outgoing: true, ring: true, withVideo: video });
  await remember(call);
  await entering;
}

/** Joins a call going on in a group (its "Join" bar) or a call-link call you were let into. */
export async function joinGroupCall(callId: string, withVideo: boolean): Promise<void> {
  const known = useGroupCall.getState().known[callId];
  if (!known || useDmCall.getState().active || useGroupCall.getState().active) return;
  const incoming = useDmCall.getState().incoming;
  if (incoming?.callId === callId) {
    await acceptGroupRing(withVideo);
    return;
  }
  await enter({ ...known, outgoing: known.host === me(), ring: false, withVideo });
}

/** Answers the group call ringing here. */
export async function acceptGroupRing(withVideo: boolean): Promise<void> {
  const incoming = useDmCall.getState().incoming;
  if (!incoming?.group) return;
  stopRingTone();
  window.clearTimeout(ringTimer);
  useDmCall.setState({ incoming: null });
  const known = useGroupCall.getState().known[incoming.callId];
  useDm.getState().select(incoming.group.id);
  useRiver.getState().navigate('messages');
  await enter({
    callId: incoming.callId,
    groupId: incoming.group.id,
    host: null,
    title: null,
    video: known?.video ?? incoming.video,
    outgoing: false,
    ring: false,
    withVideo,
  });
}

/** Says no to the group call ringing here (who rang hears it; the call goes on without you). */
export function declineGroupRing(): void {
  const incoming = useDmCall.getState().incoming;
  if (!incoming?.group) return;
  stopRingTone();
  window.clearTimeout(ringTimer);
  useDmCall.setState({ incoming: null });
  void window.river.dm.action({
    a: 'logCall',
    peer: incoming.group.id,
    kind: 'group',
    direction: 'in',
    video: incoming.video,
    answered: false,
    durationSec: 0,
    outcome: 'declined',
    callId: incoming.callId,
  });
  void window.river.dm.action({
    a: 'groupCall',
    kind: 'decline',
    callId: incoming.callId,
    groupId: incoming.group.id,
    to: [incoming.peer],
  });
}

/** Rings these members of the group again (people who missed it, or joined the group later). */
export async function ringAgain(people: string[]): Promise<void> {
  const active = useGroupCall.getState().active;
  if (!active?.groupId || people.length === 0) return;
  const r = await window.river.dm.action({
    a: 'groupCall',
    kind: 'ring',
    callId: active.callId,
    groupId: active.groupId,
    video: active.video,
    to: people,
  });
  if (!r.ok) notify(r.message, 'error');
  else notify(people.length === 1 ? `Ringing ${personName(people[0]!, active.groupId)}…` : 'Ringing…');
}

/**
 * Leaves the group call: you leave its room (everyone else sees you go), and the call goes on
 * without you while anyone is in it. `log`: record it in the call history.
 */
export async function leaveGroupCall(log = true): Promise<void> {
  const active = useGroupCall.getState().active;
  if (!active) return;
  stopRingTone();
  window.clearInterval(watchdog);
  useGroupCall.setState({ active: null });
  const scope = active.groupId ? { groupId: active.groupId } : {};
  if (log) {
    const durationSec = active.connectedAt ? Math.round((Date.now() - active.connectedAt) / 1000) : 0;
    void window.river.dm.action({
      a: 'logCall',
      peer: active.groupId ?? active.host ?? me(),
      kind: active.groupId ? 'group' : 'link',
      direction: active.outgoing ? 'out' : 'in',
      video: active.video,
      answered: active.connectedAt !== undefined,
      durationSec,
      people: Math.max(1, Math.min(50, active.peak)),
    });
  }
  void window.river.dm.action({ a: 'groupCall', kind: 'leave', callId: active.callId, ...scope });
  resetPhoneAudio();
  const call = useCommunity.getState().call;
  if (call?.channelId === `gcall:${active.callId}`) {
    useCommunity.setState({ call: null });
    play('callEnded');
    await call.leave();
  }
  // Others may still be in it: the group keeps showing "Join" while they are.
  watch();
}

// ---- call links ------------------------------------------------------------------------------

/** Makes a call link and shows it, ready to share. */
export async function createCallLink(video: boolean, title?: string): Promise<CallLinkView | null> {
  const r = await window.river.dm.action({ a: 'createCallLink', video, ...(title ? { title } : {}) });
  if (!r.ok) {
    notify(r.message, 'error');
    return null;
  }
  useGroupCall.setState({ madeLink: r.value });
  return r.value;
}

/** Host: starts (or goes back into) the call of one of your links. */
export async function startLinkCall(link: CallLinkView): Promise<void> {
  if (useDmCall.getState().active || useDmCall.getState().incoming || useGroupCall.getState().active) return;
  const call: KnownGroupCall = {
    callId: link.callId,
    groupId: null,
    host: me(),
    title: link.title,
    video: link.video,
    from: me(),
    at: Date.now(),
    seen: false,
  };
  useGroupCall.setState({
    madeLink: null,
    allowed: { ...useGroupCall.getState().allowed, [link.callId]: [me(), ...link.admitted] },
  });
  const entering = enter({ ...call, outgoing: true, ring: false, withVideo: link.video });
  await remember(call);
  await entering;
}

/** A call link pasted or opened: River asks before anything is sent. */
export function offerCallLink(text: string): void {
  const parsed = parseCallLink(text);
  if (!parsed) {
    notify('That call link is not complete. Ask for a new one.', 'error');
    return;
  }
  const account = useRiver.getState().account;
  const origin = (url: string): string => {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  };
  if (
    account.state === 'registered' &&
    origin(parsed.serverUrl) !== origin(account.serverUrl) &&
    origin(parsed.serverUrl) !== origin(account.shareUrl)
  ) {
    notify('That call link is for people on another River server.', 'error');
    return;
  }
  if (parsed.host === me()) {
    void window.river.dm.action({ a: 'callLinks' }).then((r) => {
      const mine = r.ok ? r.value.find((l) => l.id === parsed.link) : undefined;
      if (mine) void startLinkCall(mine);
      else notify('That call link of yours no longer works.', 'error');
    });
    return;
  }
  useGroupCall.setState({ asking: { host: parsed.host, link: parsed.link, state: 'confirm' } });
}

/** Asks the host of the link to let you in. */
export async function askToJoin(): Promise<void> {
  const asking = useGroupCall.getState().asking;
  if (!asking || asking.state === 'asking') return;
  useGroupCall.setState({ asking: { ...asking, state: 'asking' } });
  const r = await window.river.dm.action({ a: 'knock', host: asking.host, link: asking.link });
  if (!r.ok) {
    useGroupCall.setState({ asking: null });
    notify(r.message, 'error');
    return;
  }
  window.clearTimeout(knockTimer);
  knockTimer = window.setTimeout(() => {
    const now = useGroupCall.getState().asking;
    if (now?.link !== asking.link || now.state !== 'asking') return;
    void window.river.dm.action({ a: 'cancelKnock', link: asking.link });
    useGroupCall.setState({ asking: { ...now, state: 'unanswered' } });
  }, KNOCK_WAIT_MS);
}

export function stopAsking(): void {
  const asking = useGroupCall.getState().asking;
  window.clearTimeout(knockTimer);
  useGroupCall.setState({ asking: null });
  if (asking?.state === 'asking') void window.river.dm.action({ a: 'cancelKnock', link: asking.link });
}

/** Host: lets someone who asked in, or says no. */
export async function answerKnock(knock: Knock, admit: boolean): Promise<void> {
  useGroupCall.setState({
    knocks: useGroupCall.getState().knocks.filter((k) => !(k.link === knock.link && k.from === knock.from)),
  });
  const r = await window.river.dm.action({ a: 'answerKnock', link: knock.link, who: knock.from, admit });
  if (!r.ok) notify(r.message, 'error');
}
