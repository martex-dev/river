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
  }),
  z.object({ v: z.literal(1), t: z.literal('edit'), id: msgId, text: z.string().min(1).max(4000) }),
  z.object({ v: z.literal(1), t: z.literal('delete'), id: msgId }),
  z.object({
    v: z.literal(1),
    t: z.literal('react'),
    id: msgId,
    emoji: z.string().min(1).max(32),
    on: z.boolean(),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('receipt'),
    kind: z.enum(['delivered', 'read']),
    ids: z.array(msgId).max(200),
  }),
  z.object({ v: z.literal(1), t: z.literal('typing') }),
  z.object({
    v: z.literal(1),
    t: z.literal('profile'),
    name: z.string().max(64).nullable(),
    avatar: avatarSchema.nullable().optional(),
  }),
]);
type Content = z.infer<typeof contentSchema>;

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

  constructor(deps: Deps) {
    this.deps = deps;
    deps.community.onServerEvent((e) => this.onServerEvent(e));
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
      const upload = this.protocol().generatePreKeys({ oneTime, rotate });
      await this.deps.community.api('/keys', 'PUT', upload, z.unknown());
      this.setMeta('keysUploaded', this.me());
      if (rotate) this.setMeta('signedAt', String(Date.now()));
    });
  }

  /** Uploads prekeys if needed and fetches mail that arrived while offline. */
  async sync(): Promise<void> {
    await this.ensurePreKeys();
    await this.drainMailbox();
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
    const now = new Date();
    switch (content.t) {
      case 'msg': {
        if (!contact) this.upsertContact(peer, 'request');
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
            peer,
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
        if (this.contact(peer)?.state === 'accepted') {
          void this.sendContent(peer, { v: 1, t: 'receipt', kind: 'delivered', ids: [content.id] }).catch(
            () => undefined,
          );
        }
        return true;
      }
      case 'edit': {
        const row = this.row(content.id);
        if (row && row.sender === peer && !row.deleted) {
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
        if (row && row.sender === peer) {
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
        if (row && row.peer === peer) this.applyReaction(row, peer, content.emoji, content.on);
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
        if (contact?.state === 'accepted') this.emit({ t: 'typing', peer });
        return true;
      case 'profile': {
        if (!contact) this.upsertContact(peer, 'request');
        this.db()
          .prepare('UPDATE contacts SET name = ?, avatar = ? WHERE river_id = ?')
          .run(content.name ? content.name.slice(0, 64) : null, content.avatar ?? null, peer);
        this.emitConversations();
        return true;
      }
    }
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
  private async shareProfile(peer: string): Promise<void> {
    const name = this.deps.identity.get()?.displayName ?? null;
    const avatar = this.deps.community.profile().avatar;
    const fingerprint = JSON.stringify([name, avatar?.length ?? 0, avatar?.slice(-32) ?? '']);
    if (this.meta(`profileSent:${peer}`) === fingerprint) return;
    await this.sendContent(peer, { v: 1, t: 'profile', name, avatar });
    this.setMeta(`profileSent:${peer}`, fingerprint);
  }

  // ---- public API ------------------------------------------------------------------------------

  async action<A extends DmAction>(raw: A): Promise<DmActionResult<A>> {
    const act = dmActionSchema.parse(raw);
    const out = <T>(v: T): DmActionResult<A> => v as unknown as DmActionResult<A>;
    try {
      switch (act.a) {
        case 'myId':
          return out(this.me());
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
          const contact = this.contact(act.peer);
          if (contact?.state === 'blocked') throw new CommunityError('Unblock this person to message them.');
          if (!contact || contact.state === 'request') this.upsertContact(act.peer, 'accepted');
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
            await this.shareProfile(act.peer);
            await this.sendContent(act.peer, {
              v: 1,
              t: 'msg',
              id,
              text: act.text,
              ...(act.replyTo ? { replyTo: act.replyTo } : {}),
              ...(act.attachments?.length ? { attachments: act.attachments } : {}),
              sentAt,
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
          await this.sendContent(act.peer, { v: 1, t: 'edit', id: act.id, text: act.text });
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
            await this.sendContent(act.peer, { v: 1, t: 'delete', id: act.id });
          }
          this.db().prepare('DELETE FROM dm_messages WHERE id = ?').run(act.id);
          this.emit({ t: 'remove', peer: act.peer, id: act.id });
          this.emitConversations();
          return out(null);
        }
        case 'react': {
          const row = this.row(act.id);
          if (!row || row.peer !== act.peer) return out(null);
          await this.sendContent(act.peer, { v: 1, t: 'react', id: act.id, emoji: act.emoji, on: act.on });
          this.applyReaction(row, this.me(), act.emoji, act.on);
          return out(null);
        }
        case 'read': {
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
          if (this.contact(act.peer)?.state === 'accepted') {
            void this.sendContent(act.peer, { v: 1, t: 'typing' }, true).catch(() => undefined);
          }
          return out(null);
        case 'accept':
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
    return {
      id: r.id,
      peer: r.peer,
      sender: r.sender,
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

  conversations(): ConversationView[] {
    const contacts = this.db().prepare('SELECT * FROM contacts').all() as ContactRow[];
    const protocol = this.deps.identity.protocolIdentity() ? this.protocol() : null;
    return contacts
      .map((c) => {
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
      })
      .sort((a, b) => (b.last?.sentAt ?? '').localeCompare(a.last?.sentAt ?? ''));
  }

  private emitConversations(): void {
    this.emit({ t: 'conversations', conversations: this.conversations() });
  }

  private emitMessage(id: string, isNew: boolean): void {
    const row = this.row(id);
    if (!row) return;
    const name = this.conversations().find((c) => c.riverId === row.peer)?.name ?? 'Someone';
    this.emit({ t: 'message', message: this.view(row), isNew, senderName: name });
  }
}
