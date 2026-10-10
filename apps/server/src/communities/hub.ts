import type { ServerEvent, VoiceState } from '@river/protocol';

export interface HubSocket {
  send(data: string): void;
  close(code?: number): void;
}

const DEFAULT_STATE: VoiceState = { muted: false, deafened: false, serverMuted: false, streaming: false };

/**
 * In-memory realtime state: which sockets belong to which account, who is in
 * which voice channel, and their voice state. Nothing here is persisted.
 */
export class Hub {
  private readonly sockets = new Map<string, Set<HubSocket>>();
  private readonly voice = new Map<string, { communityId: string; members: Set<string> }>();
  private readonly voiceOf = new Map<string, string>();
  private readonly states = new Map<string, VoiceState>();

  add(riverId: string, socket: HubSocket): boolean {
    let set = this.sockets.get(riverId);
    const cameOnline = !set || set.size === 0;
    if (!set) this.sockets.set(riverId, (set = new Set()));
    set.add(socket);
    return cameOnline;
  }

  /** Returns whether the user went offline and the voice channel they left (if any). */
  remove(
    riverId: string,
    socket: HubSocket,
  ): { offline: boolean; left: { channelId: string; communityId: string } | null } {
    const set = this.sockets.get(riverId);
    set?.delete(socket);
    if (set && set.size > 0) return { offline: false, left: null };
    this.sockets.delete(riverId);
    return { offline: true, left: this.leaveVoice(riverId) };
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
    if (!this.states.has(riverId)) this.states.set(riverId, { ...DEFAULT_STATE });
    return { left };
  }

  leaveVoice(riverId: string): { channelId: string; communityId: string } | null {
    const channelId = this.voiceOf.get(riverId);
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
