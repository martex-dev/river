import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  API_PREFIX,
  DEFAULT_EVERYONE,
  Permission,
  attachmentUploadResponseSchema,
  iceServersResponseSchema,
  auditResponseSchema,
  TIMEOUT_DENIES,
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
  callRoomSchema,
  emojisResponseSchema,
  reportsResponseSchema,
  soundsResponseSchema,
  stickersResponseSchema,
  invitesResponseSchema,
  notesResponseSchema,
  eventsResponseSchema,
  decodeRelayIn,
  encodeRelayOut,
} from '@river/protocol';
import { z } from 'zod';
import {
  attachmentPointerSchema,
  communityActionSchema,
  type AttachmentPointer,
  type BanView,
  type CommunityAction,
  type CommunityActionResult,
  type EventView,
  type EmojiView,
  type ReportView,
  linkEmbedSchema,
  type SoundView,
  type NoteView,
  type StickerView,
  type InviteView,
  ART_IMAGE,
  MAX_FAVORITE_BYTES,
  MAX_FAVORITE_MEDIA,
  STICKER_IMAGE,
  SOUND_DATA_URL,
  type SavedMessageView,
  EMOJI_NAME,
  type SavedOutgoing,
} from '../../shared/community-actions.ts';
import { layoutChanges, moveChannel as moveInLayout, sidebarGroups } from '../../shared/layout.ts';
import { communityIconSchema, templateById, type TemplateId } from '../../shared/templates.ts';
import { describeAudit } from './audit-text.ts';
import type { ServerLocator } from './server-locator.ts';
import type { PresenceTracker } from '../presence.ts';
import { readPoll, type Poll } from '../../shared/poll.ts';
import { summarizeActivity } from '../../shared/insights.ts';
import { readFilter } from '../../shared/word-filter.ts';
import { hasCriteria, matchesSearch, parseSearch } from '../../shared/search-query.ts';
import type {
  CategoryView,
  ChannelView,
  ChatMessage,
  LinkEmbed,
  CommunityEvent,
  CommunityView,
  MemberView,
  RoleView,
  WebhookView,
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
  /** Finds the server again if its address changes. */
  locator?: ServerLocator;
  /** How this person appears (status and custom status), 1.0.17. */
  presence?: Pick<PresenceTracker, 'status' | 'custom'>;
}

interface SealedProfile {
  /** The member's identity key (base64), so a direct message can detect a server swapping keys. */
  identityKey?: string;
  name: string | null;
  avatar?: string | null;
  /** Custom status (1.0.17), end-to-end encrypted like the rest of the profile. */
  status?: { text?: unknown; emoji?: unknown; until?: unknown };
  /** About me, pronouns, banner colour (1.0.18). */
  bio?: unknown;
  pronouns?: unknown;
  banner?: unknown;
}

/** A custom status from a sealed profile, if valid and not expired. */
export function readCustomStatus(
  raw: SealedProfile['status'],
  now = Date.now(),
): { text: string; emoji: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.slice(0, 128) : '';
  const emoji = typeof raw.emoji === 'string' ? raw.emoji.slice(0, 16) : '';
  if (!text && !emoji) return null;
  if (typeof raw.until === 'string' && Date.parse(raw.until) <= now) return null;
  return { text, emoji };
}

const AVATAR_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

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
/** Call setup held while offline: at most this many, and only this fresh when sent. */
const PENDING_SIGNALS_MAX = 400;
const PENDING_SIGNAL_TTL_MS = 30_000;

/** Forum tags from decrypted data: short, unique strings only (1.0.22). */
function readTags(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().slice(0, 24);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

export class CommunityService {
  private readonly deps: Deps;
  private communities: CommunityView[] = [];
  private readonly keys = new Map<string, KeyRing>();
  /** Raw community records from the server, for key maintenance. */
  private readonly wires = new Map<string, CommunityWire>();
  /** Which key opened each message, so reactions use the same key. */
  private readonly messageKeys = new Map<string, Buffer>();
  /** Webhook ID → { name, key } opened from the community (1.0.32). */
  private readonly webhookKeys = new Map<string, { name: string; key: Buffer }>();
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
  /** Idle / Do Not Disturb from live presence events (undefined: plain online). */
  private readonly statuses = new Map<string, 'idle' | 'dnd' | undefined>();
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
  private offlineSince: number | null = null;
  private lastFollow = 0;
  private retryAt: number | null = null;
  /** The voice channel this app is in, so a reconnect can take the seat back (1.0.16). */
  private activeVoice: string | null = null;
  /** The private call room of a 1:1 call in progress (lets the server relay its voice). */
  private activeRoom: string | null = null;
  private lastVoiceState: {
    muted: boolean;
    deafened: boolean;
    streaming: boolean;
    handRaised?: boolean;
  } | null = null;
  /** Call setup produced while the connection was down; sent once it is back. */
  private pendingSignals: Array<{ event: unknown; at: number }> = [];
  private heartbeat: NodeJS.Timeout | null = null;
  private lastHeard = 0;
  /** How often the app pings the server, and how long silence means a dead connection (tests shorten them). */
  heartbeatMs = 20_000;
  deadAfterMs = 50_000;
  private readonly listeners = new Set<(e: CommunityEvent) => void>();
  private readonly relayListeners = new Set<(from: string, payload: Uint8Array) => void>();
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

  /** Relayed voice frames (encrypted end to end by their sender) as they arrive. */
  onRelay(listener: (from: string, payload: Uint8Array) => void): () => void {
    this.relayListeners.add(listener);
    return () => this.relayListeners.delete(listener);
  }

  /**
   * Sends an encrypted voice frame through the server to people in our voice
   * channel we cannot reach directly. Dropped while offline (audio is live).
   */
  relaySend(recipients: string[], payload: Uint8Array): void {
    if (
      (!this.activeVoice && !this.activeRoom) ||
      this.socketState !== 'online' ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    this.socket.send(encodeRelayOut(recipients, payload));
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

  /** The address for links other people open (never this PC's 127.0.0.1). */
  private shareServer(): string {
    const s = this.deps.account.status();
    if (s.state !== 'registered') throw new CommunityError('Create an account first.');
    return s.shareUrl;
  }

  private async token(): Promise<string> {
    let token = this.deps.account.sessionToken();
    if (!token) {
      await this.deps.account.connect();
      token = this.deps.account.sessionToken();
    }
    if (!token) throw new CommunityError("You're offline. River will reconnect by itself.");
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

  /** About me, pronouns and banner colour (1.0.18), shared only inside sealed profiles. */
  private myProfileExtras(): { bio: string; pronouns: string; banner: number | null } {
    const db = this.deps.db();
    const row = db?.prepare('SELECT bio, pronouns, banner FROM profile WHERE id = 1').get() as
      { bio: string | null; pronouns: string | null; banner: number | null } | undefined;
    return { bio: row?.bio ?? '', pronouns: row?.pronouns ?? '', banner: row?.banner ?? null };
  }

  private myAvatar(): string | null {
    const db = this.deps.db();
    if (!db) return null;
    const row = db.prepare('SELECT avatar FROM profile WHERE id = 1').get() as
      { avatar: string | null } | undefined;
    return row?.avatar ?? null;
  }

  /** Your nickname in a community, if you set one. */
  private nickname(communityId: string): string | null {
    const row = this.deps
      .db()
      ?.prepare('SELECT nickname FROM community_nicknames WHERE community_id = ?')
      .get(communityId) as { nickname: string } | undefined;
    return row?.nickname ?? null;
  }

  /** Your picture in a community, if you set one there (1.0.25). */
  private communityAvatar(communityId: string): string | null {
    const row = this.deps
      .db()
      ?.prepare('SELECT avatar FROM community_avatars WHERE community_id = ?')
      .get(communityId) as { avatar: string } | undefined;
    return row?.avatar ?? null;
  }

  private sealedProfile(communityId: string): string {
    const custom = this.deps.presence?.custom() ?? null;
    const extras = this.myProfileExtras();
    const profile: SealedProfile = {
      name: this.nickname(communityId) ?? this.myName(),
      avatar: this.communityAvatar(communityId) ?? this.myAvatar(),
      identityKey: this.myIdentityKey(),
      ...(custom ? { status: custom } : {}),
      ...(extras.bio ? { bio: extras.bio } : {}),
      ...(extras.pronouns ? { pronouns: extras.pronouns } : {}),
      ...(extras.banner !== null ? { banner: extras.banner } : {}),
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
        let hoist = false;
        let icon: string | null = null;
        if (!everyone) {
          try {
            const opened = ring.open<{
              name: string;
              mentionable?: unknown;
              hoist?: unknown;
              icon?: unknown;
            }>(c.id, `role:${r.id}`, r.name);
            name = String(opened.name).slice(0, 64);
            mentionable = opened.mentionable === true;
            // Roles from before 1.0.6 have no flag: keep showing them separately, as they were.
            hoist = opened.hoist !== false;
            icon = typeof opened.icon === 'string' && opened.icon.length <= 16 ? opened.icon : null;
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
          hoist,
          icon,
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
    const myTimeout = c.members.find((m) => m.riverId === me)?.timeoutUntil;
    const myPending = !!c.screening && !!c.members.find((m) => m.riverId === me)?.pending && me !== ownerId;
    const timedOut = !!myTimeout && Date.parse(myTimeout) > Date.now() && me !== ownerId;
    const permsOfMe = (overwrites?: ChannelView['overwrites'], announcement = false): number => {
      let p = permsOf(me, myRoles, overwrites);
      // Same rule as the server: until you accept the rules, you can only look around.
      if (myPending && !(p & Permission.ADMINISTRATOR)) return p & Permission.VIEW_CHANNELS;
      if (timedOut && !(p & Permission.ADMINISTRATOR)) p &= ~TIMEOUT_DENIES;
      // Same rule as the server: announcement channels are for people who manage messages.
      if (announcement && !(p & Permission.MANAGE_MESSAGES)) p &= ~Permission.SEND_MESSAGES;
      return p;
    };

    const channels: ChannelView[] = c.channels
      .map((ch) => {
        let name = 'channel';
        let topic = '';
        let tags: string[] = [];
        let media = false;
        let nsfw = false;
        try {
          const opened = ring.open<{
            name: string;
            topic?: string;
            tags?: unknown;
            media?: unknown;
            nsfw?: unknown;
          }>(c.id, `channel:${ch.id}`, ch.name);
          name = String(opened.name).slice(0, 64);
          topic = String(opened.topic ?? '').slice(0, 300);
          tags = readTags(opened.tags, 20);
          media = opened.media === true;
          nsfw = opened.nsfw === true;
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
          permissions: permsOfMe(ch.overwrites, ch.announcement),
          private: !!everyoneOverwrite && (everyoneOverwrite.deny & Permission.VIEW_CHANNELS) !== 0,
          parentId: ch.parentId,
          unread: this.isUnread(ch.id, ch.lastMessageAt),
          lastReadAt: this.readMarkers().get(ch.id) ?? null,
          synced: ch.synced,
          announcement: ch.announcement,
          slowmode: ch.slowmode,
          userLimit: ch.userLimit,
          ...(ch.kind === 'voice'
            ? {
                prioritySpeakers: c.members
                  .filter(
                    (m) => (permsOf(m.riverId, m.roles, ch.overwrites) & Permission.PRIORITY_SPEAKER) !== 0,
                  )
                  .map((m) => m.riverId),
              }
            : {}),
          forum: ch.forum,
          tags,
          stage: ch.stage,
          ...(media && ch.kind === 'text' ? { media: true } : {}),
          ...(nsfw ? { nsfw: true } : {}),
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
        return { id: k.id, name, position: k.position, overwrites: k.overwrites };
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
      const withIcon = roles.find((r) => !r.everyone && r.icon && m.roles.includes(r.id));
      return {
        riverId: m.riverId,
        name,
        avatar,
        roles: m.roles,
        color: colored?.color ?? null,
        roleIcon: withIcon?.icon ?? null,
        online: this.online.get(m.riverId) ?? m.online,
        ...((): { status?: 'idle' | 'dnd' } => {
          const live = this.statuses.has(m.riverId) ? this.statuses.get(m.riverId) : m.status;
          return live === 'idle' || live === 'dnd' ? { status: live } : {};
        })(),
        customStatus: readCustomStatus(profile.status),
        bio: typeof profile.bio === 'string' ? profile.bio.slice(0, 190) : '',
        pronouns: typeof profile.pronouns === 'string' ? profile.pronouns.slice(0, 40) : '',
        banner:
          typeof profile.banner === 'number' &&
          Number.isInteger(profile.banner) &&
          profile.banner >= 0 &&
          profile.banner <= 0xffffff
            ? profile.banner
            : null,
        owner: m.riverId === ownerId,
        rank: topPosition(ownerId, wireRoles, { riverId: m.riverId, roles: m.roles }),
        timeoutUntil: m.timeoutUntil && Date.parse(m.timeoutUntil) > Date.now() ? m.timeoutUntil : null,
        ...(m.joinedOn ? { joinedOn: m.joinedOn } : {}),
        ...(m.roleExpiry ? { roleExpiry: m.roleExpiry } : {}),
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
      myNickname: this.nickname(c.id),
      myCommunityAvatar: this.communityAvatar(c.id),
      ownerId,
      permissions: permsOfMe(),
      myRank: topPosition(ownerId, wireRoles, { riverId: me, roles: myRoles }),
      roles,
      categories,
      channels,
      members,
      voice,
      voiceStates,
      ...((): Pick<CommunityView, 'rules' | 'welcomeNote' | 'filter'> => {
        if (!c.onboarding) return { rules: [], welcomeNote: '', filter: null };
        try {
          const o = ring.open<{ rules?: unknown; welcome?: unknown; filter?: unknown }>(
            c.id,
            'onboarding',
            c.onboarding,
          );
          return {
            filter: readFilter(o.filter),
            rules: (Array.isArray(o.rules) ? o.rules : [])
              .filter((r): r is string => typeof r === 'string')
              .slice(0, 20)
              .map((r) => r.slice(0, 300)),
            welcomeNote: typeof o.welcome === 'string' ? o.welcome.slice(0, 1000) : '',
          };
        } catch {
          return { rules: [], welcomeNote: '', filter: null };
        }
      })(),
      ...((): Pick<CommunityView, 'art'> => {
        if (!c.art) return {};
        try {
          const a = ring.open<{ icon?: unknown; banner?: unknown }>(c.id, 'art', c.art);
          const ok = (v: unknown): string | null => (typeof v === 'string' && ART_IMAGE.test(v) ? v : null);
          return { art: { icon: ok(a.icon), banner: ok(a.banner) } };
        } catch {
          return {};
        }
      })(),
      ...((): Pick<CommunityView, 'webhooks'> => {
        const hooks = (c.webhooks ?? []).flatMap((w): WebhookView[] => {
          try {
            const o = ring.open<{ name?: unknown; key?: unknown }>(c.id, `webhook:${w.id}`, w.sealed);
            const key = typeof o.key === 'string' ? Buffer.from(o.key, 'base64url') : null;
            if (!key || key.length !== 32) return [];
            const name = String(o.name ?? 'Webhook').slice(0, 40) || 'Webhook';
            this.webhookKeys.set(w.id, { name, key });
            const { sealed: _sealed, ...rest } = w;
            return [{ ...rest, name }];
          } catch {
            return [];
          }
        });
        return hooks.length ? { webhooks: hooks } : {};
      })(),
      screening: c.screening ?? false,
      selfRoles: (c.selfRoles ?? []).filter((id) => roles.some((r) => r.id === id)),
      myPending: myPending,
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
      // A webhook post is sealed with that webhook's key, not the community key (ADR 0004).
      const hook = m.webhook ? this.webhookKeys.get(m.webhook) : undefined;
      if (m.webhook && !hook) return null;
      const openMessage = <T>(): { value: T; key: Buffer } =>
        hook
          ? { value: open<T>(hook.key, communityId, `message:${m.channelId}`, m.body), key: hook.key }
          : ring.openWith<T>(communityId, `message:${m.channelId}`, m.body);
      const opened = openMessage<{
        text: string;
        replyTo?: string;
        noPing?: unknown;
        poll?: unknown;
        attachments?: unknown[];
        alts?: unknown;
        tags?: unknown;
        embed?: unknown;
        sticker?: unknown;
      }>();
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
          ).slice(0, 64);
          // Only show a reaction whose tag matches its emoji, so nobody can relabel a reaction.
          if (reactionTag(key, communityId, m.id, emoji) !== r.tag) return [];
          return [{ tag: r.tag, emoji, count: r.users.length, mine: r.users.includes(me), users: r.users }];
        } catch {
          return [];
        }
      });
      const replyTo =
        typeof body.replyTo === 'string' && /^[A-Za-z0-9_-]{22}$/.test(body.replyTo) ? body.replyTo : null;
      const alts: Record<string, string> = {};
      if (body.alts && typeof body.alts === 'object') {
        for (const a of attachments) {
          const alt = (body.alts as Record<string, unknown>)[a.id];
          if (typeof alt === 'string' && alt.trim()) alts[a.id] = alt.slice(0, 1000);
        }
      }
      return {
        id: m.id,
        communityId,
        channelId: m.channelId,
        sender: m.sender,
        senderName: hook ? hook.name : (sender?.name ?? `Member ${m.sender.slice(0, 4)}`),
        ...(hook ? { webhook: m.webhook! } : {}),
        text,
        poll: readPoll(body.poll),
        sentAt: m.sentAt,
        editedAt: m.editedAt,
        pinned: m.pinned,
        reactions,
        replyTo,
        attachments,
        ...(Object.keys(alts).length ? { alts } : {}),
        ...((): { tags?: string[] } => {
          const tags = readTags(body.tags, 5);
          return tags.length ? { tags } : {};
        })(),
        ...(typeof body.sticker === 'string' && /^[A-Za-z0-9_-]{22}$/.test(body.sticker)
          ? { sticker: body.sticker }
          : {}),
        ...((): { embed?: LinkEmbed } => {
          const e = linkEmbedSchema.safeParse(body.embed);
          // Only a preview of a link that is really in the message.
          return e.success && text.includes(e.data.url) ? { embed: e.data } : {};
        })(),
        // A reply pings the person replied to, unless the sender turned that off.
        mentionsMe:
          m.sender !== me &&
          this.mentions(text, community, m.sender, body.noPing === true ? undefined : (replyTo ?? undefined)),
        mine: m.sender === me && !hook,
        threadId: m.threadId,
        thread: m.thread
          ? {
              name: ((): string => {
                try {
                  return String(
                    open<{ name: string }>(key, communityId, `thread:${m.id}`, m.thread.name).name,
                  ).slice(0, 64);
                } catch {
                  return 'Thread';
                }
              })(),
              count: m.thread.count,
              lastAt: m.thread.lastAt,
              archived: m.thread.archived,
              creator: m.thread.creator,
            }
          : null,
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
    const names = [this.myName(), community ? this.nickname(community.id) : null].filter(
      (n): n is string => !!n,
    );
    return names.some((n) => lower.includes(`@${n.toLowerCase()}`));
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
            .flatMap((g) =>
              g.channels.map((ch) => ({ id: ch.id, parentId: g.categoryId, synced: g.categoryId !== null })),
            )
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
    return formatInvite(this.shareServer(), res.code, key, epoch);
  }

  /**
   * Joins via an invite link. If this device has no account yet, it registers
   * on the invite's server first — one paste is all a new member needs.
   */
  async join(rawLink: unknown, ensureAccount: (serverUrl: string) => Promise<void>): Promise<CommunityView> {
    const invite = typeof rawLink === 'string' ? parseInvite(rawLink) : null;
    if (!invite) throw new CommunityError('That is not a valid River invite link.');
    if (this.deps.account.status().state === 'none') await ensureAccount(invite.serverUrl);
    const account = this.deps.account.status();
    // A server on a home PC changes address when the PC restarts, so an invite may name an old
    // address of your own server. Invite codes are secrets only the server that made them knows:
    // if your server accepts the code, it is the same server.
    const elsewhere = account.state === 'registered' && account.serverUrl !== invite.serverUrl;
    // The community ID is only learned from the response, so the real sealed profile follows right after.
    const res = await this.call(
      '/invites/join',
      'POST',
      { code: invite.code, profile: 'AAAA' },
      joinResponseSchema,
    ).catch((err: unknown) => {
      if (err instanceof ApiError && err.code === 'invalid_invite') {
        throw new CommunityError(
          elsewhere
            ? 'This invite is for a different River server than the one your account is on.'
            : 'This invite has expired or was already used too many times.',
        );
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

  profile(): { name: string; avatar: string | null; bio: string; pronouns: string; banner: number | null } {
    return { name: this.myName() ?? '', avatar: this.myAvatar(), ...this.myProfileExtras() };
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
    threadId?: string,
    noPing = false,
    poll?: Poll,
    alts: Record<string, string> = {},
    post?: { title?: string; tags?: string[] },
    embed?: LinkEmbed,
    sticker?: string,
  ): Promise<ChatMessage> {
    const text =
      attachments.length || sticker ? z.string().max(4000).parse(rawText) : textSchema.parse(rawText);
    const communityId = this.communityOf(channelId);
    const key = this.requireKey(communityId);
    const id = randomId();
    this.remember(id);
    const body = {
      text,
      ...(replyTo ? { replyTo } : {}),
      ...(replyTo && noPing ? { noPing: true } : {}),
      ...(poll ? { poll } : {}),
      ...(post?.tags?.length ? { tags: post.tags } : {}),
      ...(embed ? { embed } : {}),
      ...(sticker ? { sticker } : {}),
      ...(attachments.length ? { attachments } : {}),
      // Kept beside the pointers (not in them) so older Rivers, which reject unknown pointer fields, still
      // show the attachments.
      ...((): { alts?: Record<string, string> } => {
        const kept = Object.fromEntries(
          Object.entries(alts).filter(([id, alt]) => alt && attachments.some((a) => a.id === id)),
        );
        return Object.keys(kept).length ? { alts: kept } : {};
      })(),
    };
    const sent = await this.call(
      `/channels/${channelId}/messages`,
      'POST',
      {
        id,
        body: seal(key, communityId, `message:${channelId}`, body),
        ...(attachments.length ? { attachments: attachments.map((a) => a.id) } : {}),
        ...(threadId ? { threadId } : {}),
        ...(post?.title && !threadId
          ? { thread: { name: seal(key, communityId, `thread:${id}`, { name: post.title }) } }
          : {}),
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
      case 'updateOnboarding':
      case 'updateFilter': {
        const current = this.requireCommunity(act.communityId);
        const rules = act.a === 'updateOnboarding' ? act.rules : current.rules;
        const welcome = act.a === 'updateOnboarding' ? act.welcome.trim() : current.welcomeNote;
        const filter =
          act.a === 'updateFilter'
            ? act.words.length
              ? { words: act.words, mode: act.mode }
              : null
            : (current.filter ?? null);
        const has = rules.length > 0 || welcome.length > 0 || !!filter;
        const onboarding = has
          ? seal(this.requireKey(act.communityId), act.communityId, 'onboarding', {
              rules,
              welcome,
              ...(filter ? { filter } : {}),
            })
          : null;
        const screening =
          act.a === 'updateOnboarding' ? act.screening && act.rules.length > 0 : current.screening;
        const selfRoles = act.a === 'updateOnboarding' ? act.selfRoles : current.selfRoles;
        await this.call(
          `/communities/${act.communityId}/onboarding`,
          'PUT',
          { onboarding, screening, selfRoles },
          z.unknown(),
        ).catch(explain);
        await this.refresh();
        break;
      }
      case 'updateArt': {
        const current = this.requireCommunity(act.communityId).art;
        const icon = act.icon !== undefined ? act.icon : (current?.icon ?? null);
        const banner = act.banner !== undefined ? act.banner : (current?.banner ?? null);
        const art =
          icon || banner
            ? seal(this.requireKey(act.communityId), act.communityId, 'art', {
                ...(icon ? { icon } : {}),
                ...(banner ? { banner } : {}),
              })
            : null;
        await this.call(`/communities/${act.communityId}/art`, 'PUT', { art }, z.unknown()).catch(explain);
        await this.refresh();
        break;
      }
      case 'acceptRules':
        await this.call(`/communities/${act.communityId}/accept`, 'POST', {}, z.unknown()).catch(explain);
        await this.refresh();
        break;
      case 'setSelfRoles':
        await this.call(
          `/communities/${act.communityId}/self-roles`,
          'PUT',
          { roles: act.roles },
          z.unknown(),
        ).catch(explain);
        await this.refresh();
        break;
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
            name: seal(key, act.communityId, `channel:${id}`, {
              name: act.name,
              topic: act.topic ?? '',
              ...(act.media && act.kind === 'text' ? { media: true } : {}),
            }),
            ...(overwrites ? { overwrites } : {}),
            ...(act.parentId ? { parentId: act.parentId } : {}),
            ...(act.forum && act.kind === 'text' ? { forum: true } : {}),
            ...(act.stage && act.kind === 'voice' ? { stage: true } : {}),
          },
          z.unknown(),
        );
        break;
      }
      case 'updateChannel': {
        const communityId = this.communityOf(act.channelId);
        const current = this.requireCommunity(communityId).channels.find((c) => c.id === act.channelId);
        const body: Record<string, unknown> = {};
        if (
          act.name !== undefined ||
          act.topic !== undefined ||
          act.tags !== undefined ||
          act.media !== undefined ||
          act.nsfw !== undefined
        ) {
          const tags = act.tags ?? current?.tags ?? [];
          const media = act.media ?? current?.media ?? false;
          const nsfw = act.nsfw ?? current?.nsfw ?? false;
          body.name = seal(this.requireKey(communityId), communityId, `channel:${act.channelId}`, {
            name: act.name ?? current?.name ?? 'channel',
            topic: act.topic ?? current?.topic ?? '',
            ...(tags.length ? { tags } : {}),
            ...(media ? { media: true } : {}),
            ...(nsfw ? { nsfw: true } : {}),
          });
        }
        if (act.forum !== undefined) body.forum = act.forum;
        if (act.stage !== undefined) body.stage = act.stage;
        if (act.overwrites) body.overwrites = act.overwrites;
        if (act.synced !== undefined) body.synced = act.synced;
        if (act.announcement !== undefined) body.announcement = act.announcement;
        if (act.slowmode !== undefined) body.slowmode = act.slowmode;
        if (act.userLimit !== undefined) body.userLimit = act.userLimit;
        await this.call(`/channels/${act.channelId}`, 'PATCH', body, z.unknown());
        break;
      }
      case 'bulkDelete':
        await this.call(
          `/channels/${act.channelId}/messages/bulk-delete`,
          'POST',
          { ids: act.messageIds },
          z.unknown(),
        ).catch(explain);
        break;
      case 'duplicateChannel': {
        const communityId = this.communityOf(act.channelId);
        // Copy what the server has now, not what this device last saw.
        await this.refresh();
        const source = this.requireCommunity(communityId).channels.find((c) => c.id === act.channelId);
        if (!source) throw new Error('That channel no longer exists.');
        const id = randomId();
        await this.call(
          `/communities/${communityId}/channels`,
          'POST',
          {
            id,
            kind: source.kind,
            name: seal(this.requireKey(communityId), communityId, `channel:${id}`, {
              name: act.name,
              topic: source.topic,
              ...(source.tags.length ? { tags: source.tags } : {}),
              ...(source.media ? { media: true } : {}),
              ...(source.nsfw ? { nsfw: true } : {}),
            }),
            ...(source.forum ? { forum: true } : {}),
            ...(source.stage ? { stage: true } : {}),
            ...(source.synced ? {} : { overwrites: source.overwrites }),
            ...(source.parentId ? { parentId: source.parentId } : {}),
          },
          z.unknown(),
        );
        const settings: Record<string, unknown> = {};
        if (source.announcement) settings.announcement = true;
        if (source.slowmode) settings.slowmode = source.slowmode;
        if (source.userLimit) settings.userLimit = source.userLimit;
        if (Object.keys(settings).length) await this.call(`/channels/${id}`, 'PATCH', settings, z.unknown());
        await this.refresh();
        return id as CommunityActionResult<A>;
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
      case 'categoryPermissions':
        await this.call(
          `/categories/${act.categoryId}`,
          'PATCH',
          { overwrites: act.overwrites },
          z.unknown(),
        );
        break;
      case 'timeout':
        await this.call(
          `/communities/${act.communityId}/members/${act.riverId}/timeout`,
          'PUT',
          { until: act.until },
          z.unknown(),
        );
        break;
      case 'audit': {
        const query = act.before ? `?before=${encodeURIComponent(act.before)}` : '';
        const res = await this.call(
          `/communities/${act.communityId}/audit${query}`,
          'GET',
          undefined,
          auditResponseSchema,
        );
        const community = this.requireCommunity(act.communityId);
        return res.entries.map((e) =>
          describeAudit(e, community, (id) => this.knownNames.get(id)),
        ) as CommunityActionResult<A>;
      }
      case 'outboxSave': {
        const { a: _a, localId, channelId, createdAt, ...payload } = act;
        this.db()
          .prepare(
            'INSERT OR REPLACE INTO outbox (local_id, channel_id, payload, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(localId, channelId, JSON.stringify(payload), createdAt);
        return ok;
      }
      case 'outboxDelete':
        this.db().prepare('DELETE FROM outbox WHERE local_id = ?').run(act.localId);
        return ok;
      case 'outboxList': {
        const rows = this.db()
          .prepare('SELECT local_id, channel_id, payload, created_at FROM outbox ORDER BY created_at')
          .all() as Array<{ local_id: string; channel_id: string; payload: string; created_at: string }>;
        return rows.flatMap((r) => {
          try {
            const p = JSON.parse(r.payload) as Omit<SavedOutgoing, 'localId' | 'channelId' | 'createdAt'>;
            return [{ ...p, localId: r.local_id, channelId: r.channel_id, createdAt: r.created_at }];
          } catch {
            return [];
          }
        }) as CommunityActionResult<A>;
      }
      case 'reconnect':
        this.reconnectNow();
        return ok;
      case 'markUnread': {
        const before = new Date(Date.parse(act.from) - 1).toISOString();
        this.saveRead(act.channelId, before);
        this.communities = this.communities.map((c) =>
          c.channels.some((ch) => ch.id === act.channelId)
            ? {
                ...c,
                channels: c.channels.map((ch) =>
                  ch.id === act.channelId ? { ...ch, unread: true, lastReadAt: before } : ch,
                ),
              }
            : c,
        );
        this.emit({ t: 'communities', communities: this.communities });
        return ok;
      }
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
              hoist: act.hoist ?? false,
              ...(act.icon ? { icon: act.icon } : {}),
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
        if (
          act.name !== undefined ||
          act.mentionable !== undefined ||
          act.hoist !== undefined ||
          act.icon !== undefined
        ) {
          // Name and settings are sealed together, so keep whichever was not changed.
          const current = this.requireCommunity(act.communityId).roles.find((r) => r.id === act.roleId);
          const icon = act.icon !== undefined ? act.icon : (current?.icon ?? null);
          body.name = seal(this.requireKey(act.communityId), act.communityId, `role:${act.roleId}`, {
            name: act.name ?? current?.name ?? 'role',
            mentionable: act.mentionable ?? current?.mentionable ?? false,
            hoist: act.hoist ?? current?.hoist ?? false,
            ...(icon ? { icon } : {}),
          });
        }
        if (act.color !== undefined) body.color = act.color;
        if (act.permissions !== undefined) body.permissions = act.permissions;
        await this.call(`/roles/${act.roleId}`, 'PATCH', body, z.unknown());
        break;
      }
      case 'moveRole':
      case 'placeRole': {
        const community = this.requireCommunity(act.communityId);
        const list = community.roles.filter((r) => !r.everyone); // highest first
        const from = list.findIndex((r) => r.id === act.roleId);
        if (from < 0) break;
        if (act.a === 'moveRole') {
          const to = from - act.direction; // direction 1 = up (higher position)
          if (to < 0 || to >= list.length) break;
          [list[from], list[to]] = [list[to]!, list[from]!];
        } else {
          const [moving] = list.splice(from, 1);
          const at = act.aboveId ? list.findIndex((r) => r.id === act.aboveId) : list.length;
          list.splice(at < 0 ? list.length : at, 0, moving!);
        }
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
      case 'giveTempRole':
        await this.call(
          `/communities/${act.communityId}/members/${act.riverId}/temp-role`,
          'POST',
          { roleId: act.roleId, seconds: act.seconds },
          z.unknown(),
        ).catch(explain);
        await this.refresh();
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
        await this.call(
          `/communities/${act.communityId}/bans/${act.riverId}`,
          'PUT',
          {
            ...(act.deleteMessagesSeconds ? { deleteMessagesSeconds: act.deleteMessagesSeconds } : {}),
            ...(act.durationSeconds ? { durationSeconds: act.durationSeconds } : {}),
          },
          z.unknown(),
        );
        break;
      case 'unban':
        await this.call(
          `/communities/${act.communityId}/bans/${act.riverId}`,
          'DELETE',
          undefined,
          z.unknown(),
        );
        break;
      case 'invites': {
        const community = this.requireCommunity(act.communityId);
        const res = await this.call(
          `/communities/${act.communityId}/invites`,
          'GET',
          undefined,
          invitesResponseSchema,
        ).catch(explain);
        return res.invites.map((i): InviteView => ({
          ...i,
          createdByName: i.createdBy
            ? (community.members.find((m) => m.riverId === i.createdBy)?.name ??
              this.knownNames.get(i.createdBy) ??
              'Someone who left')
            : 'Unknown',
        })) as CommunityActionResult<A>;
      }
      case 'createWebhook': {
        const key = randomBytes(32);
        const token = randomBytes(32).toString('base64url');
        const webhookId = randomId();
        await this.call(
          `/communities/${act.communityId}/webhooks`,
          'POST',
          {
            id: webhookId,
            channelId: act.channelId,
            sealed: seal(this.requireKey(act.communityId), act.communityId, `webhook:${webhookId}`, {
              name: act.name,
              key: key.toString('base64url'),
            }),
            tokenHash: createHash('sha256').update(token).digest('hex'),
          },
          z.unknown(),
        ).catch(explain);
        await this.refresh();
        // The part after # (token and key) is never sent to the server by River or by HTTP clients.
        const secret = new URLSearchParams({
          c: act.communityId,
          ch: act.channelId,
          t: token,
          k: key.toString('base64url'),
        });
        return `${this.shareServer()}${API_PREFIX}/webhooks/${webhookId}#${secret.toString()}` as CommunityActionResult<A>;
      }
      case 'revokeWebhook':
        await this.call(
          `/communities/${act.communityId}/webhooks/${act.webhookId}`,
          'DELETE',
          undefined,
          z.unknown(),
        ).catch(explain);
        await this.refresh();
        break;
      case 'revokeInvite':
        await this.call(
          `/communities/${act.communityId}/invites/${encodeURIComponent(act.inviteId)}`,
          'DELETE',
          undefined,
          z.unknown(),
        ).catch(explain);
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
          until: b.until ?? null,
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
          act.threadId,
          act.noPing,
          act.poll,
          act.alts,
          act.title || act.tags ? { title: act.title, tags: act.tags } : undefined,
          act.embed,
          act.sticker,
        )) as CommunityActionResult<A>;
      case 'createThread': {
        const communityId = this.communityOf(act.channelId);
        await this.call(
          `/messages/${act.messageId}/thread`,
          'POST',
          {
            name: seal(this.requireKey(communityId), communityId, `thread:${act.messageId}`, {
              name: act.name,
            }),
          },
          z.unknown(),
        );
        break;
      }
      case 'updateThread': {
        const communityId = this.communityOf(act.channelId);
        await this.call(
          `/threads/${act.messageId}`,
          'PATCH',
          {
            ...(act.name !== undefined
              ? {
                  name: seal(this.requireKey(communityId), communityId, `thread:${act.messageId}`, {
                    name: act.name,
                  }),
                }
              : {}),
            ...(act.archived !== undefined ? { archived: act.archived } : {}),
          },
          z.unknown(),
        );
        break;
      }
      case 'threadMessages': {
        const communityId = this.communityOf(act.channelId);
        const query = act.before ? `?before=${encodeURIComponent(act.before)}` : '';
        const res = await this.call(
          `/threads/${act.messageId}/messages${query}`,
          'GET',
          undefined,
          messagesResponseSchema,
        );
        for (const m of res.messages) this.remember(m.id);
        return res.messages
          .map((m) => this.toChat(communityId, m))
          .filter((m): m is ChatMessage => m !== null) as CommunityActionResult<A>;
      }
      case 'upload':
        return (await this.upload(act)) as CommunityActionResult<A>;
      case 'download':
        return (await this.downloadAttachment(act.pointer)) as CommunityActionResult<A>;
      case 'favoriteMedia': {
        const p = act.pointer;
        if (!act.on) {
          this.db().prepare('DELETE FROM favorite_media WHERE id = ?').run(p.id);
          break;
        }
        if (!p.mime.startsWith('image/'))
          throw new CommunityError('Only pictures and GIFs can be favourites.');
        if (p.size > MAX_FAVORITE_BYTES)
          throw new CommunityError('That file is too large to keep as a favourite.');
        const count = (this.db().prepare('SELECT COUNT(*) AS n FROM favorite_media').get() as { n: number })
          .n;
        if (count >= MAX_FAVORITE_MEDIA)
          throw new CommunityError(`You can keep up to ${MAX_FAVORITE_MEDIA} favourites.`);
        const bytes = await this.downloadAttachment(p);
        this.db()
          .prepare(
            `INSERT INTO favorite_media (id, name, mime, width, height, bytes, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
          )
          .run(
            p.id,
            p.name.slice(0, 255),
            p.mime,
            p.width ?? null,
            p.height ?? null,
            Buffer.from(bytes),
            new Date().toISOString(),
          );
        break;
      }
      case 'removeFavorite':
        this.db().prepare('DELETE FROM favorite_media WHERE id = ?').run(act.id);
        break;
      case 'favoriteMediaList':
        return (
          this.db()
            .prepare('SELECT id, name, mime, width, height FROM favorite_media ORDER BY added_at DESC')
            .all() as Array<{
            id: string;
            name: string;
            mime: string;
            width: number | null;
            height: number | null;
          }>
        ).map((r) => ({ ...r })) as CommunityActionResult<A>;
      case 'favoriteMediaBytes': {
        const row = this.db().prepare('SELECT bytes FROM favorite_media WHERE id = ?').get(act.id) as
          { bytes: Uint8Array } | undefined;
        if (!row) throw new CommunityError('That favourite is gone.');
        return new Uint8Array(row.bytes) as CommunityActionResult<A>;
      }
      case 'sendFavorite': {
        const row = this.db()
          .prepare('SELECT name, mime, width, height, bytes FROM favorite_media WHERE id = ?')
          .get(act.id) as
          | { name: string; mime: string; width: number | null; height: number | null; bytes: Uint8Array }
          | undefined;
        if (!row) throw new CommunityError('That favourite is gone.');
        // A fresh encrypted copy for this message: attachments are never shared between messages.
        const pointer = await this.upload({
          name: row.name,
          mime: row.mime,
          bytes: new Uint8Array(row.bytes),
          ...(row.width ? { width: row.width } : {}),
          ...(row.height ? { height: row.height } : {}),
        });
        return (await this.send(act.channelId, '', undefined, [pointer])) as CommunityActionResult<A>;
      }
      case 'edit': {
        const communityId = this.communityOf(act.channelId);
        const existing = await this.findMessage(act.channelId, act.messageId);
        if (existing?.poll) throw new CommunityError('Polls cannot be edited.');
        // Seal with the message's own key: its reactions are tagged with it and must keep matching.
        const key = this.messageKeys.get(act.messageId) ?? this.requireKey(communityId);
        const body = seal(key, communityId, `message:${act.channelId}`, {
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
        // The server cannot search ciphertext: fetch history per channel and search it here.
        const community = this.requireCommunity(act.communityId);
        const q = parseSearch(act.query);
        if (!hasCriteria(q)) return [] as ChatMessage[] as CommunityActionResult<A>;
        const found: ChatMessage[] = [];
        const channels = community.channels.filter(
          (c) => c.kind === 'text' && (!q.in.length || q.in.includes(c.name.toLowerCase())),
        );
        for (const ch of channels) {
          // A before: date starts the walk there; an after: date ends it.
          let before: string | undefined = q.before ?? undefined;
          for (let page = 0; page < (q.after || q.before ? 20 : 5); page++) {
            const batch = await this.messages(ch.id, before).catch(() => []);
            found.push(...batch.filter((m) => matchesSearch(m, q, ch.name)));
            if (batch.length < 100) break;
            before = batch[0]!.sentAt;
            if (q.after && before < q.after) break;
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
        this.lastVoiceState = {
          muted: act.muted,
          deafened: act.deafened,
          streaming: act.streaming,
          ...(act.handRaised !== undefined ? { handRaised: act.handRaised } : {}),
        };
        this.trySend({ t: 'voice.state', ...this.lastVoiceState });
        break;
      case 'moderateVoice':
        this.sendEvent({
          t: 'voice.moderate',
          target: act.riverId,
          ...(act.serverMuted !== undefined ? { serverMuted: act.serverMuted } : {}),
          ...(act.serverDeafened !== undefined ? { serverDeafened: act.serverDeafened } : {}),
          ...(act.speaker !== undefined ? { speaker: act.speaker } : {}),
          ...(act.disconnect ? { disconnect: true } : {}),
        });
        break;
      case 'events':
        return (await this.events(act.communityId)) as CommunityActionResult<A>;
      case 'emojis':
        return (await this.emojis(act.communityId)) as CommunityActionResult<A>;
      case 'report': {
        const reportId = randomId();
        const data = seal(this.requireKey(act.communityId), act.communityId, `report:${reportId}`, {
          reason: act.reason,
          text: act.text,
          senderName: act.senderName,
        });
        await this.call(
          `/communities/${act.communityId}/reports`,
          'POST',
          { id: reportId, messageId: act.messageId, data },
          z.unknown(),
        ).catch(explain);
        return reportId as CommunityActionResult<A>;
      }
      case 'reports':
        return (await this.reports(act.communityId)) as CommunityActionResult<A>;
      case 'activity': {
        // Walk each text channel's history back to the start of the period (at most 10 pages each).
        const community = this.requireCommunity(act.communityId);
        const now = new Date();
        const since = new Date(now.getTime() - act.days * 86_400_000).toISOString();
        const seen: Array<{ channelId: string; sender: string; sentAt: string }> = [];
        let partial = false;
        for (const ch of community.channels.filter((c) => c.kind === 'text')) {
          let before: string | undefined;
          for (let page = 0; ; page++) {
            const batch = await this.messages(ch.id, before).catch(() => []);
            for (const m of batch) seen.push({ channelId: m.channelId, sender: m.sender, sentAt: m.sentAt });
            if (batch.length < 100 || batch[0]!.sentAt < since) break;
            if (page === 9) {
              partial = true;
              break;
            }
            before = batch[0]!.sentAt;
          }
        }
        return summarizeActivity(seen, now, act.days, partial) as CommunityActionResult<A>;
      }
      case 'sounds':
        return (await this.sounds(act.communityId)) as CommunityActionResult<A>;
      case 'stickers': {
        const ring = this.keys.get(act.communityId);
        if (!ring) throw new CommunityError('Waiting for the community key…');
        const res = await this.call(
          `/communities/${act.communityId}/stickers`,
          'GET',
          undefined,
          stickersResponseSchema,
        );
        return res.stickers.flatMap((x): StickerView[] => {
          try {
            const d = ring.open<{ name?: unknown; image?: unknown }>(
              act.communityId,
              `sticker:${x.id}`,
              x.data,
            );
            const name = String(d.name ?? '').slice(0, 30);
            const image = String(d.image ?? '');
            return name && STICKER_IMAGE.test(image) ? [{ id: x.id, name, image }] : [];
          } catch {
            return [];
          }
        }) as CommunityActionResult<A>;
      }
      case 'addSticker': {
        const stickerId = randomId();
        const data = seal(this.requireKey(act.communityId), act.communityId, `sticker:${stickerId}`, {
          name: act.name,
          image: act.image,
        });
        await this.call(
          `/communities/${act.communityId}/stickers`,
          'POST',
          { id: stickerId, data },
          z.unknown(),
        ).catch(explain);
        return stickerId as CommunityActionResult<A>;
      }
      case 'deleteSticker':
        await this.call(`/stickers/${act.stickerId}`, 'DELETE', undefined, z.unknown()).catch(explain);
        break;
      case 'notes': {
        const ring = this.keys.get(act.communityId);
        if (!ring) throw new CommunityError('Waiting for the community key…');
        const community = this.requireCommunity(act.communityId);
        const res = await this.call(
          `/communities/${act.communityId}/members/${act.riverId}/notes`,
          'GET',
          undefined,
          notesResponseSchema,
        ).catch(explain);
        return res.notes.map((n): NoteView => {
          let text: string;
          try {
            text = String(
              ring.open<{ text?: unknown }>(act.communityId, `note:${n.id}`, n.data).text ?? '',
            ).slice(0, 1000);
          } catch {
            text = '(cannot be read on this device)';
          }
          return {
            id: n.id,
            author: n.author,
            authorName:
              community.members.find((m) => m.riverId === n.author)?.name ??
              this.knownNames.get(n.author) ??
              'A former moderator',
            text,
            createdAt: n.createdAt,
          };
        }) as CommunityActionResult<A>;
      }
      case 'addNote': {
        const noteId = randomId();
        const data = seal(this.requireKey(act.communityId), act.communityId, `note:${noteId}`, {
          text: act.text,
        });
        await this.call(
          `/communities/${act.communityId}/members/${act.riverId}/notes`,
          'POST',
          { id: noteId, data },
          z.unknown(),
        ).catch(explain);
        return noteId as CommunityActionResult<A>;
      }
      case 'deleteNote':
        await this.call(`/notes/${act.noteId}`, 'DELETE', undefined, z.unknown()).catch(explain);
        break;
      case 'addSound': {
        const soundId = randomId();
        const data = seal(this.requireKey(act.communityId), act.communityId, `sound:${soundId}`, {
          name: act.name,
          emoji: act.emoji,
          audio: act.audio,
        });
        await this.call(
          `/communities/${act.communityId}/sounds`,
          'POST',
          { id: soundId, data },
          z.unknown(),
        ).catch(explain);
        return soundId as CommunityActionResult<A>;
      }
      case 'updateSound': {
        const sound = (await this.sounds(act.communityId)).find((x) => x.id === act.soundId);
        if (!sound) throw new CommunityError('That sound no longer exists.');
        const data = seal(this.requireKey(act.communityId), act.communityId, `sound:${act.soundId}`, {
          name: act.name ?? sound.name,
          emoji: act.emoji !== undefined ? act.emoji : sound.emoji,
          audio: sound.audio,
        });
        await this.call(`/sounds/${act.soundId}`, 'PATCH', { data }, z.unknown()).catch(explain);
        break;
      }
      case 'deleteSound':
        await this.call(`/sounds/${act.soundId}`, 'DELETE', undefined, z.unknown()).catch(explain);
        break;
      case 'playSound':
        this.sendEvent({ t: 'voice.sound', soundId: act.soundId });
        break;
      case 'updateReport':
        await this.call(`/reports/${act.reportId}`, 'PATCH', { status: act.status }, z.unknown()).catch(
          explain,
        );
        break;
      case 'transferOwnership':
        await this.call(
          `/communities/${act.communityId}/transfer`,
          'POST',
          { riverId: act.riverId },
          z.unknown(),
        ).catch(explain);
        await this.refresh();
        break;
      case 'savedMessages':
        return this.savedMessages() as CommunityActionResult<A>;
      case 'saveMessage': {
        if (!act.on) {
          this.db().prepare('DELETE FROM saved_messages WHERE message_id = ?').run(act.messageId);
          break;
        }
        const m = await this.findMessage(act.channelId, act.messageId);
        if (!m) throw new CommunityError('That message is no longer here.');
        this.db()
          .prepare(
            `INSERT INTO saved_messages (message_id, community_id, channel_id, sender_name, text, sent_at, saved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (message_id) DO NOTHING`,
          )
          .run(
            m.id,
            m.communityId,
            m.channelId,
            m.senderName,
            m.text.slice(0, 4000),
            m.sentAt,
            new Date().toISOString(),
          );
        break;
      }
      case 'addEmoji': {
        const existing = await this.emojis(act.communityId);
        if (existing.some((e) => e.name.toLowerCase() === act.name.toLowerCase()))
          throw new CommunityError(`There is already an emoji called :${act.name}:.`);
        const emojiId = randomId();
        const data = seal(this.requireKey(act.communityId), act.communityId, `emoji:${emojiId}`, {
          name: act.name,
          image: act.image,
        });
        await this.call(
          `/communities/${act.communityId}/emojis`,
          'POST',
          { id: emojiId, data },
          z.unknown(),
        ).catch(explain);
        return emojiId as CommunityActionResult<A>;
      }
      case 'renameEmoji': {
        const existing = await this.emojis(act.communityId);
        const emoji = existing.find((e) => e.id === act.emojiId);
        if (!emoji) throw new CommunityError('That emoji no longer exists.');
        if (existing.some((e) => e.id !== act.emojiId && e.name.toLowerCase() === act.name.toLowerCase()))
          throw new CommunityError(`There is already an emoji called :${act.name}:.`);
        const data = seal(this.requireKey(act.communityId), act.communityId, `emoji:${act.emojiId}`, {
          name: act.name,
          image: emoji.image,
        });
        await this.call(`/emojis/${act.emojiId}`, 'PATCH', { data }, z.unknown()).catch(explain);
        break;
      }
      case 'deleteEmoji':
        await this.call(`/emojis/${act.emojiId}`, 'DELETE', undefined, z.unknown()).catch(explain);
        break;
      case 'createEvent': {
        const eventId = randomId();
        await this.call(
          `/communities/${act.communityId}/events`,
          'POST',
          {
            id: eventId,
            data: this.sealEvent(act.communityId, eventId, {
              name: act.name,
              description: act.description,
              place: act.place,
            }),
            startsAt: act.startsAt,
            endsAt: act.endsAt,
            channelId: act.channelId,
          },
          z.unknown(),
        ).catch(explain);
        return eventId as CommunityActionResult<A>;
      }
      case 'updateEvent': {
        const current = [...this.eventCache.values()].flat().find((e) => e.id === act.eventId);
        if (!current) throw new CommunityError('That event no longer exists.');
        const contentChanged =
          act.name !== undefined || act.description !== undefined || act.place !== undefined;
        await this.call(
          `/events/${act.eventId}`,
          'PATCH',
          {
            ...(contentChanged
              ? {
                  data: this.sealEvent(current.communityId, act.eventId, {
                    name: act.name ?? current.name,
                    description: act.description ?? current.description,
                    place: act.place ?? current.place,
                  }),
                }
              : {}),
            ...(act.startsAt ? { startsAt: act.startsAt } : {}),
            ...(act.endsAt ? { endsAt: act.endsAt } : {}),
            ...(act.channelId !== undefined ? { channelId: act.channelId } : {}),
            ...(act.canceled !== undefined ? { canceled: act.canceled } : {}),
          },
          z.unknown(),
        ).catch(explain);
        break;
      }
      case 'deleteEvent':
        await this.call(`/events/${act.eventId}`, 'DELETE', undefined, z.unknown()).catch(explain);
        break;
      case 'eventInterest':
        await this.call(
          `/events/${act.eventId}/interested`,
          act.on ? 'PUT' : 'DELETE',
          undefined,
          z.unknown(),
        ).catch(explain);
        break;
      case 'setNickname': {
        if (act.nickname === null)
          this.db().prepare('DELETE FROM community_nicknames WHERE community_id = ?').run(act.communityId);
        else
          this.db()
            .prepare(
              `INSERT INTO community_nicknames (community_id, nickname) VALUES (?, ?)
               ON CONFLICT (community_id) DO UPDATE SET nickname = excluded.nickname`,
            )
            .run(act.communityId, act.nickname);
        await this.publishProfile(act.communityId);
        await this.refresh().catch(() => undefined);
        break;
      }
      case 'setCommunityAvatar': {
        if (act.avatar === null)
          this.db().prepare('DELETE FROM community_avatars WHERE community_id = ?').run(act.communityId);
        else
          this.db()
            .prepare(
              `INSERT INTO community_avatars (community_id, avatar) VALUES (?, ?)
               ON CONFLICT (community_id) DO UPDATE SET avatar = excluded.avatar`,
            )
            .run(act.communityId, act.avatar);
        await this.publishProfile(act.communityId);
        await this.refresh().catch(() => undefined);
        break;
      }
      case 'setProfile': {
        if (act.name !== undefined) this.deps.identity.setDisplayName(act.name);
        if (act.avatar !== undefined) {
          this.db()
            .prepare(
              'INSERT INTO profile (id, avatar) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET avatar = excluded.avatar',
            )
            .run(act.avatar);
        }
        for (const [column, value] of [
          ['bio', act.bio],
          ['pronouns', act.pronouns],
          ['banner', act.banner],
        ] as const) {
          if (value === undefined) continue;
          this.db()
            .prepare(
              `INSERT INTO profile (id, ${column}) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET ${column} = excluded.${column}`,
            )
            .run(value);
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

  /** A voice join is waiting for the server's answer. */
  private joiningVoice = false;

  voiceJoin(channelId: string): void {
    this.communityOf(channelId);
    this.sendEvent({ t: 'voice.join', channelId });
    this.joiningVoice = true;
    this.activeVoice = channelId;
    // One call at a time: joining a voice channel ends any 1:1 call's relay room.
    if (this.activeRoom) this.callRoom(null);
    this.lastVoiceState = null;
  }

  voiceLeave(): void {
    this.activeVoice = null;
    this.lastVoiceState = null;
    this.pendingSignals = [];
    // Offline: the server frees the seat by itself when the grace period ends.
    this.trySend({ t: 'voice.leave' });
  }

  /** Call signalling (SDP / ICE) sealed with the community key, relayed by the server. */
  signal(to: string, channelId: string, payload: unknown): void {
    const communityId = this.communityOf(channelId);
    const data = seal(this.requireKey(communityId), communityId, `signal:${channelId}`, payload);
    if (data.length > 30_000) throw new CommunityError('Signal too large');
    const event = { t: 'signal', to: z.uuid().parse(to), data };
    if (this.socketState === 'online' && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
      return;
    }
    // The connection is down for a moment (a tunnel reconnecting): hold it, send it on return.
    this.pendingSignals.push({ event, at: Date.now() });
    if (this.pendingSignals.length > PENDING_SIGNALS_MAX) this.pendingSignals.shift();
  }

  /**
   * Status or custom status changed: tell the server how we appear, and
   * republish our sealed profile (which carries the custom status) everywhere.
   */
  async presenceChanged(customChanged: boolean): Promise<void> {
    const status = this.deps.presence?.status();
    if (status) this.trySend({ t: 'presence.set', status });
    if (!customChanged) return;
    for (const c of this.communities) await this.publishProfile(c.id).catch(() => undefined);
  }

  /** Joins (or with null leaves) the private relay room of a 1:1 call. */
  callRoom(room: string | null): void {
    this.activeRoom = room === null ? null : callRoomSchema.parse(room);
    this.trySend({ t: 'call.room', room: this.activeRoom });
  }

  /** After a reconnect: take the voice seat back, restore its state, then send held call setup. */
  private resumeVoice(): void {
    const fresh = this.pendingSignals.filter((p) => Date.now() - p.at < PENDING_SIGNAL_TTL_MS);
    this.pendingSignals = [];
    if (this.activeRoom) this.trySend({ t: 'call.room', room: this.activeRoom });
    if (!this.activeVoice) return;
    this.trySend({ t: 'voice.join', channelId: this.activeVoice });
    if (this.lastVoiceState) this.trySend({ t: 'voice.state', ...this.lastVoiceState });
    for (const p of fresh) this.trySend(p.event);
    this.deps.log.info('voice: rejoined after reconnecting');
  }

  // ---- Saved messages (1.0.19) ----------------------------------------------------------------

  savedMessages(): SavedMessageView[] {
    const rows = (this.deps.db()?.prepare('SELECT * FROM saved_messages ORDER BY saved_at DESC').all() ??
      []) as Array<{
      message_id: string;
      community_id: string;
      channel_id: string;
      sender_name: string;
      text: string;
      sent_at: string;
      saved_at: string;
    }>;
    return rows.map((r) => ({
      messageId: r.message_id,
      communityId: r.community_id,
      channelId: r.channel_id,
      senderName: r.sender_name,
      text: r.text,
      sentAt: r.sent_at,
      savedAt: r.saved_at,
    }));
  }

  // ---- Custom emoji (1.0.19) ------------------------------------------------------------------

  async emojis(communityId: string): Promise<EmojiView[]> {
    const ring = this.keys.get(communityId);
    if (!ring) throw new CommunityError('Waiting for the community key…');
    const res = await this.call(`/communities/${communityId}/emojis`, 'GET', undefined, emojisResponseSchema);
    return res.emojis.flatMap((e): EmojiView[] => {
      try {
        const data = ring.open<{ name?: unknown; image?: unknown }>(communityId, `emoji:${e.id}`, e.data);
        const name = String(data.name ?? '');
        const image = String(data.image ?? '');
        if (!EMOJI_NAME.test(name) || !/^data:image\/(png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(image))
          return [];
        return [{ id: e.id, name, image }];
      } catch {
        return [];
      }
    });
  }

  // ---- Soundboard (1.0.22) -------------------------------------------------------------------

  async sounds(communityId: string): Promise<SoundView[]> {
    const ring = this.keys.get(communityId);
    if (!ring) throw new CommunityError('Waiting for the community key…');
    const res = await this.call(`/communities/${communityId}/sounds`, 'GET', undefined, soundsResponseSchema);
    return res.sounds.flatMap((x): SoundView[] => {
      try {
        const data = ring.open<{ name?: unknown; emoji?: unknown; audio?: unknown }>(
          communityId,
          `sound:${x.id}`,
          x.data,
        );
        const name = String(data.name ?? '').slice(0, 32);
        const emoji = typeof data.emoji === 'string' && data.emoji.length <= 16 ? data.emoji : null;
        const audio = String(data.audio ?? '');
        if (!name.trim() || !SOUND_DATA_URL.test(audio)) return [];
        return [{ id: x.id, name, emoji, audio }];
      } catch {
        return [];
      }
    });
  }

  // ---- Reports (1.0.21) ----------------------------------------------------------------------

  async reports(communityId: string): Promise<ReportView[]> {
    const ring = this.keys.get(communityId);
    if (!ring) throw new CommunityError('Waiting for the community key…');
    const community = this.requireCommunity(communityId);
    const name = (id: string | null): string =>
      id ? (community.members.find((m) => m.riverId === id)?.name ?? 'Someone who left') : '';
    const res = await this.call(
      `/communities/${communityId}/reports`,
      'GET',
      undefined,
      reportsResponseSchema,
    );
    return res.reports.map((r) => {
      let data: { reason?: unknown; text?: unknown; senderName?: unknown } = {};
      try {
        data = ring.open(communityId, `report:${r.id}`, r.data);
      } catch {
        // Sealed with a key this device does not have: show the report without its details.
      }
      return {
        id: r.id,
        channelId: r.channelId,
        messageId: r.messageId,
        reporter: r.reporter,
        reporterName: name(r.reporter),
        target: r.target,
        targetName: name(r.target) || String(data.senderName ?? '').slice(0, 64),
        reason: String(data.reason ?? 'Unreadable').slice(0, 500),
        text: String(data.text ?? '').slice(0, 2000),
        status: r.status,
        resolvedBy: r.resolvedBy,
        resolvedByName: r.resolvedBy ? name(r.resolvedBy) : null,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
      };
    });
  }

  // ---- Scheduled events (1.0.18) ------------------------------------------------------------

  /** Events seen so far, per community, for start reminders. */
  private readonly eventCache = new Map<string, EventView[]>();
  private readonly remindedEvents = new Set<string>();
  private eventTimer: NodeJS.Timeout | null = null;

  async events(communityId: string): Promise<EventView[]> {
    const ring = this.keys.get(communityId);
    if (!ring) throw new CommunityError('Waiting for the community key…');
    const res = await this.call(`/communities/${communityId}/events`, 'GET', undefined, eventsResponseSchema);
    const views = res.events.flatMap((e): EventView[] => {
      try {
        const data = ring.open<{ name?: unknown; description?: unknown; place?: unknown }>(
          communityId,
          `event:${e.id}`,
          e.data,
        );
        return [
          {
            id: e.id,
            communityId,
            createdBy: e.createdBy,
            name: String(data.name ?? '').slice(0, 100) || 'Event',
            description: String(data.description ?? '').slice(0, 1000),
            place: String(data.place ?? '').slice(0, 200),
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            channelId: e.channelId,
            canceled: e.canceled,
            interested: e.interested,
          },
        ];
      } catch {
        return []; // sealed with a key we do not have
      }
    });
    this.eventCache.set(communityId, views);
    this.watchEvents();
    return views;
  }

  private sealEvent(
    communityId: string,
    eventId: string,
    data: { name: string; description: string; place: string },
  ): string {
    return seal(this.requireKey(communityId), communityId, `event:${eventId}`, data);
  }

  /** Every 30 s: tell the app when an event you are interested in starts. */
  private watchEvents(): void {
    if (this.eventTimer) return;
    this.eventTimer = setInterval(() => this.remindEvents(), 30_000);
    this.eventTimer.unref?.();
  }

  remindEvents(now = Date.now()): void {
    const me = this.me();
    for (const list of this.eventCache.values()) {
      for (const e of list) {
        const start = Date.parse(e.startsAt);
        if (e.canceled || this.remindedEvents.has(e.id) || !e.interested.includes(me)) continue;
        // Only right around the start: a reminder an hour late helps nobody.
        if (start <= now && now - start < 5 * 60_000) {
          this.remindedEvents.add(e.id);
          this.emit({
            t: 'eventStarting',
            communityId: e.communityId,
            eventId: e.id,
            name: e.name,
            channelId: e.channelId,
          });
        }
      }
    }
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
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  /** Pings keep tunnels from closing an idle connection and find dead ones fast. */
  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.lastHeard = Date.now();
    this.heartbeat = setInterval(() => {
      if (this.socket !== socket) return this.stopHeartbeat();
      if (Date.now() - this.lastHeard > this.deadAfterMs) {
        this.deps.log.warn('Realtime connection went silent; reconnecting');
        this.dropSocket(socket);
        return;
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'ping' }));
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Treats a connection as gone now (a dead one may take minutes to report closing). */
  private dropSocket(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.stopHeartbeat();
    this.voice.clear();
    this.voiceStates.clear();
    try {
      socket.close();
    } catch {
      // already closing
    }
    this.scheduleReconnect(); // announces "offline" with the time of the next attempt
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
    socket.onopen = () => {
      const status = this.deps.presence?.status();
      socket.send(JSON.stringify({ t: 'auth', token, ...(status ? { status } : {}) }));
      this.startHeartbeat(socket);
    };
    socket.binaryType = 'arraybuffer';
    socket.onmessage = (msg) => {
      if (this.socket === socket) this.lastHeard = Date.now();
      if (msg.data instanceof ArrayBuffer) {
        const frame = decodeRelayIn(new Uint8Array(msg.data));
        if (frame) for (const l of this.relayListeners) l(frame.sender, frame.payload);
        return;
      }
      try {
        this.handle(serverEventSchema.parse(JSON.parse(String(msg.data))));
      } catch {
        this.deps.log.warn('Ignored malformed realtime event');
      }
    };
    socket.onclose = () => this.dropSocket(socket);
    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.offlineSince ??= Date.now();
    // Unreachable for a while: the server may have a new address (a home PC that restarted).
    const now = Date.now();
    if (this.deps.locator && now - this.offlineSince > 15_000 && now - this.lastFollow > 60_000) {
      this.lastFollow = now;
      void this.deps.locator
        .follow()
        .then((moved) => {
          if (!moved) return;
          this.emit({ t: 'serverMoved', url: moved });
          this.reconnectNow();
        })
        .catch(() => undefined);
    }
    // Exponential backoff with ±20% jitter, so many clients don't reconnect in lockstep.
    const delay = Math.round(this.backoff * (0.8 + Math.random() * 0.4));
    this.retryAt = Date.now() + delay;
    this.setSocketState('offline', true);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.retryAt = null;
      this.ensureSocket();
    }, delay);
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }

  /**
   * Try again now: after the network comes back, the computer wakes up, or the
   * user asks. Starts the backoff over.
   */
  reconnectNow(): void {
    if (this.deps.account.status().state !== 'registered') return;
    if (this.socket && this.socketState !== 'offline') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.retryAt = null;
    this.backoff = 1000;
    this.ensureSocket();
  }

  private handle(e: ServerEvent): void {
    for (const l of this.rawListeners) l(e);
    switch (e.t) {
      case 'ready':
        this.backoff = 1000;
        this.offlineSince = null;
        this.setSocketState('online');
        this.resumeVoice();
        void this.deps.locator?.pin().catch(() => undefined);
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
      case 'presence': {
        this.online.set(e.riverId, e.online);
        const status = e.online && e.status && e.status !== 'online' ? e.status : undefined;
        this.statuses.set(e.riverId, status);
        this.communities = this.communities.map((c) => ({
          ...c,
          members: c.members.map((m) => {
            if (m.riverId !== e.riverId) return m;
            const { status: _old, ...rest } = m;
            return { ...rest, online: e.online, ...(status ? { status } : {}) };
          }),
        }));
        this.emit({ t: 'communities', communities: this.communities });
        return;
      }
      case 'voice': {
        if (e.participants.includes(this.me())) this.joiningVoice = false;
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
      case 'events':
        this.emit({ t: 'events', communityId: e.communityId });
        return;
      case 'emojis':
        this.emit({ t: 'emojis', communityId: e.communityId });
        break;
      case 'reports':
        this.emit({ t: 'reports', communityId: e.communityId });
        break;
      case 'sounds':
        this.emit({ t: 'sounds', communityId: e.communityId });
        break;
      case 'stickers':
        this.emit({ t: 'stickers', communityId: e.communityId });
        break;
      case 'voice.sound':
        this.emit({ t: 'voiceSound', communityId: e.communityId, from: e.from, soundId: e.soundId });
        return;
      case 'voice.disconnect':
        this.emit({ t: 'voiceDisconnect' });
        return;
      case 'error':
        if (e.code === 'voice_full') this.emit({ t: 'voiceRefused', reason: 'full' });
        // Servers before 1.0.8 refused a voice join with a plain "forbidden": only count it as one while a
        // join is waiting; otherwise it answers something else (a moderation action, a sound) and must not
        // end the call.
        else if (e.code === 'voice_forbidden' || (e.code === 'forbidden' && this.joiningVoice))
          this.emit({ t: 'voiceRefused', reason: 'forbidden' });
        else if (e.code === 'forbidden') this.emit({ t: 'refused', reason: 'forbidden' });
        else if (e.code === 'slow_down') this.emit({ t: 'refused', reason: 'slow_down' });
        this.joiningVoice = false;
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
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new CommunityError("You're offline");
    this.socket.send(JSON.stringify(event));
  }

  /** Best-effort realtime hints (typing, voice state) that may be dropped while offline. */
  private trySend(event: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private setSocketState(state: 'online' | 'offline' | 'connecting', force = false): void {
    if (this.socketState === state && !force) return;
    this.socketState = state;
    this.emit({
      t: 'connection',
      state,
      ...(state === 'offline' && this.retryAt ? { retryAt: this.retryAt } : {}),
    });
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
  /** After deleting the account: drop every community and its keys from this device. */
  forgetAll(): void {
    for (const c of [...this.communities]) this.forget(c.id);
    for (const row of (this.deps.db()?.prepare('SELECT id FROM communities').all() ?? []) as Array<{
      id: string;
    }>)
      this.forget(row.id);
    this.stop();
  }

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
