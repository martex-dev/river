import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  API_PREFIX,
  DEFAULT_EVERYONE,
  Permission,
  attachmentUploadResponseSchema,
  iceServersResponseSchema,
  bansResponseSchema,
  joinResponseSchema,
  rotateKeyResponseSchema,
  communitiesResponseSchema,
  communitySchema,
  computePermissions,
  inviteResponseSchema,
  messageSchema,
  messagesResponseSchema,
  serverEventSchema,
  topPosition,
  type CommunityWire,
  type MessageWire,
  type ServerEvent,
  type VoiceState,
} from '@river/protocol';
import { z } from 'zod';
import {
  attachmentPointerSchema,
  communityActionSchema,
  type AttachmentPointer,
  type BanView,
  type CommunityAction,
  type CommunityActionResult,
} from '../../shared/community-actions.ts';
import { layoutChanges, moveChannel as moveInLayout, sidebarGroups } from '../../shared/layout.ts';
import { communityIconSchema, templateById, type TemplateId } from '../../shared/templates.ts';
import type {
  CategoryView,
  ChannelView,
  ChatMessage,
  CommunityEvent,
  CommunityView,
  MemberView,
  RoleView,
} from '../../shared/ipc.ts';
import type { AccountService } from '../account/account-service.ts';
import { decryptAttachment, encryptAttachment, paddedSize } from '@river/crypto';
import { ApiError, type RequestBytes, type RequestJson } from '../http.ts';
import type { IdentityService } from '../identity/identity-service.ts';
import type { Logger } from '../logger.ts';
import type { LocalDatabase } from '../storage/database.ts';
import {
  KeyRing,
  formatInvite,
  newCommunityKey,
  open,
  parseInvite,
  randomId,
  reactionTag,
  seal,
} from './sealed.ts';

/** The shape WebRTC expects for STUN/TURN servers. */
export interface RTCIceServerLike {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Community keys travel inside libsignal direct messages. */
export type KeyMessage =
  | { t: 'ckey'; communityId: string; epoch: number; key: string }
  | { t: 'ckeyReq'; communityId: string; epoch: number };

export class CommunityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommunityError';
  }
}

const nameSchema = z.string().trim().min(1).max(64);
const textSchema = z
  .string()
  .max(4000)
  .refine((s) => s.trim().length > 0, 'empty');

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Deps {
  db: () => LocalDatabase | null;
  account: AccountService;
  identity: IdentityService;
  requestJson: RequestJson;
  /** Binary requests for attachments. */
  requestBytes?: RequestBytes;
  /** Where to keep encrypted copies of received files (null = keep none). */
  blobDir?: () => string | null;
  log: Logger;
  /** Creates the realtime socket (injectable for tests). */
  createSocket?: (url: string) => WebSocket;
}

interface SealedProfile {
  /** The member's identity key (base64), so a direct message can detect a server swapping keys. */
  identityKey?: string;
  name: string | null;
  avatar?: string | null;
}

const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Server error codes turned into messages people understand. */
function explain(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.code === 'forbidden')
      throw new CommunityError(err.message || 'You do not have permission to do that.');
    if (err.code === 'banned') throw new CommunityError('You are banned from this community.');
    if (err.code === 'mailbox_full' || err.code === 'quota_exceeded') throw new CommunityError(err.message);
    if (err.code === 'not_found') throw new CommunityError('That no longer exists.');
    if (err.status === 400 && err.message && err.message !== 'Bad request')
      throw new CommunityError(err.message);
  }
  throw err;
}

/**
 * Communities on the user's River server. All names, topics, profiles,
 * messages, reactions and call signalling are sealed with the community key
 * before leaving this process; the renderer only ever sees decrypted,
 * validated values. Permissions are enforced by the server; the views here
 * carry them so the UI can hide what the user cannot do.
 */
export class CommunityService {
  private readonly deps: Deps;
  private communities: CommunityView[] = [];
  private readonly keys = new Map<string, KeyRing>();
  /** Raw community records from the server, for key maintenance. */
  private readonly wires = new Map<string, CommunityWire>();
  /** Which key opened each message, so reactions use the same key. */
  private readonly messageKeys = new Map<string, Buffer>();
  /** Who sent recent messages, so a reply to one of yours counts as a mention. */
  private readonly messageSenders = new Map<string, string>();
  private keyChannel: { send(peer: string, message: KeyMessage): Promise<void> } | null = null;
  private readonly rotating = new Set<string>();
  private readonly keyRequests = new Map<string, number>();
  private readonly keyAnswers = new Map<string, number>();
  /** How long to wait for a rotation in progress before asking for a key (shortened in tests). */
  keyRequestDelayMs = 3000;
  private readonly channelToCommunity = new Map<string, string>();
  private readonly voice = new Map<string, string[]>();
  private readonly voiceStates = new Map<string, VoiceState>();
  private readonly online = new Map<string, boolean>();
  /** Names seen for River IDs, so ban lists can show who was banned. */
  private readonly knownNames = new Map<string, string>();
  /** Message IDs seen recently, to tell new messages from edits and reactions. */
  private readonly seen = new Set<string>();
  private readonly attachmentCache = new Map<string, Uint8Array>();
  private cacheBytes = 0;
  private socket: WebSocket | null = null;
  private socketState: 'online' | 'offline' | 'connecting' = 'offline';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private backoff = 1000;
  private readonly listeners = new Set<(e: CommunityEvent) => void>();
  private readonly rawListeners = new Set<(e: ServerEvent) => void>();
  /** Identity keys members published inside sealed community profiles. */
  private readonly profileKeys = new Map<string, string>();
  /** Where you stopped reading each channel (from the local database). */
  private reads: Map<string, string> | null = null;
  /** Newest message time per channel seen live since the last refresh. */
  private readonly liveLast = new Map<string, string>();
  /** The newest message each channel had when we last counted its unread messages. */
  private readonly caughtUp = new Map<string, string>();

  constructor(deps: Deps) {
    this.deps = deps;
  }

  onEvent(listener: (e: CommunityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cached(): CommunityView[] {
    return this.communities;
  }

  connectionState(): 'online' | 'offline' | 'connecting' {
    return this.socketState;
  }

  /** Used by notifications: brings a channel to the front. */
  focusChannel(communityId: string, channelId: string): void {
    this.emit({ t: 'focusChannel', communityId, channelId });
  }

  channelName(channelId: string): string | null {
    for (const c of this.communities) {
      const ch = c.channels.find((x) => x.id === channelId);
      if (ch) return ch.name;
    }
    return null;
  }

  // ---- Server access -------------------------------------------------------------------------

  private server(): string {
    const s = this.deps.account.status();
    if (s.state !== 'registered') throw new CommunityError('Create an account first.');
    return s.serverUrl;
  }

  private async token(): Promise<string> {
    let token = this.deps.account.sessionToken();
    if (!token) {
      await this.deps.account.connect();
      token = this.deps.account.sessionToken();
    }
    if (!token) throw new CommunityError('Not connected to your River server.');
    return token;
  }

  /** Every realtime event from the server (used by direct messages). */
  onServerEvent(listener: (e: ServerEvent) => void): () => void {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  /** The identity key a member published in a community profile (sealed with the community key). */
  communityIdentityKey(riverId: string): string | null {
    return this.profileKeys.get(riverId) ?? null;
  }

  /** What other members know about a person from shared communities. */
  knownProfile(riverId: string): { name: string; avatar: string | null } | null {
    for (const c of this.communities) {
      const m = c.members.find((x) => x.riverId === riverId);
      if (m) return { name: m.name, avatar: m.avatar };
    }
    return null;
  }

  private myIdentityKey(): string | undefined {
    const pk = this.deps.identity.get() ? this.deps.identity.signer()?.publicKey : undefined;
    return pk ? Buffer.from(pk).toString('base64') : undefined;
  }

  // ---- Key epochs ------------------------------------------------------------------------------

  /** Direct messages carry new community keys (set up by DmService). */
  setKeyChannel(channel: { send(peer: string, message: KeyMessage): Promise<void> }): void {
    this.keyChannel = channel;
  }

  /** The online member with the highest rank (then lowest ID) rotates; avoids everyone trying. */
  private designated(c: CommunityWire, mustHave: number): string[] {
    const view = this.communities.find((x) => x.id === c.id);
    const me = this.me();
    return (view?.members ?? [])
      .filter((m) => m.online || m.riverId === me)
      .filter((m) => m.riverId !== me || this.keys.get(c.id)?.has(mustHave))
      .sort((a, b) => b.rank - a.rank || a.riverId.localeCompare(b.riverId))
      .map((m) => m.riverId);
  }

  private async maintainKeys(c: CommunityWire): Promise<void> {
    const ring = this.keys.get(c.id);
    if (!ring) return;
    if (c.keyEpoch > ring.newest.epoch) {
      await this.requestKey(c);
    } else if (
      c.rotationNeeded &&
      ring.newest.epoch === c.keyEpoch &&
      this.designated(c, c.keyEpoch)[0] === this.me()
    ) {
      await this.rotate(c);
    }
  }

  /**
   * Replaces the community key after someone left or was removed: claim the next
   * epoch on the server (only one member wins), seal our profile with the new key,
   * then hand the key to every remaining member over their libsignal sessions.
   */
  private async rotate(c: CommunityWire): Promise<void> {
    if (this.rotating.has(c.id) || !this.keyChannel) return;
    this.rotating.add(c.id);
    try {
      let epoch: number;
      try {
        epoch = (
          await this.call(`/communities/${c.id}/epoch`, 'POST', { from: c.keyEpoch }, rotateKeyResponseSchema)
        ).epoch;
      } catch {
        return; // someone else rotated first
      }
      const key = newCommunityKey();
      this.storeKey(c.id, key, epoch);
      await this.publishProfile(c.id);
      const me = this.me();
      for (const m of c.members) {
        if (m.riverId === me) continue;
        await this.keyChannel
          .send(m.riverId, { t: 'ckey', communityId: c.id, epoch, key: key.toString('base64') })
          .catch((err: unknown) =>
            this.deps.log.warn(`Could not deliver a community key: ${(err as Error).message}`),
          );
      }
      await this.refresh();
    } finally {
      this.rotating.delete(c.id);
    }
  }

  /** We are missing the newest key (joined with an older invite, or were offline): ask members. */
  private async requestKey(c: CommunityWire): Promise<void> {
    if (!this.keyChannel) return;
    const tag = `${c.id}:${c.keyEpoch}`;
    if (Date.now() - (this.keyRequests.get(tag) ?? 0) < 30_000) return;
    this.keyRequests.set(tag, Date.now());
    // Give a rotation in progress a moment to deliver the key by itself.
    await new Promise((r) => setTimeout(r, this.keyRequestDelayMs));
    if ((this.keys.get(c.id)?.newest.epoch ?? -1) >= c.keyEpoch) return;
    const me = this.me();
    // Online members first (they answer now); otherwise the request waits in mailboxes.
    const view = this.communities.find((x) => x.id === c.id);
    const targets = [...(view?.members ?? [])]
      .filter((m) => m.riverId !== me)
      .sort(
        (a, b) =>
          Number(b.online) - Number(a.online) || b.rank - a.rank || a.riverId.localeCompare(b.riverId),
      )
      .slice(0, 3)
      .map((m) => m.riverId);
    for (const peer of targets) {
      await this.keyChannel
        .send(peer, { t: 'ckeyReq', communityId: c.id, epoch: c.keyEpoch })
        .catch(() => undefined);
    }
  }

  /** Community key messages arriving over direct messages. Inputs are untrusted. */
  async handleKeyMessage(sender: string, message: KeyMessage): Promise<void> {
    const c = this.wires.get(message.communityId);
    const ring = this.keys.get(message.communityId);
    if (!c || !ring) return;
    const senderMember = c.members.find((m) => m.riverId === sender);
    if (!senderMember || !this.keyChannel) return;
    if (message.t === 'ckey') {
      if (ring.has(message.epoch)) return;
      const key = Buffer.from(message.key, 'base64');
      if (key.length !== 32) return;
      // Accept a key only for an epoch the server has reached, and only if the sender's
      // current profile is sealed with it (so a member cannot slip in a key nobody uses).
      await this.refresh().catch(() => undefined);
      const fresh = this.wires.get(message.communityId);
      const freshSender = fresh?.members.find((m) => m.riverId === sender);
      if (!fresh || !freshSender || message.epoch > fresh.keyEpoch) return;
      try {
        open(key, message.communityId, 'profile', freshSender.profile);
      } catch {
        return;
      }
      this.storeKey(message.communityId, key, message.epoch);
      await this.refresh().catch(() => undefined);
      return;
    }
    // A key request: answer members who prove they held a genuine key (their profile opens).
    const key = ring.keyFor(message.epoch);
    if (!key) return;
    try {
      ring.open(message.communityId, 'profile', senderMember.profile);
    } catch {
      return;
    }
    const tag = `${sender}:${message.communityId}:${message.epoch}`;
    if (Date.now() - (this.keyAnswers.get(tag) ?? 0) < 60_000) return;
    this.keyAnswers.set(tag, Date.now());
    // Our profile must be sealed with the newest key for the requester to verify it.
    if (ring.newest.epoch === message.epoch)
      await this.publishProfile(message.communityId).catch(() => undefined);
    await this.keyChannel.send(sender, {
      t: 'ckey',
      communityId: message.communityId,
      epoch: message.epoch,
      key: key.toString('base64'),
    });
  }

  private iceCache: { servers: RTCIceServerLike[]; until: number } | null = null;

  /** TURN relays from our server (short-lived credentials), cached for half their lifetime. */
  async iceServers(): Promise<RTCIceServerLike[]> {
    if (this.iceCache && this.iceCache.until > Date.now()) return this.iceCache.servers;
    try {
      const res = await this.call('/turn', 'GET', undefined, iceServersResponseSchema);
      this.iceCache = { servers: res.iceServers, until: Date.now() + (res.ttl * 1000) / 2 };
      return res.iceServers;
    } catch {
      return [];
    }
  }

  /** Authenticated API call with one re-login on an expired session. */
  api<T>(path: string, method: Method, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.call(path, method, body, schema);
  }

  private async call<T>(path: string, method: Method, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const url = `${this.server()}${API_PREFIX}${path}`;
    const payload = body === undefined && (method === 'PUT' || method === 'POST') ? {} : body;
    try {
      return await this.deps.requestJson(url, { method, body: payload, token: await this.token() }, schema);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await this.deps.account.connect(); // session expired: one fresh login, one retry
        return this.deps.requestJson(url, { method, body: payload, token: await this.token() }, schema);
      }
      return explain(err);
    }
  }

  private db(): LocalDatabase {
    const db = this.deps.db();
    if (!db) throw new CommunityError('River is locked.');
    return db;
  }

  private loadKeys(): void {
    const rows = this.db().prepare('SELECT community_id, epoch, key FROM community_keys').all() as Array<{
      community_id: string;
      epoch: number;
      key: Uint8Array;
    }>;
    const grouped = new Map<string, Array<{ epoch: number; key: Buffer }>>();
    for (const r of rows) {
      const list = grouped.get(r.community_id) ?? [];
      list.push({ epoch: r.epoch, key: Buffer.from(r.key) });
      grouped.set(r.community_id, list);
    }
    this.keys.clear();
    for (const [id, list] of grouped) this.keys.set(id, new KeyRing(list));
  }

  private me(): string {
    return this.deps.identity.get()?.riverId ?? '';
  }

  private myName(): string | null {
    return this.deps.identity.get()?.displayName ?? null;
  }

  private myAvatar(): string | null {
    const db = this.deps.db();
    if (!db) return null;
    const row = db.prepare('SELECT avatar FROM profile WHERE id = 1').get() as
      { avatar: string | null } | undefined;
    return row?.avatar ?? null;
  }

  private sealedProfile(communityId: string): string {
    const profile: SealedProfile = {
      name: this.myName(),
      avatar: this.myAvatar(),
      identityKey: this.myIdentityKey(),
    };
    return seal(this.requireKey(communityId), communityId, 'profile', profile);
  }

  // ---- Decryption ----------------------------------------------------------------------------

  private view(c: CommunityWire): CommunityView | null {
    const ring = this.keys.get(c.id);
    if (!ring) return null;
    const me = this.me();
    let meta: { name: string; description?: string; icon?: unknown };
    try {
      meta = ring.open<{ name: string; description?: string; icon?: unknown }>(c.id, 'meta', c.meta);
    } catch {
      // Sealed with a newer key we have not received yet.
      meta = { name: 'Waiting for the community key…' };
    }
    const ownerId = c.ownerId ?? c.members.find((m) => m.role === 'owner')?.riverId ?? '';
    // Servers before 0.3 have no roles: synthesise @everyone so permissions still make sense.
    const wireRoles = c.roles.length
      ? c.roles
      : [{ id: c.id, name: '', color: 0, permissions: DEFAULT_EVERYONE, position: 0 }];
    const roles: RoleView[] = wireRoles
      .map((r) => {
        const everyone = r.id === c.id;
        let name = everyone ? '@everyone' : 'role';
        let mentionable = false;
        if (!everyone) {
          try {
            const opened = ring.open<{ name: string; mentionable?: unknown }>(c.id, `role:${r.id}`, r.name);
            name = String(opened.name).slice(0, 64);
            mentionable = opened.mentionable === true;
          } catch {
            // keep placeholder
          }
        }
        return {
          id: r.id,
          name,
          color: r.color,
          permissions: r.permissions,
          position: r.position,
          everyone,
          mentionable,
        };
      })
      .sort((a, b) => b.position - a.position);
    const legacyAdmins = new Set(c.members.filter((m) => m.role !== 'member').map((m) => m.riverId));
    const permsOf = (
      riverId: string,
      memberRoles: string[],
      overwrites?: ChannelView['overwrites'],
    ): number => {
      if (!c.roles.length && legacyAdmins.has(riverId)) return 0x7fffffff;
      return computePermissions({
        ownerId,
        everyoneRoleId: c.id,
        roles: wireRoles,
        member: { riverId, roles: memberRoles },
        overwrites,
      });
    };
    const myRoles = c.members.find((m) => m.riverId === me)?.roles ?? [];

    const channels: ChannelView[] = c.channels
      .map((ch) => {
        let name = 'channel';
        let topic = '';
        try {
          const opened = ring.open<{ name: string; topic?: string }>(c.id, `channel:${ch.id}`, ch.name);
          name = String(opened.name).slice(0, 64);
          topic = String(opened.topic ?? '').slice(0, 300);
        } catch {
          // keep placeholder for undecryptable names
        }
        const everyoneOverwrite = ch.overwrites.find((o) => o.roleId === c.id);
        return {
          id: ch.id,
          kind: ch.kind,
          name,
          topic,
          position: ch.position,
          overwrites: ch.overwrites,
          permissions: permsOf(me, myRoles, ch.overwrites),
          private: !!everyoneOverwrite && (everyoneOverwrite.deny & Permission.VIEW_CHANNELS) !== 0,
          parentId: ch.parentId,
          unread: this.isUnread(ch.id, ch.lastMessageAt),
          lastReadAt: this.readMarkers().get(ch.id) ?? null,
        };
      })
      .sort((a, b) => a.position - b.position);
    const categories: CategoryView[] = c.categories
      .map((k) => {
        let name = 'Category';
        try {
          name = String(ring.open<{ name: string }>(c.id, `category:${k.id}`, k.name).name).slice(0, 64);
        } catch {
          // keep placeholder for undecryptable names
        }
        return { id: k.id, name, position: k.position };
      })
      .sort((a, b) => a.position - b.position);

    const members: MemberView[] = c.members.map((m) => {
      let profile: SealedProfile = { name: null };
      try {
        profile = ring.open<SealedProfile>(c.id, 'profile', m.profile);
      } catch {
        // unreadable profile
      }
      const name = profile.name ? String(profile.name).slice(0, 64) : `Member ${m.riverId.slice(0, 4)}`;
      this.knownNames.set(m.riverId, name);
      if (
        typeof profile.identityKey === 'string' &&
        /^[A-Za-z0-9+/]{43}[A-Za-z0-9+/=]=?$/.test(profile.identityKey)
      ) {
        this.profileKeys.set(m.riverId, profile.identityKey);
      }
      const avatar =
        typeof profile.avatar === 'string' && AVATAR_RE.test(profile.avatar) ? profile.avatar : null;
      const colored = roles.find((r) => !r.everyone && r.color !== 0 && m.roles.includes(r.id));
      return {
        riverId: m.riverId,
        name,
        avatar,
        roles: m.roles,
        color: colored?.color ?? null,
        online: this.online.get(m.riverId) ?? m.online,
        owner: m.riverId === ownerId,
        rank: topPosition(ownerId, wireRoles, { riverId: m.riverId, roles: m.roles }),
      };
    });

    for (const ch of channels) this.channelToCommunity.set(ch.id, c.id);
    const voice: Record<string, string[]> = {};
    const voiceStates: CommunityView['voiceStates'] = {};
    for (const ch of channels) {
      if (ch.kind !== 'voice') continue;
      voice[ch.id] = this.voice.get(ch.id) ?? [];
      for (const id of voice[ch.id]!) voiceStates[id] = this.voiceStates.get(id) ?? defaultVoiceState();
    }
    return {
      id: c.id,
      name: String(meta.name).slice(0, 64),
      description: String(meta.description ?? '').slice(0, 300),
      icon: communityIconSchema.safeParse(meta.icon).success ? (meta.icon as string) : null,
      ownerId,
      permissions: permsOf(me, myRoles),
      myRank: topPosition(ownerId, wireRoles, { riverId: me, roles: myRoles }),
      roles,
      categories,
      channels,
      members,
      voice,
      voiceStates,
    };
  }

  // ---- Read markers --------------------------------------------------------------------------

  private readMarkers(): Map<string, string> {
    if (!this.reads) {
      const rows = this.db().prepare('SELECT channel_id, read_at FROM channel_reads').all() as Array<{
        channel_id: string;
        read_at: string;
      }>;
      this.reads = new Map(rows.map((r) => [r.channel_id, r.read_at]));
    }
    return this.reads;
  }

  private saveRead(channelId: string, at: string): void {
    this.readMarkers().set(channelId, at);
    this.db()
      .prepare(
        `INSERT INTO channel_reads (channel_id, read_at) VALUES (?, ?)
         ON CONFLICT (channel_id) DO UPDATE SET read_at = excluded.read_at`,
      )
      .run(channelId, at);
  }

  private latest(channelId: string, fromServer: string | null): string | null {
    const live = this.liveLast.get(channelId) ?? null;
    if (!fromServer) return live;
    if (!live) return fromServer;
    return live > fromServer ? live : fromServer;
  }

  /**
   * A channel is unread when its newest message is newer than where you
   * stopped. A channel seen for the first time starts as read, so updating to
   * this version does not light up every old channel.
   */
  private isUnread(channelId: string, lastMessageAt: string | null): boolean {
    const latest = this.latest(channelId, lastMessageAt);
    const read = this.readMarkers().get(channelId);
    if (read === undefined) {
      this.saveRead(channelId, latest ?? new Date(0).toISOString());
      return false;
    }
    return latest !== null && latest > read;
  }

  private markRead(channelId: string): void {
    const wire = [...this.wires.values()].flatMap((w) => w.channels).find((ch) => ch.id === channelId);
    const latest = this.latest(channelId, wire?.lastMessageAt ?? null);
    const now = new Date().toISOString();
    this.saveRead(channelId, latest && latest > now ? latest : now);
    let changed = false;
    this.communities = this.communities.map((c) =>
      c.channels.some((ch) => ch.id === channelId && ch.unread)
        ? {
            ...c,
            channels: c.channels.map((ch) => {
              if (ch.id !== channelId) return ch;
              changed = true;
              return { ...ch, unread: false };
            }),
          }
        : c,
    );
    if (changed) this.emit({ t: 'communities', communities: this.communities });
  }

  private toChat(communityId: string, m: MessageWire): ChatMessage | null {
    const ring = this.keys.get(communityId);
    if (!ring) return null;
    try {
      const opened = ring.openWith<{ text: string; replyTo?: string; attachments?: unknown[] }>(
        communityId,
        `message:${m.channelId}`,
        m.body,
      );
      const body = opened.value;
      const key = opened.key;
      this.messageKeys.set(m.id, key);
      if (this.messageKeys.size > 20_000) this.messageKeys.delete(this.messageKeys.keys().next().value!);
      this.messageSenders.set(m.id, m.sender);
      if (this.messageSenders.size > 20_000)
        this.messageSenders.delete(this.messageSenders.keys().next().value!);
      const community = this.communities.find((c) => c.id === communityId);
      const sender = community?.members.find((x) => x.riverId === m.sender);
      const me = this.me();
      const text = String(body.text ?? '').slice(0, 4000);
      // Only pointers to blobs the server linked to this message, and only well-formed ones.
      const attachments = (Array.isArray(body.attachments) ? body.attachments : []).flatMap((a) => {
        const p = attachmentPointerSchema.safeParse(a);
        return p.success && m.attachments.includes(p.data.id) ? [p.data] : [];
      });
      const reactions = m.reactions.flatMap((r) => {
        try {
          const emoji = String(
            open<{ emoji: string }>(key, communityId, `reaction:${m.id}`, r.emoji).emoji,
          ).slice(0, 32);
          // Only show a reaction whose tag matches its emoji, so nobody can relabel a reaction.
          if (reactionTag(key, communityId, m.id, emoji) !== r.tag) return [];
          return [{ tag: r.tag, emoji, count: r.users.length, mine: r.users.includes(me), users: r.users }];
        } catch {
          return [];
        }
      });
      const replyTo =
        typeof body.replyTo === 'string' && /^[A-Za-z0-9_-]{22}$/.test(body.replyTo) ? body.replyTo : null;
      return {
        id: m.id,
        communityId,
        channelId: m.channelId,
        sender: m.sender,
        senderName: sender?.name ?? `Member ${m.sender.slice(0, 4)}`,
        text,
        sentAt: m.sentAt,
        editedAt: m.editedAt,
        pinned: m.pinned,
        reactions,
        replyTo,
        attachments,
        mentionsMe: m.sender !== me && this.mentions(text, community, m.sender, replyTo ?? undefined),
        mine: m.sender === me,
      };
    } catch {
      return null;
    }
  }

  /**
   * Does this message mention you? By name, through a role you have (when the
   * role is mentionable or the sender may mention everyone), with @everyone or
   * @here (only from people allowed to), or by replying to your message.
   */
  private mentions(
    text: string,
    community: CommunityView | undefined,
    sender: string,
    replyTo?: string,
  ): boolean {
    if (replyTo && this.messageSenders.get(replyTo) === this.me()) return true;
    const lower = text.toLowerCase();
    const senderMember = community?.members.find((m) => m.riverId === sender);
    const senderPerms = senderMember
      ? senderMember.owner
        ? 0x7fffffff
        : (community?.roles ?? [])
            .filter((r) => r.everyone || senderMember.roles.includes(r.id))
            .reduce((p, r) => p | r.permissions, 0)
      : 0;
    const mayMentionAll = (senderPerms & (Permission.MENTION_EVERYONE | Permission.ADMINISTRATOR)) !== 0;
    if (mayMentionAll && /(^|\s)@(everyone|here)\b/.test(lower)) return true;
    const mine = community?.members.find((m) => m.riverId === this.me())?.roles ?? [];
    for (const role of community?.roles ?? []) {
      if (role.everyone || !mine.includes(role.id) || !(role.mentionable || mayMentionAll)) continue;
      if (lower.includes(`@${role.name.toLowerCase()}`)) return true;
    }
    const name = this.myName();
    return !!name && lower.includes(`@${name.toLowerCase()}`);
  }

  // ---- Public API (called via IPC) -----------------------------------------------------------

  async refresh(): Promise<CommunityView[]> {
    this.loadKeys();
    const res = await this.call('/communities', 'GET', undefined, communitiesResponseSchema);
    this.wires.clear();
    for (const c of res.communities) this.wires.set(c.id, c);
    this.communities = res.communities.map((c) => this.view(c)).filter((c): c is CommunityView => c !== null);
    for (const c of res.communities) void this.maintainKeys(c).catch(() => undefined);
    void this.catchUp().catch(() => undefined);
    this.emit({ t: 'communities', communities: this.communities });
    return this.communities;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh().catch(() => undefined);
    }, 150);
  }

  /** Creates a community laid out from a template (see shared/templates.ts). */
  async create(rawName: unknown, templateId?: TemplateId): Promise<CommunityView> {
    const name = nameSchema.parse(rawName);
    const template = templateById(templateId);
    const id = randomId();
    const key = newCommunityKey();
    const groups = template.layout.map((g) => ({
      categoryId: g.category === null ? null : randomId(),
      category: g.category,
      channels: g.channels.map((ch) => ({ ...ch, id: randomId() })),
    }));
    const body = {
      id,
      meta: seal(key, id, 'meta', { name, icon: template.emoji }),
      profile: seal(key, id, 'profile', {
        name: this.myName(),
        avatar: this.myAvatar(),
        identityKey: this.myIdentityKey(),
      }),
      channels: groups.flatMap((g) =>
        g.channels.map((ch) => ({
          id: ch.id,
          kind: ch.kind,
          name: seal(key, id, `channel:${ch.id}`, { name: ch.name }),
        })),
      ),
    };
    await this.call('/communities', 'POST', body, communitySchema);
    this.storeKey(id, key, 0);
    // Categories need the community to exist first; then one layout request files the channels.
    const categorised = groups.filter((g) => g.categoryId !== null);
    if (categorised.length > 0) {
      for (const g of categorised) {
        await this.call(
          `/communities/${id}/categories`,
          'POST',
          { id: g.categoryId, name: seal(key, id, `category:${g.categoryId!}`, { name: g.category! }) },
          z.unknown(),
        );
      }
      await this.call(
        `/communities/${id}/layout`,
        'PUT',
        {
          categories: categorised.map((g, position) => ({ id: g.categoryId!, position })),
          channels: groups
            .flatMap((g) => g.channels.map((ch) => ({ id: ch.id, parentId: g.categoryId })))
            .map((ch, position) => ({ ...ch, position })),
        },
        z.unknown(),
      );
    }
    await this.refresh();
    this.ensureSocket();
    return this.communities.find((c) => c.id === id)!;
  }

  async createChannel(communityId: string, kind: unknown, rawName: unknown): Promise<void> {
    await this.action({
      a: 'createChannel',
      communityId,
      kind: z.enum(['text', 'voice']).parse(kind),
      name: nameSchema.parse(rawName),
    });
  }

  async invite(communityId: string): Promise<string> {
    const { key, epoch } = this.requireRing(communityId).newest;
    // A value only the invite's key opens, so joiners can check the link is intact.
    const check = seal(key, communityId, 'invite', { epoch });
    const res = await this.call(
      `/communities/${communityId}/invites`,
      'POST',
      { check },
      inviteResponseSchema,
    );
    return formatInvite(this.server(), res.code, key, epoch);
  }

  /**
   * Joins via an invite link. If this device has no account yet, it registers
   * on the invite's server first — one paste is all a new member needs.
   */
  async join(rawLink: unknown, ensureAccount: (serverUrl: string) => Promise<void>): Promise<CommunityView> {
    const invite = typeof rawLink === 'string' ? parseInvite(rawLink) : null;
    if (!invite) throw new CommunityError('That is not a valid River invite link.');
    const account = this.deps.account.status();
    if (account.state === 'none') await ensureAccount(invite.serverUrl);
    else if (account.serverUrl !== invite.serverUrl) {
      throw new CommunityError(`Your account is on ${account.server}; this invite is for another server.`);
    }
    // The community ID is only learned from the response, so the real sealed profile follows right after.
    const res = await this.call(
      '/invites/join',
      'POST',
      { code: invite.code, profile: 'AAAA' },
      joinResponseSchema,
    ).catch((err: unknown) => {
      if (err instanceof ApiError && err.code === 'invalid_invite') {
        throw new CommunityError('This invite has expired or was already used too many times.');
      }
      throw err;
    });
    // Verify the key from the link actually belongs to this community before trusting it.
    let epoch = invite.epoch;
    try {
      if (res.inviteCheck)
        epoch = open<{ epoch: number }>(invite.key, res.id, 'invite', res.inviteCheck).epoch;
      else open(invite.key, res.id, 'meta', res.meta);
    } catch {
      throw new CommunityError('This invite link is damaged: its key does not match the community.');
    }
    if (!Number.isInteger(epoch) || epoch < 0) epoch = 0;
    this.storeKey(res.id, invite.key, epoch);
    await this.publishProfile(res.id);
    await this.refresh();
    this.ensureSocket();
    return this.communities.find((c) => c.id === res.id)!;
  }

  private profilesRepublished = false;

  /**
   * Once per start, republish our sealed profile everywhere so every community
   * carries our current name, avatar and identity key (older versions did not
   * include the key).
   */
  private async republishProfilesOnce(): Promise<void> {
    if (this.profilesRepublished) return;
    this.profilesRepublished = true;
    for (const c of this.communities) await this.publishProfile(c.id).catch(() => undefined);
  }

  /** (Re)publishes our sealed name and avatar to a community. */
  private async publishProfile(communityId: string): Promise<void> {
    await this.call(
      `/communities/${communityId}/profile`,
      'POST',
      { profile: this.sealedProfile(communityId) },
      z.unknown(),
    );
  }

  profile(): { name: string; avatar: string | null } {
    return { name: this.myName() ?? '', avatar: this.myAvatar() };
  }

  /**
   * Counts unread messages and mentions in channels that changed since you last
   * read them — messages that arrived while River was closed included — by
   * reading the newest page of each (decrypted here, never on the server).
   */
  private async catchUp(): Promise<void> {
    const reads = this.readMarkers();
    const unread: Record<string, number> = {};
    const mentions: Record<string, number> = {};
    const due = this.communities
      .flatMap((c) => c.channels)
      .filter((ch) => {
        if (ch.kind !== 'text' || !ch.unread) return false;
        const latest = this.latest(ch.id, this.wireChannel(ch.id)?.lastMessageAt ?? null);
        return latest !== null && this.caughtUp.get(ch.id) !== latest;
      })
      .slice(0, 25);
    for (const ch of due) {
      const read = reads.get(ch.id) ?? '';
      const page = await this.messages(ch.id).catch(() => []);
      const fresh = page.filter((m) => !m.mine && m.sentAt > read);
      unread[ch.id] = fresh.length;
      mentions[ch.id] = fresh.filter((m) => m.mentionsMe).length;
      const latest = this.latest(ch.id, this.wireChannel(ch.id)?.lastMessageAt ?? null);
      if (latest) this.caughtUp.set(ch.id, latest);
    }
    if (due.length) this.emit({ t: 'catchUp', unread, mentions });
  }

  private wireChannel(channelId: string): CommunityWire['channels'][number] | undefined {
    for (const w of this.wires.values()) {
      const ch = w.channels.find((c) => c.id === channelId);
      if (ch) return ch;
    }
    return undefined;
  }

  async messages(channelId: string, before?: string): Promise<ChatMessage[]> {
    const communityId = this.communityOf(channelId);
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    const res = await this.call(
      `/channels/${channelId}/messages${query}`,
      'GET',
      undefined,
      messagesResponseSchema,
    );
    for (const m of res.messages) this.remember(m.id);
    return res.messages.map((m) => this.toChat(communityId, m)).filter((m): m is ChatMessage => m !== null);
  }

  async send(
    channelId: string,
    rawText: unknown,
    replyTo?: string,
    attachments: AttachmentPointer[] = [],
  ): Promise<ChatMessage> {
    const text = attachments.length ? z.string().max(4000).parse(rawText) : textSchema.parse(rawText);
    const communityId = this.communityOf(channelId);
    const key = this.requireKey(communityId);
    const id = randomId();
    this.remember(id);
    const body = {
      text,
      ...(replyTo ? { replyTo } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
    const sent = await this.call(
      `/channels/${channelId}/messages`,
      'POST',
      {
        id,
        body: seal(key, communityId, `message:${channelId}`, body),
        ...(attachments.length ? { attachments: attachments.map((a) => a.id) } : {}),
      },
      messageSchema,
    );
    // Your own message never makes a channel unread for you.
    if (sent.sentAt > (this.liveLast.get(channelId) ?? '')) this.liveLast.set(channelId, sent.sentAt);
    this.markRead(channelId);
    return this.toChat(communityId, sent)!;
  }

  /** Every other community operation; `raw` comes from the renderer and is validated here. */
  async action<A extends CommunityAction>(raw: A): Promise<CommunityActionResult<A>> {
    const act = communityActionSchema.parse(raw);
    const ok = null as unknown as CommunityActionResult<A>;
    switch (act.a) {
      case 'updateCommunity': {
        const key = this.requireKey(act.communityId);
        const current = this.requireCommunity(act.communityId);
        const icon = act.icon === undefined ? current.icon : act.icon;
        const meta = seal(key, act.communityId, 'meta', {
          name: act.name,
          description: act.description,
          ...(icon ? { icon } : {}),
        });
        await this.call(`/communities/${act.communityId}`, 'PATCH', { meta }, z.unknown());
        break;
      }
      case 'deleteCommunity':
        await this.call(`/communities/${act.communityId}`, 'DELETE', undefined, z.unknown());
        this.forget(act.communityId);
        break;
      case 'leave':
        await this.call(`/communities/${act.communityId}/leave`, 'POST', {}, z.unknown());
        this.forget(act.communityId);
        break;
      case 'createChannel': {
        const key = this.requireKey(act.communityId);
        const id = randomId();
        const community = this.requireCommunity(act.communityId);
        const overwrites = act.private
          ? [
              { roleId: act.communityId, allow: 0, deny: Permission.VIEW_CHANNELS },
              ...(community.members.find((m) => m.riverId === this.me())?.roles ?? []).map((roleId) => ({
                roleId,
                allow: Permission.VIEW_CHANNELS,
                deny: 0,
              })),
            ]
          : undefined;
        await this.call(
          `/communities/${act.communityId}/channels`,
          'POST',
          {
            id,
            kind: act.kind,
            name: seal(key, act.communityId, `channel:${id}`, { name: act.name, topic: act.topic ?? '' }),
            ...(overwrites ? { overwrites } : {}),
            ...(act.parentId ? { parentId: act.parentId } : {}),
          },
          z.unknown(),
        );
        break;
      }
      case 'updateChannel': {
        const communityId = this.communityOf(act.channelId);
        const current = this.requireCommunity(communityId).channels.find((c) => c.id === act.channelId);
        const body: Record<string, unknown> = {};
        if (act.name !== undefined || act.topic !== undefined) {
          body.name = seal(this.requireKey(communityId), communityId, `channel:${act.channelId}`, {
            name: act.name ?? current?.name ?? 'channel',
            topic: act.topic ?? current?.topic ?? '',
          });
        }
        if (act.overwrites) body.overwrites = act.overwrites;
        await this.call(`/channels/${act.channelId}`, 'PATCH', body, z.unknown());
        break;
      }
      case 'moveChannel': {
        // One step up or down among its neighbours in the sidebar (same kind when there are no categories).
        const community = this.requireCommunity(this.communityOf(act.channelId));
        const groups = sidebarGroups(community.channels, community.categories);
        const group = groups.find((g) => g.channels.some((c) => c.id === act.channelId))!;
        const channel = group.channels.find((c) => c.id === act.channelId)!;
        const peers = community.categories.length
          ? group.channels
          : group.channels.filter((c) => c.kind === channel.kind);
        const target = peers[peers.indexOf(channel) + act.direction];
        if (!target) break;
        const moved = moveInLayout(
          groups,
          channel.id,
          group.category?.id ?? null,
          group.channels.indexOf(target),
        );
        const change = layoutChanges(moved);
        if (change.channels.length || change.categories.length)
          await this.call(`/communities/${community.id}/layout`, 'PUT', change, z.unknown());
        break;
      }
      case 'createCategory': {
        const id = randomId();
        await this.call(
          `/communities/${act.communityId}/categories`,
          'POST',
          {
            id,
            name: seal(this.requireKey(act.communityId), act.communityId, `category:${id}`, {
              name: act.name,
            }),
          },
          z.unknown(),
        );
        await this.refresh();
        return id as CommunityActionResult<A>;
      }
      case 'renameCategory':
        await this.call(
          `/categories/${act.categoryId}`,
          'PATCH',
          {
            name: seal(this.requireKey(act.communityId), act.communityId, `category:${act.categoryId}`, {
              name: act.name,
            }),
          },
          z.unknown(),
        );
        break;
      case 'deleteCategory':
        await this.call(`/categories/${act.categoryId}`, 'DELETE', undefined, z.unknown());
        break;
      case 'layout':
        await this.call(
          `/communities/${act.communityId}/layout`,
          'PUT',
          { categories: act.categories, channels: act.channels },
          z.unknown(),
        );
        break;
      case 'markRead':
        this.markRead(act.channelId);
        return ok;
      case 'deleteChannel':
        await this.call(`/channels/${act.channelId}`, 'DELETE', undefined, z.unknown());
        break;
      case 'createRole': {
        const id = randomId();
        await this.call(
          `/communities/${act.communityId}/roles`,
          'POST',
          {
            id,
            name: seal(this.requireKey(act.communityId), act.communityId, `role:${id}`, {
              name: act.name,
              mentionable: act.mentionable ?? false,
            }),
            color: act.color,
            permissions: act.permissions,
          },
          z.unknown(),
        );
        await this.refresh();
        return id as CommunityActionResult<A>;
      }
      case 'updateRole': {
        const body: Record<string, unknown> = {};
        if (act.name !== undefined || act.mentionable !== undefined) {
          // Name and settings are sealed together, so keep whichever was not changed.
          const current = this.requireCommunity(act.communityId).roles.find((r) => r.id === act.roleId);
          body.name = seal(this.requireKey(act.communityId), act.communityId, `role:${act.roleId}`, {
            name: act.name ?? current?.name ?? 'role',
            mentionable: act.mentionable ?? current?.mentionable ?? false,
          });
        }
        if (act.color !== undefined) body.color = act.color;
        if (act.permissions !== undefined) body.permissions = act.permissions;
        await this.call(`/roles/${act.roleId}`, 'PATCH', body, z.unknown());
        break;
      }
      case 'moveRole': {
        const community = this.requireCommunity(act.communityId);
        const list = community.roles.filter((r) => !r.everyone); // highest first
        const from = list.findIndex((r) => r.id === act.roleId);
        const to = from - act.direction; // direction 1 = up (higher position)
        if (from < 0 || to < 0 || to >= list.length) break;
        [list[from], list[to]] = [list[to]!, list[from]!];
        const count = list.length;
        // Lower roles first, so a role never needs to pass above the mover's own role.
        for (let i = count - 1; i >= 0; i--) {
          const role = list[i]!;
          const position = count - i;
          if (role.position !== position)
            await this.call(`/roles/${role.id}`, 'PATCH', { position }, z.unknown());
        }
        break;
      }
      case 'deleteRole':
        await this.call(`/roles/${act.roleId}`, 'DELETE', undefined, z.unknown());
        break;
      case 'setMemberRoles':
        await this.call(
          `/communities/${act.communityId}/members/${act.riverId}/roles`,
          'PUT',
          { roles: act.roles },
          z.unknown(),
        );
        break;
      case 'kick':
        await this.call(
          `/communities/${act.communityId}/members/${act.riverId}`,
          'DELETE',
          undefined,
          z.unknown(),
        );
        break;
      case 'ban':
        await this.call(`/communities/${act.communityId}/bans/${act.riverId}`, 'PUT', {}, z.unknown());
        break;
      case 'unban':
        await this.call(
          `/communities/${act.communityId}/bans/${act.riverId}`,
          'DELETE',
          undefined,
          z.unknown(),
        );
        break;
      case 'bans': {
        const res = await this.call(
          `/communities/${act.communityId}/bans`,
          'GET',
          undefined,
          bansResponseSchema,
        );
        const bans: BanView[] = res.bans.map((b) => ({
          riverId: b.riverId,
          bannedOn: b.bannedOn,
          name: this.knownNames.get(b.riverId) ?? `Member ${b.riverId.slice(0, 4)}`,
        }));
        return bans as CommunityActionResult<A>;
      }
      case 'send':
        return (await this.send(
          act.channelId,
          act.text,
          act.replyTo,
          act.attachments,
        )) as CommunityActionResult<A>;
      case 'upload':
        return (await this.upload(act)) as CommunityActionResult<A>;
      case 'download':
        return (await this.downloadAttachment(act.pointer)) as CommunityActionResult<A>;
      case 'edit': {
        const communityId = this.communityOf(act.channelId);
        const existing = await this.findMessage(act.channelId, act.messageId);
        const body = seal(this.requireKey(communityId), communityId, `message:${act.channelId}`, {
          text: act.text,
          ...(existing?.replyTo ? { replyTo: existing.replyTo } : {}),
          ...(existing?.attachments.length ? { attachments: existing.attachments } : {}),
        });
        await this.call(`/messages/${act.messageId}`, 'PATCH', { body }, z.unknown());
        break;
      }
      case 'deleteMessage':
        await this.call(`/messages/${act.messageId}`, 'DELETE', undefined, z.unknown());
        break;
      case 'pin':
        await this.call(
          `/messages/${act.messageId}/pin`,
          act.pinned ? 'PUT' : 'DELETE',
          undefined,
          z.unknown(),
        );
        break;
      case 'history':
        return (await this.messages(act.channelId, act.before)) as CommunityActionResult<A>;
      case 'search': {
        // The server cannot search ciphertext: fetch recent history per channel and search it here.
        const community = this.requireCommunity(act.communityId);
        const needle = act.query.toLowerCase();
        const found: ChatMessage[] = [];
        for (const ch of community.channels.filter((c) => c.kind === 'text')) {
          let before: string | undefined;
          for (let page = 0; page < 5; page++) {
            const batch = await this.messages(ch.id, before).catch(() => []);
            found.push(
              ...batch.filter(
                (m) =>
                  m.text.toLowerCase().includes(needle) ||
                  m.attachments.some((a) => a.name.toLowerCase().includes(needle)),
              ),
            );
            if (batch.length < 100) break;
            before = batch[0]!.sentAt;
          }
        }
        return found
          .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
          .slice(0, 100) as CommunityActionResult<A>;
      }
      case 'pins': {
        const communityId = this.communityOf(act.channelId);
        const res = await this.call(
          `/channels/${act.channelId}/messages?pinned=1`,
          'GET',
          undefined,
          messagesResponseSchema,
        );
        return res.messages
          .map((m) => this.toChat(communityId, m))
          .filter((m): m is ChatMessage => m !== null)
          .reverse() as CommunityActionResult<A>;
      }
      case 'react': {
        const communityId = this.communityOf(act.channelId);
        const key = this.messageKeys.get(act.messageId) ?? this.requireKey(communityId);
        const tag = reactionTag(key, communityId, act.messageId, act.emoji);
        if (act.on) {
          const emoji = seal(key, communityId, `reaction:${act.messageId}`, { emoji: act.emoji });
          await this.call(`/messages/${act.messageId}/reactions/${tag}`, 'PUT', { emoji }, z.unknown());
        } else {
          await this.call(`/messages/${act.messageId}/reactions/${tag}`, 'DELETE', undefined, z.unknown());
        }
        break;
      }
      case 'typing':
        this.trySend({ t: 'typing', channelId: act.channelId });
        break;
      case 'voiceState':
        this.trySend({
          t: 'voice.state',
          muted: act.muted,
          deafened: act.deafened,
          streaming: act.streaming,
        });
        break;
      case 'moderateVoice':
        this.sendEvent({
          t: 'voice.moderate',
          target: act.riverId,
          ...(act.serverMuted !== undefined ? { serverMuted: act.serverMuted } : {}),
          ...(act.disconnect ? { disconnect: true } : {}),
        });
        break;
      case 'setProfile': {
        if (act.name !== undefined) this.deps.identity.setDisplayName(act.name);
        if (act.avatar !== undefined) {
          this.db()
            .prepare(
              'INSERT INTO profile (id, avatar) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET avatar = excluded.avatar',
            )
            .run(act.avatar);
        }
        if (this.deps.account.status().state === 'registered') {
          this.loadKeys();
          await Promise.all(this.communities.map((c) => this.publishProfile(c.id).catch(() => undefined)));
          await this.refresh().catch(() => undefined);
        }
        break;
      }
    }
    return ok;
  }

  /** Encrypts a file on this device and uploads only the ciphertext. */
  async upload(
    file: {
      name: string;
      mime: string;
      bytes: Uint8Array;
      width?: number;
      height?: number;
      thumb?: string;
    },
    retain?: 'dm',
  ): Promise<AttachmentPointer> {
    const requestBytes = this.requireBytes();
    const enc = encryptAttachment(file.bytes);
    const url = `${this.server()}${API_PREFIX}/attachments${retain ? `?retain=${retain}` : ''}`;
    const post = async (): Promise<Uint8Array> =>
      requestBytes(url, { method: 'POST', body: enc.blob, token: await this.token(), maxBytes: 4096 });
    let res: Uint8Array;
    try {
      res = await post();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await this.deps.account.connect();
        res = await post();
      } else if (err instanceof ApiError && err.status === 413) {
        throw new CommunityError(`${file.name} is larger than this server allows.`);
      } else return explain(err);
    }
    const { id } = attachmentUploadResponseSchema.parse(JSON.parse(Buffer.from(res).toString('utf8')));
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(file.mime) ? file.mime : 'application/octet-stream';
    const thumb =
      file.thumb && /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(file.thumb)
        ? file.thumb
        : undefined;
    return attachmentPointerSchema.parse({
      id,
      key: Buffer.from(enc.key).toString('base64'),
      digest: Buffer.from(enc.digest).toString('base64'),
      size: enc.size,
      // eslint-disable-next-line no-control-regex -- strips control characters from file names
      name: file.name.replace(/[\u0000-\u001f/\\]/g, '_').slice(0, 255) || 'file',
      mime,
      ...(file.width ? { width: file.width } : {}),
      ...(file.height ? { height: file.height } : {}),
      ...(thumb ? { thumb } : {}),
    });
  }

  /** Downloads, verifies and decrypts an attachment (kept in a small in-memory cache). */
  async downloadAttachment(raw: AttachmentPointer): Promise<Uint8Array> {
    const pointer = attachmentPointerSchema.parse(raw);
    const cached = this.attachmentCache.get(pointer.id);
    if (cached) {
      this.attachmentCache.delete(pointer.id);
      this.attachmentCache.set(pointer.id, cached);
      return cached;
    }
    const blob = await this.fetchBlob(pointer);
    let plain: Uint8Array;
    try {
      plain = decryptAttachment(blob, {
        key: Buffer.from(pointer.key, 'base64'),
        digest: Buffer.from(pointer.digest, 'base64'),
        size: pointer.size,
      });
    } catch {
      throw new CommunityError('This file failed its integrity check and was not opened.');
    }
    const copy = new Uint8Array(plain);
    this.attachmentCache.set(pointer.id, copy);
    this.cacheBytes += copy.byteLength;
    for (const [id, bytes] of this.attachmentCache) {
      if (this.cacheBytes <= 150 * 1024 * 1024) break;
      this.attachmentCache.delete(id);
      this.cacheBytes -= bytes.byteLength;
    }
    return copy;
  }

  /**
   * The encrypted blob, from this device if we kept a copy, otherwise from the
   * server (then kept). Copies stay encrypted with the attachment key, which
   * lives only in the encrypted database — deleting the message makes them
   * unreadable.
   */
  private async fetchBlob(pointer: AttachmentPointer): Promise<Uint8Array> {
    const dir = this.deps.blobDir?.();
    const file = dir ? join(dir, pointer.id) : null;
    if (file) {
      const local = await readFile(file).catch(() => null);
      if (local) return local;
    }
    const requestBytes = this.requireBytes();
    const url = `${this.server()}${API_PREFIX}/attachments/${pointer.id}`;
    const blob = await requestBytes(url, {
      method: 'GET',
      token: await this.token(),
      maxBytes: paddedSize(pointer.size) + 16 + 32 + 16,
    }).catch(explain);
    if (file && dir) {
      await mkdir(dir, { recursive: true }).catch(() => undefined);
      await writeFile(`${file}.part`, blob)
        .then(() => rename(`${file}.part`, file))
        .catch(() => undefined);
    }
    return blob;
  }

  /**
   * Keeps a local (still encrypted) copy of a received file so it outlives the
   * server's retention. Verifies it first so a bad blob is never kept.
   */
  async prefetchAttachment(raw: AttachmentPointer): Promise<void> {
    const pointer = attachmentPointerSchema.parse(raw);
    const dir = this.deps.blobDir?.();
    if (!dir) return;
    if (
      await readFile(join(dir, pointer.id)).then(
        () => true,
        () => false,
      )
    )
      return;
    const blob = await this.fetchBlob(pointer);
    try {
      decryptAttachment(blob, {
        key: Buffer.from(pointer.key, 'base64'),
        digest: Buffer.from(pointer.digest, 'base64'),
        size: pointer.size,
      });
    } catch {
      await rm(join(dir, pointer.id), { force: true });
    }
  }

  private requireBytes(): RequestBytes {
    if (!this.deps.requestBytes) throw new CommunityError('Attachments are not available.');
    return this.deps.requestBytes;
  }

  private async findMessage(channelId: string, messageId: string): Promise<ChatMessage | undefined> {
    return (await this.messages(channelId)).find((m) => m.id === messageId);
  }

  voiceJoin(channelId: string): void {
    this.communityOf(channelId);
    this.sendEvent({ t: 'voice.join', channelId });
  }

  voiceLeave(): void {
    this.sendEvent({ t: 'voice.leave' });
  }

  /** Call signalling (SDP / ICE) sealed with the community key, relayed by the server. */
  signal(to: string, channelId: string, payload: unknown): void {
    const communityId = this.communityOf(channelId);
    const data = seal(this.requireKey(communityId), communityId, `signal:${channelId}`, payload);
    if (data.length > 30_000) throw new CommunityError('Signal too large');
    this.sendEvent({ t: 'signal', to: z.uuid().parse(to), data });
  }

  // ---- Realtime --------------------------------------------------------------------------------

  /** Starts (or keeps) the realtime connection when an account exists. */
  ensureSocket(): void {
    if (this.socket || this.deps.account.status().state !== 'registered') return;
    void this.openSocket();
  }

  stop(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private async openSocket(): Promise<void> {
    this.setSocketState('connecting');
    let token: string;
    let url: string;
    try {
      url = this.server().replace(/^http/, 'ws') + `${API_PREFIX}/ws`;
      token = await this.token();
      if (this.communities.length === 0) await this.refresh().catch(() => undefined);
    } catch {
      this.scheduleReconnect();
      return;
    }
    const socket = (this.deps.createSocket ?? ((u: string) => new WebSocket(u)))(url);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ t: 'auth', token }));
    socket.onmessage = (msg) => {
      try {
        this.handle(serverEventSchema.parse(JSON.parse(String(msg.data))));
      } catch {
        this.deps.log.warn('Ignored malformed realtime event');
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.voice.clear();
      this.voiceStates.clear();
      this.setSocketState('offline');
      this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.setSocketState('offline');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }

  private handle(e: ServerEvent): void {
    for (const l of this.rawListeners) l(e);
    switch (e.t) {
      case 'ready':
        this.backoff = 1000;
        this.setSocketState('online');
        void this.refresh()
          .then(() => this.republishProfilesOnce())
          .catch(() => undefined);
        return;
      case 'message': {
        const isNew = !this.seen.has(e.message.id);
        this.remember(e.message.id);
        if (e.message.sentAt > (this.liveLast.get(e.message.channelId) ?? ''))
          this.liveLast.set(e.message.channelId, e.message.sentAt);
        const chat = this.toChat(e.communityId, e.message);
        if (chat) this.emit({ t: 'message', message: chat, isNew });
        return;
      }
      case 'message.delete':
        this.emit({ t: 'messageDelete', channelId: e.channelId, messageId: e.messageId });
        return;
      case 'member':
      case 'channel':
      case 'community':
        this.scheduleRefresh();
        return;
      case 'removed':
        if (e.reason !== 'left') this.forget(e.communityId);
        this.emit({ t: 'removed', communityId: e.communityId, reason: e.reason });
        this.scheduleRefresh();
        return;
      case 'presence':
        this.online.set(e.riverId, e.online);
        this.communities = this.communities.map((c) => ({
          ...c,
          members: c.members.map((m) => (m.riverId === e.riverId ? { ...m, online: e.online } : m)),
        }));
        this.emit({ t: 'communities', communities: this.communities });
        return;
      case 'voice': {
        this.voice.set(e.channelId, e.participants);
        const states: Record<string, VoiceState> = {};
        for (const id of e.participants) {
          const s = e.states?.[id] ?? this.voiceStates.get(id) ?? defaultVoiceState();
          this.voiceStates.set(id, s);
          states[id] = s;
        }
        this.communities = this.communities.map((c) =>
          c.id === e.communityId
            ? {
                ...c,
                voice: { ...c.voice, [e.channelId]: e.participants },
                voiceStates: { ...c.voiceStates, ...states },
              }
            : c,
        );
        this.emit({
          t: 'voice',
          communityId: e.communityId,
          channelId: e.channelId,
          participants: e.participants,
          states,
        });
        return;
      }
      case 'voice.disconnect':
        this.emit({ t: 'voiceDisconnect' });
        return;
      case 'typing':
        this.emit({ t: 'typing', communityId: e.communityId, channelId: e.channelId, riverId: e.riverId });
        return;
      case 'signal': {
        const communityId = this.channelToCommunity.get(e.channelId);
        const ring = communityId ? this.keys.get(communityId) : undefined;
        if (!communityId || !ring) return;
        try {
          const data = ring.open(communityId, `signal:${e.channelId}`, e.data);
          this.emit({ t: 'signal', from: e.from, channelId: e.channelId, data });
        } catch {
          this.deps.log.warn('Dropped a call signal that failed authentication');
        }
        return;
      }
      default:
        return;
    }
  }

  private sendEvent(event: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new CommunityError('Not connected');
    this.socket.send(JSON.stringify(event));
  }

  /** Best-effort realtime hints (typing, voice state) that may be dropped while offline. */
  private trySend(event: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private setSocketState(state: 'online' | 'offline' | 'connecting'): void {
    if (this.socketState === state) return;
    this.socketState = state;
    this.emit({ t: 'connection', state });
  }

  private emit(e: CommunityEvent): void {
    for (const l of this.listeners) l(e);
  }

  private remember(messageId: string): void {
    this.seen.add(messageId);
    if (this.seen.size > 5000) {
      const first = this.seen.values().next().value;
      if (first) this.seen.delete(first);
    }
  }

  private communityOf(channelId: string): string {
    const communityId = this.channelToCommunity.get(channelId);
    if (!communityId) throw new CommunityError('Unknown channel');
    return communityId;
  }

  private requireCommunity(communityId: string): CommunityView {
    const c = this.communities.find((x) => x.id === communityId);
    if (!c) throw new CommunityError('Unknown community');
    return c;
  }

  /** The newest key of a community: everything new is sealed with it. */
  private requireKey(communityId: string): Buffer {
    return this.requireRing(communityId).newest.key;
  }

  private requireRing(communityId: string): KeyRing {
    if (!this.keys.has(communityId)) this.loadKeys();
    const ring = this.keys.get(communityId);
    if (!ring) throw new CommunityError('Unknown community');
    return ring;
  }

  private storeKey(id: string, key: Buffer, epoch: number): void {
    const now = new Date().toISOString();
    const db = this.db();
    db.prepare('INSERT OR IGNORE INTO communities (id, key, joined_at) VALUES (?, ?, ?)').run(id, key, now);
    db.prepare(
      'INSERT OR IGNORE INTO community_keys (community_id, epoch, key, added_at) VALUES (?, ?, ?, ?)',
    ).run(id, epoch, key, now);
    this.loadKeys();
  }

  /** Drops a community's keys after leaving or being removed. */
  private forget(id: string): void {
    this.deps.db()?.prepare('DELETE FROM community_keys WHERE community_id = ?').run(id);
    this.deps.db()?.prepare('DELETE FROM communities WHERE id = ?').run(id);
    this.keys.delete(id);
    this.wires.delete(id);
    this.communities = this.communities.filter((c) => c.id !== id);
    this.emit({ t: 'communities', communities: this.communities });
  }
}

function defaultVoiceState(): VoiceState {
  return { muted: false, deafened: false, serverMuted: false, streaming: false };
}
