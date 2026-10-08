import type { ServerEvent } from '@river/protocol';

export interface HubSocket {
  send(data: string): void;
  close(code?: number): void;
}

/**
 * In-memory realtime state: which sockets belong to which account, and who is
 * in which voice channel. Nothing here is persisted; a restart clears it.
 */
export class Hub {
  private readonly sockets = new Map<string, Set<HubSocket>>();
  /** channelId → riverIds currently in the voice channel. */
  private readonly voice = new Map<string, { communityId: string; members: Set<string> }>();
  /** riverId → channelId they are in (one voice channel at a time). */
  private readonly voiceOf = new Map<string, string>();

  add(riverId: string, socket: HubSocket): void {
    let set = this.sockets.get(riverId);
    if (!set) this.sockets.set(riverId, (set = new Set()));
    set.add(socket);
  }

  /** Returns the voice channel the user left (if their last socket closed while in one). */
  remove(riverId: string, socket: HubSocket): { channelId: string; communityId: string } | null {
    const set = this.sockets.get(riverId);
    set?.delete(socket);
    if (set && set.size > 0) return null;
    this.sockets.delete(riverId);
    return this.leaveVoice(riverId);
  }

  isOnline(riverId: string): boolean {
    return (this.sockets.get(riverId)?.size ?? 0) > 0;
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
    return { left };
  }

  leaveVoice(riverId: string): { channelId: string; communityId: string } | null {
    const channelId = this.voiceOf.get(riverId);
    if (!channelId) return null;
    this.voiceOf.delete(riverId);
    const room = this.voice.get(channelId);
    room?.members.delete(riverId);
    if (room && room.members.size === 0) this.voice.delete(channelId);
    return room ? { channelId, communityId: room.communityId } : null;
  }

  voiceChannelOf(riverId: string): string | null {
    return this.voiceOf.get(riverId) ?? null;
  }

  participants(channelId: string): string[] {
    return [...(this.voice.get(channelId)?.members ?? [])];
  }

  /** Voice rooms of one community, for clients that just connected. */
  rooms(communityId: string): Array<{ channelId: string; participants: string[] }> {
    return [...this.voice.entries()]
      .filter(([, r]) => r.communityId === communityId)
      .map(([channelId, r]) => ({ channelId, participants: [...r.members] }));
  }
}
