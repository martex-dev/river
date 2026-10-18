import {
  RelaySpeakers,
  type ChosenStatus,
  type PresenceStatus,
  type ServerEvent,
  type VoiceState,
} from '@river/protocol';

export interface HubSocket {
  send(data: string | Buffer): void;
  close(code?: number): void;
  /** The account device this connection signed in as (set at auth). */
  deviceId?: number;
}

const DEFAULT_STATE: VoiceState = { muted: false, deafened: false, serverMuted: false, streaming: false };

/** How long a voice seat is kept after its member's last connection drops (tunnel hiccups). */
export const VOICE_GRACE_MS = 45_000;

export interface HubOptions {
  voiceGraceMs?: number;
}

/**
 * In-memory realtime state: which sockets belong to which account, who is in
 * which voice channel, and their voice state. Nothing here is persisted.
 *
 * A dropped connection does not end a call at once: calls are peer to peer, so
 * the seat is kept (marked reconnecting) until the app reconnects and rejoins,
 * or the grace period runs out.
 */
export class Hub {
  private readonly graceMs: number;
  /** A seat's grace period ran out: the member is out of the channel; tell the others. */
  onSeatExpired: ((left: { channelId: string; communityId: string }) => void) | null = null;
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Private call rooms (1:1 calls) whose members may relay voice to each other. */
  private readonly callRooms = new Map<string, Set<string>>();
  private readonly roomOf = new Map<string, string>();
  private readonly roomTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * The connection that joined the voice channel / call room. Seats belong to an account, but it
   * is one device that is in the call: when that connection drops, the seat goes into its grace
   * period even if the account's other devices stay connected.
   */
  private readonly voiceSocket = new Map<string, HubSocket>();
  private readonly roomSocket = new Map<string, HubSocket>();
  /** Whose relayed voice is forwarded right now, per voice channel or call room (2.13). */
  private readonly relaySpeakers = new Map<string, RelaySpeakers>();

  constructor(options: HubOptions = {}) {
    this.graceMs = options.voiceGraceMs ?? VOICE_GRACE_MS;
  }

  private readonly sockets = new Map<string, Set<HubSocket>>();
  private readonly voice = new Map<string, { communityId: string; members: Set<string> }>();
  private readonly voiceOf = new Map<string, string>();
  private readonly states = new Map<string, VoiceState>();
  private readonly lastSound = new Map<string, number>();
  /** Muted because they are in a stage's audience (not by a moderator), 1.0.22. */
  readonly stageMuted = new Set<string>();
  /** Chosen presence per account (in memory; apps send it again when they connect). */
  private readonly chosen = new Map<string, ChosenStatus>();

  /** Devices removed from an account: their open connections end now (linked devices, 1.3.1). */
  disconnectDevices(riverId: string, deviceIds: readonly number[]): number {
    let closed = 0;
    for (const socket of [...(this.sockets.get(riverId) ?? [])]) {
      if (socket.deviceId !== undefined && deviceIds.includes(socket.deviceId)) {
        socket.close(4401);
        closed += 1;
      }
    }
    return closed;
  }

  add(riverId: string, socket: HubSocket): boolean {
    let set = this.sockets.get(riverId);
    const cameOnline = !set || set.size === 0;
    if (!set) this.sockets.set(riverId, (set = new Set()));
    set.add(socket);
    return cameOnline;
  }

  /**
   * Returns whether the user went offline and, if they were in a voice
   * channel, that channel: their seat is now held for the grace period.
   */
  remove(
    riverId: string,
    socket: HubSocket,
  ): { offline: boolean; held: { channelId: string; communityId: string } | null } {
    const set = this.sockets.get(riverId);
    set?.delete(socket);
    if (set && set.size > 0) {
      // Other devices are still connected; only the seats this connection held are let go.
      if (this.roomSocket.get(riverId) === socket) this.holdRoom(riverId, socket);
      const held = this.voiceSocket.get(riverId) === socket ? this.holdSeat(riverId, socket) : null;
      return { offline: false, held };
    }
    this.sockets.delete(riverId);
    this.holdRoom(riverId);
    return { offline: true, held: this.holdSeat(riverId) };
  }

  /** Joins a private call room (leaving any other); false if it is full. */
  joinRoom(riverId: string, room: string, max: number, socket?: HubSocket): boolean {
    this.clearRoomTimer(riverId);
    if (this.roomOf.get(riverId) === room) {
      this.setOwner(this.roomSocket, riverId, socket);
      return true;
    }
    const members = this.callRooms.get(room) ?? new Set<string>();
    if (members.size >= max) return false;
    this.leaveRoom(riverId);
    members.add(riverId);
    this.callRooms.set(room, members);
    this.roomOf.set(riverId, room);
    this.setOwner(this.roomSocket, riverId, socket);
    return true;
  }

  private setOwner(map: Map<string, HubSocket>, riverId: string, socket: HubSocket | undefined): void {
    if (socket) map.set(riverId, socket);
    else map.delete(riverId);
  }

  leaveRoom(riverId: string): void {
    this.clearRoomTimer(riverId);
    this.roomSocket.delete(riverId);
    const room = this.roomOf.get(riverId);
    if (!room) return;
    this.roomOf.delete(riverId);
    const members = this.callRooms.get(room);
    members?.delete(riverId);
    this.forgetSpeaker(`room:${room}`, riverId, !members || members.size === 0);
    if (members && members.size === 0) this.callRooms.delete(room);
  }

  private forgetSpeaker(scope: string, riverId: string, empty: boolean): void {
    if (empty) this.relaySpeakers.delete(scope);
    else this.relaySpeakers.get(scope)?.forget(riverId);
  }

  /** The voice channel (or call room) whose relay `riverId` takes part in. */
  private relayScope(riverId: string): string | null {
    const ch = this.voiceOf.get(riverId);
    if (ch) return ch;
    const room = this.roomOf.get(riverId);
    return room ? `room:${room}` : null;
  }

  /**
   * Whether a relayed voice frame from `sender` is forwarded now: only while they are in a call,
   * and only from the first few people of that call talking at once (RelaySpeakers).
   */
  admitRelay(sender: string, now: number): boolean {
    const scope = this.relayScope(sender);
    if (!scope) return false;
    let speakers = this.relaySpeakers.get(scope);
    if (!speakers) this.relaySpeakers.set(scope, (speakers = new RelaySpeakers()));
    return speakers.admit(sender, now);
  }

  /** Everyone `riverId` may relay voice to: the others in their voice channel, else in their call room. */
  callPeers(riverId: string): string[] {
    const ch = this.voiceOf.get(riverId);
    if (ch) return this.participants(ch).filter((id) => id !== riverId);
    const room = this.roomOf.get(riverId);
    return room ? [...(this.callRooms.get(room) ?? [])].filter((id) => id !== riverId) : [];
  }

  /** Calls whose relay state the hub keeps (tests: nothing lingers after everyone left). */
  get relayScopes(): number {
    return this.relaySpeakers.size;
  }

  /**
   * A dropped connection keeps its call room for the grace period (the call itself is peer to
   * peer). `socket`: the connection that was in the room, while the account has others online.
   */
  private holdRoom(riverId: string, socket?: HubSocket): void {
    if (!this.roomOf.has(riverId)) return;
    this.clearRoomTimer(riverId);
    const t = setTimeout(() => {
      this.roomTimers.delete(riverId);
      const stillGone = socket ? this.roomSocket.get(riverId) === socket : false;
      if (!this.isOnline(riverId) || stillGone) this.leaveRoom(riverId);
    }, this.graceMs);
    t.unref?.();
    this.roomTimers.set(riverId, t);
  }

  private clearRoomTimer(riverId: string): void {
    const t = this.roomTimers.get(riverId);
    if (t) clearTimeout(t);
    this.roomTimers.delete(riverId);
  }

  /** Whether `a` may relay voice to `b`: same voice channel, or same private call room. */
  sharesCall(a: string, b: string): boolean {
    if (a === b) return false;
    const ch = this.voiceOf.get(a);
    if (ch && this.voiceOf.get(b) === ch) return true;
    const room = this.roomOf.get(a);
    return !!room && this.roomOf.get(b) === room;
  }

  /**
   * Keeps a voice seat (marked reconnecting) until rejoin or the grace period ends. `socket`: the
   * connection that was in the call, when the account still has other connections.
   */
  private holdSeat(riverId: string, socket?: HubSocket): { channelId: string; communityId: string } | null {
    const channelId = this.voiceOf.get(riverId);
    const room = channelId ? this.voice.get(channelId) : undefined;
    if (!channelId || !room) return null;
    this.setState(riverId, { reconnecting: true });
    this.clearGrace(riverId);
    const timer = setTimeout(() => {
      this.graceTimers.delete(riverId);
      // Rejoined in time (from any device): the seat stays.
      const rejoined = socket ? this.voiceSocket.get(riverId) !== socket : this.isOnline(riverId);
      if (rejoined && !this.stateOf(riverId).reconnecting) return;
      if (this.voiceOf.get(riverId) !== channelId) return;
      const left = this.leaveVoice(riverId);
      if (left) this.onSeatExpired?.(left);
    }, this.graceMs);
    timer.unref?.();
    this.graceTimers.set(riverId, timer);
    return { channelId, communityId: room.communityId };
  }

  private clearGrace(riverId: string): void {
    const t = this.graceTimers.get(riverId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(riverId);
  }

  /** Stops every grace timer (server shutdown). */
  close(): void {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    for (const t of this.roomTimers.values()) clearTimeout(t);
    this.roomTimers.clear();
  }

  setStatus(riverId: string, status: ChosenStatus): void {
    this.chosen.set(riverId, status);
  }

  /** What others see: null (offline, or invisible), or online / idle / dnd. */
  visibleStatus(riverId: string): PresenceStatus | null {
    if (!this.isOnline(riverId)) return null;
    const s = this.chosen.get(riverId) ?? 'online';
    return s === 'invisible' ? null : s;
  }

  isOnline(riverId: string): boolean {
    return (this.sockets.get(riverId)?.size ?? 0) > 0;
  }

  /** Closes every connection of an account (suspended or deleted by the operator). */
  disconnect(riverId: string, code: number): void {
    for (const s of [...(this.sockets.get(riverId) ?? [])]) s.close(code);
  }

  sendTo(riverIds: Iterable<string>, event: ServerEvent): void {
    const data = JSON.stringify(event);
    for (const id of riverIds) for (const s of this.sockets.get(id) ?? []) s.send(data);
  }

  /** Relayed voice frames (binary) to every connection of one account. */
  sendBinaryTo(riverId: string, frame: Buffer): void {
    for (const s of this.sockets.get(riverId) ?? []) s.send(frame);
  }

  /**
   * A relayed voice frame from `sender` to `to`: only to the connection of `to` that is in the call
   * with them (2.13). Their other devices (a phone in a pocket) are not in the call and would only
   * spend data and battery on it. Seats taken without a known connection go to every connection.
   */
  sendRelay(sender: string, to: string, frame: Buffer): void {
    const ch = this.voiceOf.get(sender);
    const owner = ch && this.voiceOf.get(to) === ch ? this.voiceSocket.get(to) : this.roomSocket.get(to);
    const sockets = this.sockets.get(to);
    if (owner && sockets?.has(owner)) owner.send(frame);
    else if (!owner) this.sendBinaryTo(to, frame);
    // A known connection that dropped: nothing (the seat is held until that device is back).
  }

  joinVoice(
    riverId: string,
    communityId: string,
    channelId: string,
    socket?: HubSocket,
  ): { left: { channelId: string; communityId: string } | null } {
    const left = this.voiceOf.get(riverId) === channelId ? null : this.leaveVoice(riverId);
    let room = this.voice.get(channelId);
    if (!room) this.voice.set(channelId, (room = { communityId, members: new Set() }));
    room.members.add(riverId);
    this.voiceOf.set(riverId, channelId);
    this.setOwner(this.voiceSocket, riverId, socket);
    this.clearGrace(riverId);
    const { reconnecting: _back, ...state } = this.states.get(riverId) ?? DEFAULT_STATE;
    this.states.set(riverId, state);
    return { left };
  }

  leaveVoice(riverId: string): { channelId: string; communityId: string } | null {
    const channelId = this.voiceOf.get(riverId);
    this.clearGrace(riverId);
    this.voiceSocket.delete(riverId);
    if (!channelId) return null;
    this.voiceOf.delete(riverId);
    const room = this.voice.get(channelId);
    room?.members.delete(riverId);
    this.forgetSpeaker(channelId, riverId, !room || room.members.size === 0);
    if (room && room.members.size === 0) this.voice.delete(channelId);
    const { serverMuted = false, serverDeafened = false } = this.states.get(riverId) ?? {};
    // Server mute and deafen stick across reconnects within the server's lifetime; the rest resets.
    this.states.set(riverId, {
      ...DEFAULT_STATE,
      serverMuted,
      ...(serverDeafened ? { serverDeafened } : {}),
    });
    return room ? { channelId, communityId: room.communityId } : null;
  }

  setState(riverId: string, patch: Partial<VoiceState>): void {
    this.states.set(riverId, { ...(this.states.get(riverId) ?? DEFAULT_STATE), ...patch });
  }

  stateOf(riverId: string): VoiceState {
    return this.states.get(riverId) ?? DEFAULT_STATE;
  }

  voiceChannelOf(riverId: string): string | null {
    return this.voiceOf.get(riverId) ?? null;
  }

  participants(channelId: string): string[] {
    return [...(this.voice.get(channelId)?.members ?? [])];
  }

  statesOf(channelId: string): Record<string, VoiceState> {
    return Object.fromEntries(this.participants(channelId).map((id) => [id, this.stateOf(id)]));
  }

  rooms(communityId: string): Array<{ channelId: string; participants: string[] }> {
    return [...this.voice.entries()]
      .filter(([, r]) => r.communityId === communityId)
      .map(([channelId, r]) => ({ channelId, participants: [...r.members] }));
  }

  /** Soundboard cooldown: true (and remembered) when this person may play a sound now. */
  takeSoundTurn(riverId: string, now: number, cooldownMs: number): boolean {
    const last = this.lastSound.get(riverId) ?? -Infinity;
    if (now - last < cooldownMs) return false;
    this.lastSound.set(riverId, now);
    return true;
  }
}
