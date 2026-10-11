import type { ChosenStatus, PresenceStatus, ServerEvent, VoiceState } from '@river/protocol';

export interface HubSocket {
  send(data: string | Buffer): void;
  close(code?: number): void;
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

  constructor(options: HubOptions = {}) {
    this.graceMs = options.voiceGraceMs ?? VOICE_GRACE_MS;
  }

  private readonly sockets = new Map<string, Set<HubSocket>>();
  private readonly voice = new Map<string, { communityId: string; members: Set<string> }>();
  private readonly voiceOf = new Map<string, string>();
  private readonly states = new Map<string, VoiceState>();
  /** Chosen presence per account (in memory; apps send it again when they connect). */
  private readonly chosen = new Map<string, ChosenStatus>();

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
    if (set && set.size > 0) return { offline: false, held: null };
    this.sockets.delete(riverId);
    this.holdRoom(riverId);
    return { offline: true, held: this.holdSeat(riverId) };
  }

  /** Joins a private call room (leaving any other); false if it is full. */
  joinRoom(riverId: string, room: string, max: number): boolean {
    this.clearRoomTimer(riverId);
    if (this.roomOf.get(riverId) === room) return true;
    const members = this.callRooms.get(room) ?? new Set<string>();
    if (members.size >= max) return false;
    this.leaveRoom(riverId);
    members.add(riverId);
    this.callRooms.set(room, members);
    this.roomOf.set(riverId, room);
    return true;
  }

  leaveRoom(riverId: string): void {
    this.clearRoomTimer(riverId);
    const room = this.roomOf.get(riverId);
    if (!room) return;
    this.roomOf.delete(riverId);
    const members = this.callRooms.get(room);
    members?.delete(riverId);
    if (members && members.size === 0) this.callRooms.delete(room);
  }

  /** A dropped connection keeps its call room for the grace period (the call itself is peer to peer). */
  private holdRoom(riverId: string): void {
    if (!this.roomOf.has(riverId)) return;
    this.clearRoomTimer(riverId);
    const t = setTimeout(() => {
      this.roomTimers.delete(riverId);
      if (!this.isOnline(riverId)) this.leaveRoom(riverId);
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

  /** Keeps a voice seat (marked reconnecting) until rejoin or the grace period ends. */
  private holdSeat(riverId: string): { channelId: string; communityId: string } | null {
    const channelId = this.voiceOf.get(riverId);
    const room = channelId ? this.voice.get(channelId) : undefined;
    if (!channelId || !room) return null;
    this.setState(riverId, { reconnecting: true });
    this.clearGrace(riverId);
    const timer = setTimeout(() => {
      this.graceTimers.delete(riverId);
      if (this.isOnline(riverId) && !this.stateOf(riverId).reconnecting) return;
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

  joinVoice(
    riverId: string,
    communityId: string,
    channelId: string,
  ): { left: { channelId: string; communityId: string } | null } {
    const left = this.voiceOf.get(riverId) === channelId ? null : this.leaveVoice(riverId);
    let room = this.voice.get(channelId);
    if (!room) this.voice.set(channelId, (room = { communityId, members: new Set() }));
    room.members.add(riverId);
    this.voiceOf.set(riverId, channelId);
    this.clearGrace(riverId);
    const { reconnecting: _back, ...state } = this.states.get(riverId) ?? DEFAULT_STATE;
    this.states.set(riverId, state);
    return { left };
  }

  leaveVoice(riverId: string): { channelId: string; communityId: string } | null {
    const channelId = this.voiceOf.get(riverId);
    this.clearGrace(riverId);
    if (!channelId) return null;
    this.voiceOf.delete(riverId);
    const room = this.voice.get(channelId);
    room?.members.delete(riverId);
    if (room && room.members.size === 0) this.voice.delete(channelId);
    const serverMuted = this.states.get(riverId)?.serverMuted ?? false;
    // Server mute sticks across reconnects within the server's lifetime; the rest resets.
    this.states.set(riverId, { ...DEFAULT_STATE, serverMuted });
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
}
