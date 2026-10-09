import { randomBytes } from 'node:crypto';
import {
  RiverProtocol,
  SafetyNumberChangedError,
  safetyNumber,
  verify,
  type ProtocolStorage,
  type StoreKind,
} from '@river/crypto';
import {
  deviceListMessage,
  deviceListSchema,
  keyBundleResponseSchema,
  mailboxResponseSchema,
  preKeyCountSchema,
  type EnvelopeWire,
  type ServerEvent,
} from '@river/protocol';
import { z } from 'zod';
import {
  attachmentPointerSchema,
  avatarSchema,
  type AttachmentPointer,
} from '../../shared/community-actions.ts';
import {
  dmActionSchema,
  type ConversationView,
  type DirectMessageView,
  type DmAction,
  type DmActionResult,
  type DmEvent,
  type FileView,
} from '../../shared/dm.ts';
import type { AccountService } from '../account/account-service.ts';
import { CommunityError, type CommunityService } from '../community/community-service.ts';
import { ApiError } from '../http.ts';
import type { IdentityService } from '../identity/identity-service.ts';
import type { Logger } from '../logger.ts';
import type { LocalDatabase } from '../storage/database.ts';

/** What travels inside the libsignal envelope. Everything here is untrusted input when received. */
const msgId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const contentSchema = z.discriminatedUnion('t', [
  z.object({
    v: z.literal(1),
    t: z.literal('msg'),
    id: msgId,
    text: z.string().max(4000),
    replyTo: msgId.optional(),
    attachments: z.array(attachmentPointerSchema).max(10).optional(),
    sentAt: z.iso.datetime(),
    groupId: msgId.optional(),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('edit'),
    id: msgId,
    text: z.string().min(1).max(4000),
    groupId: msgId.optional(),
  }),
  z.object({ v: z.literal(1), t: z.literal('delete'), id: msgId, groupId: msgId.optional() }),
  z.object({
    v: z.literal(1),
    t: z.literal('react'),
    id: msgId,
    emoji: z.string().min(1).max(32),
    on: z.boolean(),
    groupId: msgId.optional(),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('receipt'),
    kind: z.enum(['delivered', 'read']),
    ids: z.array(msgId).max(200),
  }),
  z.object({ v: z.literal(1), t: z.literal('typing'), groupId: msgId.optional() }),
  z.object({
    v: z.literal(1),
    t: z.literal('group'),
    groupId: msgId,
    name: z.string().min(1).max(64),
    members: z.array(z.uuid()).min(1).max(32),
    admins: z.array(z.uuid()).min(1).max(32),
  }),
  z.object({ v: z.literal(1), t: z.literal('groupLeave'), groupId: msgId }),
  z.object({
    v: z.literal(1),
    t: z.literal('ckey'),
    communityId: msgId,
    epoch: z.number().int().min(0).max(1_000_000),
    key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('ckeyReq'),
    communityId: msgId,
    epoch: z.number().int().min(0).max(1_000_000),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('call'),
    callId: msgId,
    kind: z.enum(['invite', 'accept', 'decline', 'end', 'signal', 'busy']),
    video: z.boolean().optional(),
    data: z.unknown().optional(),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('profile'),
    name: z.string().max(64).nullable(),
    avatar: avatarSchema.nullable().optional(),
    bio: z.string().max(300).optional(),
    /** Set when shared only for a group: the receiver records it there, not as a contact. */
    groupId: msgId.optional(),
  }),
  // Social (posts and stories), handled by SocialService.
  z.object({
    v: z.literal(1),
    t: z.literal('post'),
    postId: msgId,
    kind: z.enum(['post', 'story']),
    text: z.string().max(2000),
    attachments: z.array(attachmentPointerSchema).max(10),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().optional(),
  }),
  z.object({ v: z.literal(1), t: z.literal('postDelete'), postId: msgId }),
  z.object({
    v: z.literal(1),
    t: z.literal('postReact'),
    postId: msgId,
    emoji: z.string().min(1).max(32),
    on: z.boolean(),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('postComment'),
    postId: msgId,
    commentId: msgId,
    text: z.string().min(1).max(1000),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('postActivity'),
    postId: msgId,
    comments: z
      .array(
        z.object({
          id: msgId,
          author: z.uuid(),
          authorName: z.string().max(64),
          text: z.string().max(1000),
          createdAt: z.iso.datetime(),
        }),
      )
      .max(300),
    reactions: z.record(z.string().max(32), z.array(z.uuid()).max(1000)),
  }),
  z.object({ v: z.literal(1), t: z.literal('storySeen'), postId: msgId }),
]);
export type SocialContent = Extract<
  z.infer<typeof contentSchema>,
  { t: 'post' | 'postDelete' | 'postReact' | 'postComment' | 'postActivity' | 'storySeen' }
>;
const SOCIAL = new Set(['post', 'postDelete', 'postReact', 'postComment', 'postActivity', 'storySeen']);
type Content = z.infer<typeof contentSchema>;

const MAX_GROUP = 32;
const isGroupId = (id: string): boolean => /^[A-Za-z0-9_-]{22}$/.test(id);

interface GroupRow {
  id: string;
  name: string;
  members: string;
  admins: string;
  profiles: string;
  state: 'accepted' | 'request' | 'left';
  created_at: string;
  last_read: string | null;
}

const PREKEY_TARGET = 100;
const PREKEY_LOW = 25;
const SIGNED_ROTATE_MS = 7 * 24 * 60 * 60 * 1000;

interface Deps {
  db: () => LocalDatabase | null;
  identity: IdentityService;
  account: AccountService;
  community: CommunityService;
  log: Logger;
}

interface MessageRow {
  id: string;
  peer: string;
  sender: string;
  body: string;
  sent_at: string;
  edited_at: string | null;
  deleted: number;
  status: string;
  reactions: string;
}

interface ContactRow {
  river_id: string;
  name: string | null;
  avatar: string | null;
  state: 'accepted' | 'request' | 'blocked';
  created_at: string;
  last_read: string | null;
  key_changed: number;
}

const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

/**
 * End-to-end encrypted direct messages with libsignal. Main-process only:
 * the renderer gets decrypted views and can request only validated actions.
 */
export class DmService {
  private readonly deps: Deps;
  private protocolCache: RiverProtocol | null = null;
  private protocolOwner: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(e: DmEvent) => void>();
  private draining = false;
  private socialHandler: ((peer: string, content: SocialContent) => void) | null = null;
  /** Set after restoring a backup: contacts need new sessions with us. */
  private reintroduce = false;

  constructor(deps: Deps) {
    this.deps = deps;
    deps.community.onServerEvent((e) => this.onServerEvent(e));
    deps.community.setKeyChannel({ send: (peer, message) => this.sendContent(peer, { v: 1, ...message }) });
  }

  onEvent(listener: (e: DmEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Used by notifications: brings a conversation to the front. */
  focus(peer: string): void {
    this.emit({ t: 'focus', peer });
  }

  private emit(e: DmEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** libsignal state changes must never interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private db(): LocalDatabase {
    const db = this.deps.db();
    if (!db) throw new CommunityError('River is locked.');
    return db;
  }

  private me(): string {
    return this.deps.identity.get()?.riverId ?? '';
  }

  private deviceId(): number {
    const s = this.deps.account.status();
    return s.state === 'registered' ? s.deviceId : 1;
  }

  private storage(): ProtocolStorage {
    const db = this.db();
    return {
      get: (kind: StoreKind, id: string) => {
        const row = db.prepare('SELECT value FROM signal_store WHERE kind = ? AND id = ?').get(kind, id) as
          { value: Uint8Array } | undefined;
        return row ? new Uint8Array(row.value) : null;
      },
      put: (kind, id, value) => {
        db.prepare('INSERT OR REPLACE INTO signal_store (kind, id, value) VALUES (?, ?, ?)').run(
          kind,
          id,
          Buffer.from(value),
        );
      },
      delete: (kind, id) => {
        db.prepare('DELETE FROM signal_store WHERE kind = ? AND id = ?').run(kind, id);
      },
      count: (kind) =>
        (db.prepare('SELECT COUNT(*) AS n FROM signal_store WHERE kind = ?').get(kind) as { n: number }).n,
    };
  }

  private protocol(): RiverProtocol {
    const identity = this.deps.identity.protocolIdentity();
    if (!identity) throw new CommunityError('Create your identity first.');
    if (this.protocolCache && this.protocolOwner === identity.riverId) return this.protocolCache;
    const protocol = new RiverProtocol({ ...identity, deviceId: this.deviceId() }, this.storage());
    protocol.onIdentityChanged = (riverId) => {
      this.db().prepare('UPDATE contacts SET key_changed = 1 WHERE river_id = ?').run(riverId);
      this.emitConversations();
    };
    this.protocolCache = protocol;
    this.protocolOwner = identity.riverId;
    return protocol;
  }

  private meta(key: string): string | null {
    const raw = this.storage().get('meta', `dm:${key}`);
    return raw ? Buffer.from(raw).toString('utf8') : null;
  }

  private setMeta(key: string, value: string): void {
    this.storage().put('meta', `dm:${key}`, Buffer.from(value, 'utf8'));
  }

  // ---- realtime --------------------------------------------------------------------------------

  private onServerEvent(e: ServerEvent): void {
    if (e.t === 'ready') {
      void this.ensurePreKeys()
        .then(() => this.drainMailbox())
        .then(() => this.reintroduceIfNeeded())
        .catch((err: unknown) =>
          this.deps.log.warn(`Direct messages unavailable: ${(err as Error).message}`),
        );
    } else if (e.t === 'dm') {
      void this.serial(() => this.receive(e.envelope))
        .then((ok) => (ok ? this.ack([e.envelope.id]) : undefined))
        .catch(() => undefined);
    }
  }

  /** Keeps enough one-time prekeys on the server; rotates the signed prekey weekly. */
  async ensurePreKeys(): Promise<void> {
    await this.serial(async () => {
      const counts = await this.deps.community.api('/keys', 'GET', undefined, preKeyCountSchema);
      const uploaded = this.meta('keysUploaded') === this.me();
      const signedAt = Number(this.meta('signedAt') ?? 0);
      const rotate = !uploaded || Date.now() - signedAt > SIGNED_ROTATE_MS;
      if (uploaded && !rotate && counts.preKeys >= PREKEY_LOW && counts.kyberPreKeys >= PREKEY_LOW) return;
      const oneTime = Math.max(
        0,
        Math.min(100, PREKEY_TARGET - Math.min(counts.preKeys, counts.kyberPreKeys)),
      );
      // A first upload from this install (new, or restored from a backup) replaces whatever
      // prekeys the server still has for this device: their private halves are not here.
      const fresh = !uploaded;
      // One transaction for the hundreds of key writes: separate commits each wait for the
      // disk and froze the app for seconds on slow machines.
      const protocol = this.protocol();
      const upload = this.db().transaction(() =>
        protocol.generatePreKeys({ oneTime: fresh ? PREKEY_TARGET : oneTime, rotate }),
      )();
      await this.deps.community.api(
        '/keys',
        'PUT',
        { ...upload, ...(fresh ? { replaceAll: true } : {}) },
        z.unknown(),
      );
      this.setMeta('keysUploaded', this.me());
      if (rotate) this.setMeta('signedAt', String(Date.now()));
    });
  }

  /** Uploads prekeys if needed and fetches mail that arrived while offline. */
  async sync(): Promise<void> {
    await this.ensurePreKeys();
    await this.drainMailbox();
    await this.reintroduceIfNeeded();
  }

  private async drainMailbox(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let page = 0; page < 50; page++) {
        const box = await this.deps.community.api('/messages', 'GET', undefined, mailboxResponseSchema);
        const done: string[] = [];
        for (const env of box.envelopes) {
          if (await this.serial(() => this.receive(env))) done.push(env.id);
        }
        if (done.length) await this.ack(done);
        if (!box.more) break;
      }
    } finally {
      this.draining = false;
    }
  }

  private async ack(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 200) {
      await this.deps.community.api('/messages/ack', 'POST', { ids: ids.slice(i, i + 200) }, z.unknown());
    }
  }

  /** Decrypts and applies one envelope. Returns true when it can be acknowledged (deleted from the server). */
  private async receive(env: EnvelopeWire): Promise<boolean> {
    if (env.recipientDevice !== this.deviceId()) return false;
    const contact = this.contact(env.sender);
    let content: Content;
    try {
      const plain = await this.protocol().decrypt(env.sender, env.senderDevice, env);
      content = contentSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
    } catch (err) {
      this.deps.log.warn(`Dropped a direct message that could not be decrypted (${(err as Error).name})`);
      return true;
    }
    if (contact?.state === 'blocked') return true;
    const peer = env.sender;
    if (SOCIAL.has(content.t)) {
      this.socialHandler?.(peer, content as SocialContent);
      return true;
    }
    if (content.t === 'ckey' || content.t === 'ckeyReq') {
      // Community key exchange between members; not a conversation.
      const { v: _v, ...message } = content;
      void this.deps.community.handleKeyMessage(peer, message).catch(() => undefined);
      return true;
    }
    const now = new Date();
    if (content.t === 'group') return this.applyGroupUpdate(peer, content);
    if (content.t === 'groupLeave') {
      const g = this.group(content.groupId);
      if (g) {
        this.saveGroup({
          ...g,
          members: JSON.stringify(this.list(g.members).filter((m) => m !== peer)),
          admins: JSON.stringify(this.list(g.admins).filter((m) => m !== peer)),
        });
        this.emitConversations();
      }
      return true;
    }
    if (content.t === 'profile' && content.groupId) {
      const g = this.group(content.groupId);
      if (g && this.list(g.members).includes(peer)) {
        const profiles = JSON.parse(g.profiles) as Record<
          string,
          { name: string | null; avatar: string | null }
        >;
        profiles[peer] = {
          name: content.name ? content.name.slice(0, 64) : null,
          avatar: content.avatar ?? null,
        };
        this.saveGroup({ ...g, profiles: JSON.stringify(profiles) });
        this.emitConversations();
      }
      return true;
    }
    // Group traffic is accepted only from current members of a group we are in.
    const groupId = 'groupId' in content ? content.groupId : undefined;
    let conv = peer;
    if (groupId) {
      const g = this.group(groupId);
      if (!g || g.state === 'left' || !this.list(g.members).includes(peer)) return true;
      conv = groupId;
    }
    switch (content.t) {
      case 'msg': {
        if (!groupId && !contact) this.upsertContact(peer, 'request');
        const claimed = Date.parse(content.sentAt);
        const received = Date.parse(env.receivedAt);
        // A sender's clock may be wrong or lying: keep timestamps near when the server got it.
        const sentAt = new Date(
          Math.min(Math.max(claimed, received - 30 * 86_400_000), received + 60_000) || now.getTime(),
        ).toISOString();
        const exists = this.db().prepare('SELECT 1 FROM dm_messages WHERE id = ?').get(content.id);
        if (exists) return true;
        this.db()
          .prepare(
            `INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions)
             VALUES (?, ?, ?, ?, ?, 'received', '{}')`,
          )
          .run(
            content.id,
            conv,
            peer,
            JSON.stringify({
              text: content.text,
              replyTo: content.replyTo,
              attachments: content.attachments,
            }),
            sentAt,
          );
        this.emitMessage(content.id, true);
        this.emitConversations();
        // Keep our own (encrypted) copies of files before the server's copy expires.
        for (const a of content.attachments ?? []) {
          void this.deps.community.prefetchAttachment(a).catch(() => undefined);
        }
        if (!groupId && this.contact(peer)?.state === 'accepted') {
          void this.sendContent(peer, { v: 1, t: 'receipt', kind: 'delivered', ids: [content.id] }).catch(
            () => undefined,
          );
        }
        return true;
      }
      case 'edit': {
        const row = this.row(content.id);
        if (row && row.peer === conv && row.sender === peer && !row.deleted) {
          const body = JSON.parse(row.body) as Record<string, unknown>;
          this.db()
            .prepare('UPDATE dm_messages SET body = ?, edited_at = ? WHERE id = ?')
            .run(JSON.stringify({ ...body, text: content.text }), now.toISOString(), content.id);
          this.emitMessage(content.id, false);
        }
        return true;
      }
      case 'delete': {
        const row = this.row(content.id);
        if (row && row.peer === conv && row.sender === peer) {
          this.db()
            .prepare(
              `UPDATE dm_messages SET deleted = 1, body = '{"text":""}', reactions = '{}' WHERE id = ?`,
            )
            .run(content.id);
          this.emitMessage(content.id, false);
          this.emitConversations();
        }
        return true;
      }
      case 'react': {
        const row = this.row(content.id);
        if (row && row.peer === conv) this.applyReaction(row, peer, content.emoji, content.on);
        return true;
      }
      case 'receipt': {
        const rank = { sending: 0, failed: 0, sent: 1, delivered: 2, read: 3 } as Record<string, number>;
        for (const id of content.ids) {
          const row = this.row(id);
          if (!row || row.peer !== peer || row.sender !== this.me()) continue;
          if ((rank[content.kind] ?? 0) > (rank[row.status] ?? 0)) {
            this.db().prepare('UPDATE dm_messages SET status = ? WHERE id = ?').run(content.kind, id);
            this.emitMessage(id, false);
          }
        }
        return true;
      }
      case 'typing':
        if (groupId) this.emit({ t: 'typing', peer: conv, who: peer });
        else if (contact?.state === 'accepted') this.emit({ t: 'typing', peer });
        return true;
      case 'call':
        // Only accepted contacts can ring you; call setup is never stored.
        if (contact?.state !== 'accepted') return true;
        if (content.data !== undefined && JSON.stringify(content.data).length > 30_000) return true;
        this.emit({
          t: 'call',
          peer,
          callId: content.callId,
          kind: content.kind,
          video: content.video ?? false,
          ...(content.data !== undefined ? { data: content.data } : {}),
        });
        return true;
      case 'profile': {
        if (!contact) this.upsertContact(peer, 'request');
        this.db()
          .prepare('UPDATE contacts SET name = ?, avatar = ?, bio = ? WHERE river_id = ?')
          .run(
            content.name ? content.name.slice(0, 64) : null,
            content.avatar ?? null,
            content.bio ?? null,
            peer,
          );
        this.emitConversations();
        return true;
      }
      default:
        return true;
    }
  }

  /**
   * After a restore our old sessions are gone (they are never in backups), so
   * message every contact once: our new PreKey message gives them a fresh
   * session with us, and their later messages decrypt again.
   */
  afterRestore(): void {
    this.protocolCache = null;
    this.reintroduce = true;
  }

  private async reintroduceIfNeeded(): Promise<void> {
    if (!this.reintroduce) return;
    this.reintroduce = false;
    const peers = new Set<string>(this.friends());
    for (const g of this.db().prepare(`SELECT members FROM dm_groups WHERE state != 'left'`).all() as Array<{
      members: string;
    }>) {
      for (const m of this.list(g.members)) peers.add(m);
    }
    peers.delete(this.me());
    for (const peer of peers) await this.shareProfile(peer).catch(() => undefined);
  }

  // ---- used by SocialService ----------------------------------------------------------------------

  setSocialHandler(handler: (peer: string, content: SocialContent) => void): void {
    this.socialHandler = handler;
  }

  /** Sends social content to one person (encrypted with their libsignal session). */
  async sendSocial(peer: string, content: SocialContent, ephemeral = false): Promise<void> {
    await this.shareProfile(peer).catch(() => undefined);
    await this.sendContent(peer, content, ephemeral);
  }

  /** People who are accepted contacts (your "friends"). */
  friends(): string[] {
    return (
      this.db().prepare(`SELECT river_id FROM contacts WHERE state = 'accepted'`).all() as Array<{
        river_id: string;
      }>
    ).map((r) => r.river_id);
  }

  contactState(riverId: string): 'accepted' | 'request' | 'blocked' | null {
    return this.contact(riverId)?.state ?? null;
  }

  person(riverId: string): { name: string; avatar: string | null; bio: string } {
    const row = this.db().prepare('SELECT bio FROM contacts WHERE river_id = ?').get(riverId) as
      { bio: string | null } | undefined;
    return {
      name: this.nameOf(riverId),
      avatar: this.avatarOf(riverId),
      bio: riverId === this.me() ? this.myBio() : (row?.bio ?? ''),
    };
  }

  myBio(): string {
    const row = this.deps.db()?.prepare('SELECT bio FROM profile WHERE id = 1').get() as
      { bio: string | null } | undefined;
    return row?.bio ?? '';
  }

  setMyBio(bio: string): void {
    this.db()
      .prepare('INSERT INTO profile (id, bio) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET bio = excluded.bio')
      .run(bio.trim().slice(0, 300));
  }

  /** Keeps local copies of files in received posts. */
  prefetch(attachments: AttachmentPointer[]): void {
    for (const a of attachments) void this.deps.community.prefetchAttachment(a).catch(() => undefined);
  }

  // ---- groups ----------------------------------------------------------------------------------

  private list(json: string): string[] {
    return JSON.parse(json) as string[];
  }

  private group(id: string): GroupRow | undefined {
    return this.db().prepare('SELECT * FROM dm_groups WHERE id = ?').get(id) as GroupRow | undefined;
  }

  private saveGroup(g: GroupRow): void {
    this.db()
      .prepare(
        `INSERT INTO dm_groups (id, name, members, admins, profiles, state, created_at, last_read)
         VALUES (@id, @name, @members, @admins, @profiles, @state, @created_at, @last_read)
         ON CONFLICT(id) DO UPDATE SET name = @name, members = @members, admins = @admins,
           profiles = @profiles, state = @state, last_read = @last_read`,
      )
      .run(g);
  }

  /** Group state from an admin (or a new group that includes us). */
  private applyGroupUpdate(
    sender: string,
    update: { groupId: string; name: string; members: string[]; admins: string[] },
  ): boolean {
    const me = this.me();
    const members = [...new Set(update.members)].slice(0, MAX_GROUP);
    const admins = [...new Set(update.admins)].filter((a) => members.includes(a) || a === sender);
    const existing = this.group(update.groupId);
    if (existing) {
      if (!this.list(existing.admins).includes(sender)) return true;
      const stillIn = members.includes(me);
      this.saveGroup({
        ...existing,
        name: update.name.slice(0, 64),
        members: JSON.stringify(members),
        admins: JSON.stringify(admins),
        state: stillIn ? (existing.state === 'left' ? 'accepted' : existing.state) : 'left',
      });
    } else {
      if (!members.includes(me) || !members.includes(sender) || !admins.includes(sender)) return true;
      if (this.contact(sender)?.state === 'blocked') return true;
      this.saveGroup({
        id: update.groupId,
        name: update.name.slice(0, 64),
        members: JSON.stringify(members),
        admins: JSON.stringify(admins),
        profiles: '{}',
        // Groups started by people you have accepted open directly; others are requests.
        state: this.contact(sender)?.state === 'accepted' ? 'accepted' : 'request',
        created_at: new Date().toISOString(),
        last_read: null,
      });
    }
    this.emitConversations();
    return true;
  }

  /** Sends to a person, or to every other member of a group (pairwise libsignal sessions). */
  private async deliver(conv: string, content: Content, ephemeral = false): Promise<void> {
    if (!isGroupId(conv)) {
      await this.sendContent(conv, content, ephemeral);
      return;
    }
    const g = this.group(conv);
    if (!g || g.state === 'left') throw new CommunityError('You are not in this group.');
    const me = this.me();
    const failed: string[] = [];
    const others = this.list(g.members).filter((m) => m !== me);
    for (const m of others) {
      try {
        if (!ephemeral) await this.shareProfile(m, conv);
        await this.sendContent(m, content, ephemeral);
      } catch {
        failed.push(m);
      }
    }
    if (others.length && failed.length === others.length && !ephemeral) {
      throw new CommunityError('The message could not be delivered to anyone in the group.');
    }
  }

  private async sendGroupState(g: GroupRow, extraRecipients: string[] = []): Promise<void> {
    const me = this.me();
    const recipients = [...new Set([...this.list(g.members), ...extraRecipients])].filter((m) => m !== me);
    const content: Content = {
      v: 1,
      t: 'group',
      groupId: g.id,
      name: g.name,
      members: this.list(g.members),
      admins: this.list(g.admins),
    };
    for (const m of recipients) {
      // The group must exist on their side before our group-scoped profile arrives.
      await this.sendContent(m, content).catch((err: unknown) =>
        this.deps.log.warn(`Group update not delivered: ${(err as Error).message}`),
      );
      if (this.list(g.members).includes(m)) await this.shareProfile(m, g.id).catch(() => undefined);
    }
  }

  private nameOf(riverId: string, g?: GroupRow): string {
    if (riverId === this.me()) return this.deps.identity.get()?.displayName ?? 'You';
    const c = this.contact(riverId);
    if (c?.name) return c.name;
    if (g) {
      const p = (JSON.parse(g.profiles) as Record<string, { name: string | null }>)[riverId];
      if (p?.name) return p.name;
    }
    return this.deps.community.knownProfile(riverId)?.name ?? `River ${riverId.slice(0, 8)}`;
  }

  private avatarOf(riverId: string, g?: GroupRow): string | null {
    const c = this.contact(riverId);
    if (c?.avatar) return c.avatar;
    if (g) {
      const p = (JSON.parse(g.profiles) as Record<string, { avatar: string | null }>)[riverId];
      if (p?.avatar) return p.avatar;
    }
    return this.deps.community.knownProfile(riverId)?.avatar ?? null;
  }

  // ---- sending ---------------------------------------------------------------------------------

  /** Verifies a key bundle and starts sessions with devices we have none with. */
  private async prepareSessions(
    peer: string,
    force = false,
  ): Promise<Array<{ deviceId: number; registrationId: number }>> {
    const cachedRaw = this.meta(`devices:${peer}`);
    const cached = cachedRaw
      ? (JSON.parse(cachedRaw) as Array<{ deviceId: number; registrationId: number }>)
      : null;
    const protocol = this.protocol();
    if (!force && cached?.length && cached.every((d) => protocol.hasSession(peer, d.deviceId))) return cached;

    let res;
    try {
      res = await this.deps.community.api(`/keys/${peer}`, 'GET', undefined, keyBundleResponseSchema);
    } catch (err) {
      if (err instanceof CommunityError) throw new CommunityError('That person is not on your River server.');
      throw err;
    }
    const identityKey = Buffer.from(res.identityKey, 'base64');
    // Shared communities carry the person's identity key sealed with a community key the server
    // cannot read; if the server hands out a different key, refuse.
    const fromCommunity = this.deps.community.communityIdentityKey(peer);
    if (fromCommunity && fromCommunity !== res.identityKey) {
      throw new CommunityError(
        'The server offered a different safety key for this person than the one in your shared community. Messages were not sent.',
      );
    }
    const listBytes = Buffer.from(res.deviceList, 'base64');
    if (!verify(identityKey, deviceListMessage(listBytes), Buffer.from(res.deviceListSignature, 'base64'))) {
      throw new CommunityError(
        'This person’s device list is not signed by their identity key. Messages were not sent.',
      );
    }
    const list = deviceListSchema.parse(JSON.parse(listBytes.toString('utf8')));
    if (list.riverId !== peer) throw new CommunityError('The server returned keys for someone else.');
    const devices: Array<{ deviceId: number; registrationId: number }> = [];
    for (const d of res.devices) {
      const listed = list.devices.find((x) => x.deviceId === d.deviceId);
      if (!listed || listed.registrationId !== d.registrationId) continue;
      if (force || !protocol.hasSession(peer, d.deviceId)) {
        await protocol.startSession(peer, identityKey, d);
      }
      devices.push({ deviceId: d.deviceId, registrationId: d.registrationId });
    }
    if (!devices.length) throw new CommunityError('That person has not set up messaging yet.');
    this.setMeta(`devices:${peer}`, JSON.stringify(devices));
    return devices;
  }

  /** Encrypts content for every device of `peer` and posts it, retrying once if their devices changed. */
  private async sendContent(peer: string, content: Content, ephemeral = false): Promise<void> {
    await this.serial(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const devices = await this.prepareSessions(peer, attempt > 0);
        const plaintext = enc(content);
        const messages = [];
        for (const d of devices) {
          const env = await this.protocol().encrypt(peer, d.deviceId, plaintext);
          messages.push({ deviceId: d.deviceId, registrationId: d.registrationId, ...env });
        }
        try {
          await this.deps.community.api(
            `/messages/${peer}`,
            'POST',
            { messages, ephemeral: ephemeral || undefined },
            z.unknown(),
          );
          return;
        } catch (err) {
          if (attempt === 0 && err instanceof ApiError && err.code === 'device_mismatch') continue;
          throw err;
        }
      }
    });
  }

  /** Shares our name and avatar with a contact whenever they changed since we last told them. */
  private async shareProfile(peer: string, groupId?: string): Promise<void> {
    const name = this.deps.identity.get()?.displayName ?? null;
    const avatar = this.deps.community.profile().avatar;
    const bio = this.myBio();
    const fingerprint = JSON.stringify([name, avatar?.length ?? 0, avatar?.slice(-32) ?? '', bio]);
    const tag = groupId ? `profileSent:${groupId}:${peer}` : `profileSent:${peer}`;
    if (this.meta(tag) === fingerprint) return;
    await this.sendContent(peer, {
      v: 1,
      t: 'profile',
      name,
      avatar,
      ...(bio ? { bio } : {}),
      ...(groupId ? { groupId } : {}),
    });
    this.setMeta(tag, fingerprint);
  }

  // ---- public API ------------------------------------------------------------------------------

  async action<A extends DmAction>(raw: A): Promise<DmActionResult<A>> {
    const act = dmActionSchema.parse(raw);
    const out = <T>(v: T): DmActionResult<A> => v as unknown as DmActionResult<A>;
    try {
      switch (act.a) {
        case 'myId':
          return out(this.me());
        case 'files': {
          const files: FileView[] = [];
          const convs = new Map(this.conversations().map((c) => [c.riverId, c.name]));
          for (const r of this.db()
            .prepare(
              `SELECT * FROM dm_messages WHERE deleted = 0 AND json_array_length(json_extract(body, '$.attachments')) > 0 ORDER BY sent_at DESC LIMIT 2000`,
            )
            .all() as MessageRow[]) {
            const v = this.view(r);
            for (const p of v.attachments) {
              files.push({
                pointer: p,
                where: r.peer,
                whereName: convs.get(r.peer) ?? 'Conversation',
                fromName: v.senderName,
                mine: v.mine,
                sentAt: v.sentAt,
              });
            }
          }
          for (const r of this.db()
            .prepare(`SELECT author, body, created_at FROM posts ORDER BY created_at DESC LIMIT 1000`)
            .all() as Array<{ author: string; body: string; created_at: string }>) {
            const body = JSON.parse(r.body) as { attachments?: AttachmentPointer[] };
            for (const p of body.attachments ?? []) {
              files.push({
                pointer: p,
                where: 'post',
                whereName: 'Social',
                fromName: this.nameOf(r.author),
                mine: r.author === this.me(),
                sentAt: r.created_at,
              });
            }
          }
          return out(files.sort((a, b) => b.sentAt.localeCompare(a.sentAt)));
        }
        case 'logCall':
          this.db()
            .prepare(
              'INSERT INTO call_log (id, peer, direction, video, started_at, answered, duration_sec) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              randomBytes(16).toString('base64url'),
              act.peer,
              act.direction,
              act.video ? 1 : 0,
              new Date(Date.now() - act.durationSec * 1000).toISOString(),
              act.answered ? 1 : 0,
              act.durationSec,
            );
          return out(null);
        case 'calls':
          return out(
            (
              this.db().prepare('SELECT * FROM call_log ORDER BY started_at DESC LIMIT 500').all() as Array<{
                id: string;
                peer: string;
                direction: 'in' | 'out';
                video: number;
                started_at: string;
                answered: number;
                duration_sec: number;
              }>
            ).map((c) => ({
              id: c.id,
              peer: c.peer,
              name: this.nameOf(c.peer),
              avatar: this.avatarOf(c.peer),
              direction: c.direction,
              video: c.video === 1,
              answered: c.answered === 1,
              durationSec: c.duration_sec,
              startedAt: c.started_at,
            })),
          );
        case 'search': {
          const like = `%${act.query.replace(/[!%_]/g, (c) => `!${c}`)}%`;
          const rows = this.db()
            .prepare(
              `SELECT * FROM dm_messages
               WHERE deleted = 0 AND (json_extract(body, '$.text') LIKE ? ESCAPE '!'
                 OR json_extract(body, '$.attachments') LIKE ? ESCAPE '!')
               ORDER BY sent_at DESC LIMIT 100`,
            )
            .all(like, like) as MessageRow[];
          return out(rows.map((r) => this.view(r)));
        }
        case 'conversations':
          return out(this.conversations());
        case 'messages':
          return out(
            (
              this.db()
                .prepare(
                  'SELECT * FROM (SELECT * FROM dm_messages WHERE peer = ? ORDER BY sent_at DESC LIMIT 500) ORDER BY sent_at',
                )
                .all(act.peer) as MessageRow[]
            ).map((r) => this.view(r)),
          );
        case 'open': {
          if (act.peer === this.me()) throw new CommunityError('That is your own River ID.');
          await this.prepareSessions(act.peer);
          const known = this.deps.community.knownProfile(act.peer);
          this.upsertContact(act.peer, 'accepted', act.name ?? known?.name ?? null, known?.avatar ?? null);
          this.emitConversations();
          return out(this.conversations().find((c) => c.riverId === act.peer)!);
        }
        case 'send': {
          const group = isGroupId(act.peer) ? this.group(act.peer) : undefined;
          if (isGroupId(act.peer)) {
            if (!group || group.state === 'left') throw new CommunityError('You are not in this group.');
            if (group.state === 'request') this.saveGroup({ ...group, state: 'accepted' });
          } else {
            const contact = this.contact(act.peer);
            if (contact?.state === 'blocked')
              throw new CommunityError('Unblock this person to message them.');
            if (!contact || contact.state === 'request') this.upsertContact(act.peer, 'accepted');
          }
          const id = randomBytes(16).toString('base64url');
          const sentAt = new Date().toISOString();
          const body = { text: act.text, replyTo: act.replyTo, attachments: act.attachments };
          this.db()
            .prepare(
              `INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions) VALUES (?, ?, ?, ?, ?, 'sending', '{}')`,
            )
            .run(id, act.peer, this.me(), JSON.stringify(body), sentAt);
          this.emitMessage(id, false);
          try {
            if (!group) await this.shareProfile(act.peer);
            await this.deliver(act.peer, {
              v: 1,
              t: 'msg',
              id,
              text: act.text,
              ...(act.replyTo ? { replyTo: act.replyTo } : {}),
              ...(act.attachments?.length ? { attachments: act.attachments } : {}),
              sentAt,
              ...(group ? { groupId: group.id } : {}),
            });
            this.db()
              .prepare(`UPDATE dm_messages SET status = 'sent' WHERE id = ? AND status = 'sending'`)
              .run(id);
          } catch (err) {
            this.db().prepare(`UPDATE dm_messages SET status = 'failed' WHERE id = ?`).run(id);
            this.emitMessage(id, false);
            throw err;
          }
          this.emitMessage(id, false);
          this.emitConversations();
          return out(this.view(this.row(id)!));
        }
        case 'edit': {
          const row = this.row(act.id);
          if (!row || row.sender !== this.me() || row.peer !== act.peer)
            throw new CommunityError('You can only edit your own messages.');
          await this.deliver(act.peer, {
            v: 1,
            t: 'edit',
            id: act.id,
            text: act.text,
            ...(isGroupId(act.peer) ? { groupId: act.peer } : {}),
          });
          const body = JSON.parse(row.body) as Record<string, unknown>;
          this.db()
            .prepare('UPDATE dm_messages SET body = ?, edited_at = ? WHERE id = ?')
            .run(JSON.stringify({ ...body, text: act.text }), new Date().toISOString(), act.id);
          this.emitMessage(act.id, false);
          return out(null);
        }
        case 'delete': {
          const row = this.row(act.id);
          if (!row || row.peer !== act.peer) return out(null);
          if (act.forEveryone) {
            if (row.sender !== this.me())
              throw new CommunityError('You can only delete your own messages for everyone.');
            await this.deliver(act.peer, {
              v: 1,
              t: 'delete',
              id: act.id,
              ...(isGroupId(act.peer) ? { groupId: act.peer } : {}),
            });
          }
          this.db().prepare('DELETE FROM dm_messages WHERE id = ?').run(act.id);
          this.emit({ t: 'remove', peer: act.peer, id: act.id });
          this.emitConversations();
          return out(null);
        }
        case 'react': {
          const row = this.row(act.id);
          if (!row || row.peer !== act.peer) return out(null);
          await this.deliver(act.peer, {
            v: 1,
            t: 'react',
            id: act.id,
            emoji: act.emoji,
            on: act.on,
            ...(isGroupId(act.peer) ? { groupId: act.peer } : {}),
          });
          this.applyReaction(row, this.me(), act.emoji, act.on);
          return out(null);
        }
        case 'read': {
          if (isGroupId(act.peer)) {
            const g = this.group(act.peer);
            if (g) this.saveGroup({ ...g, last_read: new Date().toISOString() });
            this.emitConversations();
            return out(null);
          }
          const contact = this.contact(act.peer);
          if (!contact) return out(null);
          const unread = this.db()
            .prepare(
              `SELECT id FROM dm_messages WHERE peer = ? AND sender = ? AND sent_at > ? AND deleted = 0`,
            )
            .all(act.peer, act.peer, contact.last_read ?? '') as Array<{ id: string }>;
          this.db()
            .prepare('UPDATE contacts SET last_read = ? WHERE river_id = ?')
            .run(new Date().toISOString(), act.peer);
          this.emitConversations();
          if (unread.length && contact.state === 'accepted') {
            void this.sendContent(act.peer, {
              v: 1,
              t: 'receipt',
              kind: 'read',
              ids: unread.slice(-200).map((u) => u.id),
            }).catch(() => undefined);
          }
          return out(null);
        }
        case 'typing':
          if (isGroupId(act.peer)) {
            if (this.group(act.peer)?.state === 'accepted') {
              void this.deliver(act.peer, { v: 1, t: 'typing', groupId: act.peer }, true).catch(
                () => undefined,
              );
            }
          } else if (this.contact(act.peer)?.state === 'accepted') {
            void this.sendContent(act.peer, { v: 1, t: 'typing' }, true).catch(() => undefined);
          }
          return out(null);
        case 'accept':
          if (isGroupId(act.peer)) {
            const g = this.group(act.peer);
            if (g && g.state === 'request') {
              this.saveGroup({ ...g, state: 'accepted' });
              // Now that we joined, let the others see who we are.
              const me = this.me();
              void (async () => {
                for (const m of this.list(g.members)) {
                  if (m !== me) await this.shareProfile(m, g.id).catch(() => undefined);
                }
              })();
            }
            this.emitConversations();
            return out(null);
          }
          this.db().prepare(`UPDATE contacts SET state = 'accepted' WHERE river_id = ?`).run(act.peer);
          this.emitConversations();
          void this.shareProfile(act.peer).catch(() => undefined);
          return out(null);
        case 'block':
          await this.deps.community.api(`/blocks/${act.peer}`, 'PUT', {}, z.unknown());
          if (!this.contact(act.peer)) this.upsertContact(act.peer, 'blocked');
          this.db().prepare(`UPDATE contacts SET state = 'blocked' WHERE river_id = ?`).run(act.peer);
          this.emitConversations();
          return out(null);
        case 'unblock':
          await this.deps.community.api(`/blocks/${act.peer}`, 'DELETE', undefined, z.unknown());
          this.db().prepare(`UPDATE contacts SET state = 'accepted' WHERE river_id = ?`).run(act.peer);
          this.emitConversations();
          return out(null);
        case 'removeConversation':
          if (isGroupId(act.peer)) {
            const g = this.group(act.peer);
            if (g && g.state !== 'left') {
              await this.deliver(act.peer, { v: 1, t: 'groupLeave', groupId: act.peer }).catch(
                () => undefined,
              );
            }
            this.db().prepare('DELETE FROM dm_messages WHERE peer = ?').run(act.peer);
            this.db().prepare('DELETE FROM dm_groups WHERE id = ?').run(act.peer);
            this.emitConversations();
            return out(null);
          }
          this.db().prepare('DELETE FROM dm_messages WHERE peer = ?').run(act.peer);
          this.db().prepare(`DELETE FROM contacts WHERE river_id = ? AND state != 'blocked'`).run(act.peer);
          this.emitConversations();
          return out(null);
        case 'safetyNumber': {
          const mine = this.deps.identity.protocolIdentity();
          let theirs = this.protocol().identityOf(act.peer);
          if (!theirs) {
            await this.prepareSessions(act.peer);
            theirs = this.protocol().identityOf(act.peer);
          }
          if (!mine || !theirs) throw new CommunityError('Send a message first to set up encryption.');
          const n = safetyNumber(
            { riverId: mine.riverId, publicKey: mine.publicKey },
            { riverId: act.peer, publicKey: theirs },
          );
          return out({
            digits: n.digits,
            verified: this.protocol().isVerified(act.peer),
            theirName: this.contact(act.peer)?.name ?? 'This person',
          });
        }
        case 'setVerified':
          this.protocol().setVerified(act.peer, act.verified);
          this.db().prepare('UPDATE contacts SET key_changed = 0 WHERE river_id = ?').run(act.peer);
          this.emitConversations();
          return out(null);
        case 'acknowledgeKeyChange':
          this.db().prepare('UPDATE contacts SET key_changed = 0 WHERE river_id = ?').run(act.peer);
          this.emitConversations();
          return out(null);
        case 'upload':
          return out(await this.deps.community.upload(act, 'dm'));
        case 'createGroup': {
          const me = this.me();
          const members = [...new Set([me, ...act.members])].slice(0, MAX_GROUP);
          if (members.length < 2) throw new CommunityError('Add at least one other person.');
          // Make sure everyone can receive (has set up messaging) before creating the group.
          for (const m of members) if (m !== me) await this.prepareSessions(m);
          const g: GroupRow = {
            id: randomBytes(16).toString('base64url'),
            name: act.name,
            members: JSON.stringify(members),
            admins: JSON.stringify([me]),
            profiles: '{}',
            state: 'accepted',
            created_at: new Date().toISOString(),
            last_read: null,
          };
          this.saveGroup(g);
          await this.sendGroupState(g);
          this.emitConversations();
          return out(this.conversations().find((c) => c.riverId === g.id)!);
        }
        case 'renameGroup':
        case 'addGroupMembers':
        case 'removeGroupMember': {
          const g = this.group(act.peer);
          if (!g || !this.list(g.admins).includes(this.me())) {
            throw new CommunityError('Only group admins can change the group.');
          }
          let members = this.list(g.members);
          let removed: string[] = [];
          if (act.a === 'addGroupMembers') {
            for (const m of act.members) if (!members.includes(m)) await this.prepareSessions(m);
            members = [...new Set([...members, ...act.members])];
            if (members.length > MAX_GROUP)
              throw new CommunityError(`Groups can have up to ${MAX_GROUP} people.`);
          }
          if (act.a === 'removeGroupMember') {
            if (act.member === this.me()) throw new CommunityError('Use Leave group to leave.');
            removed = [act.member];
            members = members.filter((m) => m !== act.member);
          }
          const next: GroupRow = {
            ...g,
            name: act.a === 'renameGroup' ? act.name : g.name,
            members: JSON.stringify(members),
            admins: JSON.stringify(this.list(g.admins).filter((a) => members.includes(a))),
          };
          this.saveGroup(next);
          await this.sendGroupState(next, removed);
          this.emitConversations();
          return out(null);
        }
        case 'leaveGroup': {
          const g = this.group(act.peer);
          if (!g || g.state === 'left') return out(null);
          await this.deliver(act.peer, { v: 1, t: 'groupLeave', groupId: act.peer }).catch(() => undefined);
          const me = this.me();
          this.saveGroup({
            ...g,
            state: 'left',
            members: JSON.stringify(this.list(g.members).filter((m) => m !== me)),
            admins: JSON.stringify(this.list(g.admins).filter((m) => m !== me)),
          });
          this.emitConversations();
          return out(null);
        }
        case 'call':
          if (this.contact(act.peer)?.state !== 'accepted')
            throw new CommunityError('You can only call your contacts.');
          await this.sendContent(
            act.peer,
            {
              v: 1,
              t: 'call',
              callId: act.callId,
              kind: act.kind,
              ...(act.video !== undefined ? { video: act.video } : {}),
              ...(act.data !== undefined ? { data: act.data } : {}),
            },
            true,
          );
          return out(null);
      }
    } catch (err) {
      if (err instanceof SafetyNumberChangedError) throw new CommunityError(err.message);
      throw err;
    }
  }

  // ---- local state -----------------------------------------------------------------------------

  private contact(riverId: string): ContactRow | undefined {
    return this.db().prepare('SELECT * FROM contacts WHERE river_id = ?').get(riverId) as
      ContactRow | undefined;
  }

  private upsertContact(
    riverId: string,
    state: ContactRow['state'],
    name: string | null = null,
    avatar: string | null = null,
  ): void {
    const existing = this.contact(riverId);
    if (existing) {
      this.db()
        .prepare(
          'UPDATE contacts SET state = ?, name = COALESCE(name, ?), avatar = COALESCE(avatar, ?) WHERE river_id = ?',
        )
        .run(existing.state === 'blocked' ? 'blocked' : state, name, avatar, riverId);
    } else {
      this.db()
        .prepare('INSERT INTO contacts (river_id, name, avatar, state, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(riverId, name, avatar, state, new Date().toISOString());
    }
  }

  private row(id: string): MessageRow | undefined {
    return this.db().prepare('SELECT * FROM dm_messages WHERE id = ?').get(id) as MessageRow | undefined;
  }

  private applyReaction(row: MessageRow, who: string, emoji: string, on: boolean): void {
    const reactions = JSON.parse(row.reactions) as Record<string, string[]>;
    const users = new Set(reactions[emoji] ?? []);
    if (on) users.add(who);
    else users.delete(who);
    if (users.size) reactions[emoji] = [...users];
    else delete reactions[emoji];
    if (Object.keys(reactions).length > 50) return;
    this.db()
      .prepare('UPDATE dm_messages SET reactions = ? WHERE id = ?')
      .run(JSON.stringify(reactions), row.id);
    this.emitMessage(row.id, false);
  }

  private view(r: MessageRow): DirectMessageView {
    const body = JSON.parse(r.body) as { text?: string; replyTo?: string; attachments?: AttachmentPointer[] };
    const me = this.me();
    const reactions = JSON.parse(r.reactions) as Record<string, string[]>;
    const group = isGroupId(r.peer) ? this.group(r.peer) : undefined;
    return {
      id: r.id,
      peer: r.peer,
      sender: r.sender,
      senderName: this.nameOf(r.sender, group),
      mine: r.sender === me,
      text: r.deleted ? '' : String(body.text ?? ''),
      replyTo: body.replyTo ?? null,
      attachments: r.deleted ? [] : (body.attachments ?? []),
      sentAt: r.sent_at,
      editedAt: r.edited_at,
      deleted: r.deleted === 1,
      status: r.status as DirectMessageView['status'],
      reactions: Object.entries(reactions).map(([emoji, users]) => ({
        emoji,
        count: users.length,
        mine: users.includes(me),
        users,
      })),
    };
  }

  private lastOf(conv: string): ConversationView['last'] {
    const last = this.db()
      .prepare('SELECT * FROM dm_messages WHERE peer = ? ORDER BY sent_at DESC LIMIT 1')
      .get(conv) as MessageRow | undefined;
    if (!last) return null;
    const v = this.view(last);
    const text = v.deleted
      ? 'Message deleted'
      : v.text || (v.attachments.length ? `📎 ${v.attachments[0]!.name}` : '');
    return {
      text: isGroupId(conv) && !v.mine ? `${v.senderName}: ${text}` : text,
      sentAt: v.sentAt,
      mine: v.mine,
    };
  }

  conversations(): ConversationView[] {
    const contacts = this.db().prepare('SELECT * FROM contacts').all() as ContactRow[];
    const groups = this.db().prepare('SELECT * FROM dm_groups').all() as GroupRow[];
    const protocol = this.deps.identity.protocolIdentity() ? this.protocol() : null;
    const me = this.me();
    const groupViews: ConversationView[] = groups.map((g) => {
      const admins = this.list(g.admins);
      const unread = (
        this.db()
          .prepare(
            'SELECT COUNT(*) AS n FROM dm_messages WHERE peer = ? AND sender != ? AND sent_at > ? AND deleted = 0',
          )
          .get(g.id, me, g.last_read ?? '') as { n: number }
      ).n;
      return {
        riverId: g.id,
        kind: 'group',
        members: this.list(g.members).map((m) => ({
          riverId: m,
          name: this.nameOf(m, g),
          avatar: this.avatarOf(m, g),
          admin: admins.includes(m),
        })),
        isAdmin: admins.includes(me),
        name: g.name,
        avatar: null,
        state: g.state,
        last: this.lastOf(g.id),
        unread,
        verified: false,
        keyChanged: false,
      };
    });
    return [
      ...groupViews,
      ...contacts.map((c) => {
        const last = this.db()
          .prepare('SELECT * FROM dm_messages WHERE peer = ? ORDER BY sent_at DESC LIMIT 1')
          .get(c.river_id) as MessageRow | undefined;
        const unread = (
          this.db()
            .prepare(
              'SELECT COUNT(*) AS n FROM dm_messages WHERE peer = ? AND sender = ? AND sent_at > ? AND deleted = 0',
            )
            .get(c.river_id, c.river_id, c.last_read ?? '') as { n: number }
        ).n;
        const known = this.deps.community.knownProfile(c.river_id);
        const lastView = last ? this.view(last) : null;
        return {
          riverId: c.river_id,
          kind: 'direct' as const,
          members: [],
          isAdmin: false,
          name: c.name ?? known?.name ?? `River ${c.river_id.slice(0, 8)}`,
          avatar: c.avatar ?? known?.avatar ?? null,
          state: c.state,
          last: lastView
            ? {
                text: lastView.deleted
                  ? 'Message deleted'
                  : lastView.text ||
                    (lastView.attachments.length ? `📎 ${lastView.attachments[0]!.name}` : ''),
                sentAt: lastView.sentAt,
                mine: lastView.mine,
              }
            : null,
          unread,
          verified: protocol?.isVerified(c.river_id) ?? false,
          keyChanged: c.key_changed === 1,
        };
      }),
    ].sort((a, b) => (b.last?.sentAt ?? '').localeCompare(a.last?.sentAt ?? ''));
  }

  private emitConversations(): void {
    this.emit({ t: 'conversations', conversations: this.conversations() });
  }

  private emitMessage(id: string, isNew: boolean): void {
    const row = this.row(id);
    if (!row) return;
    const view = this.view(row);
    const conv = this.conversations().find((c) => c.riverId === row.peer);
    const name = conv?.kind === 'group' ? `${view.senderName} · ${conv.name}` : (conv?.name ?? 'Someone');
    this.emit({ t: 'message', message: view, isNew, senderName: name });
  }
}
