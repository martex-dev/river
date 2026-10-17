import { randomBytes } from 'node:crypto';
import {
  IdentityChangeRefusedError,
  RiverProtocol,
  SafetyNumberChangedError,
  safetyNumber,
  verify,
  type IncomingIdentityChange,
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
  linkEmbedSchema,
  pollInputSchema,
  type AttachmentPointer,
} from '../../shared/community-actions.ts';
import { readPoll } from '../../shared/poll.ts';
import {
  dmActionSchema,
  type CallOutcome,
  type ConversationView,
  type DirectMessageView,
  type DmAction,
  type DmActionResult,
  type DmEvent,
  type FileView,
  type ScheduledView,
  type ChatFolder,
  MAX_FOLDERS,
  MAX_TIMER,
} from '../../shared/dm.ts';
import type { AccountService } from '../account/account-service.ts';
import { CommunityError, type CommunityService } from '../community/community-service.ts';
import { ApiError } from '../http.ts';
import type { IdentityService } from '../identity/identity-service.ts';
import type { Logger } from '../logger.ts';
import type { LocalDatabase } from '../storage/database.ts';

/** How long a call invite rings (the same as the window's ring timeout). */
const RING_MS = 45_000;

/**
 * How a call ended, kept in call_log.answered (so older Rivers still read 1 as answered and
 * anything else as not answered): 0 missed / no answer, 1 answered, 2 declined, 3 failed.
 */
const CALL_OUTCOMES: readonly CallOutcome[] = ['missed', 'answered', 'declined', 'failed'];
const CALL_OUTCOME_CODE: Record<CallOutcome, number> = { missed: 0, answered: 1, declined: 2, failed: 3 };
/** An answer this recent, for a call logged as never connected, means the call failed after it was answered. */
const CALL_ANSWER_WINDOW_MS = 10 * 60_000;
/** A new bio goes to friends this long after the last change. */
const BIO_SHARE_DELAY_MS = 5_000;

/** A message waiting on this device to be sent later (2.5). */
interface ScheduledItem {
  id: string;
  peer: string;
  text: string;
  replyTo?: string;
  attachments: AttachmentPointer[];
  sendAt: string;
  silent: boolean;
  failed: boolean;
  /** One message (and ID) per scheduled item, reused by every retry. */
  messageId?: string;
  /** Failed attempts so far, and when to try again (back-off). */
  tries?: number;
  retryAt?: string;
}

/** Waits between retries of a scheduled message that failed: 30 s, 1 min, 2 min … at most 1 h. */
const scheduledBackoff = (tries: number): number => Math.min(30_000 * 2 ** Math.max(0, tries - 1), 3_600_000);

function scheduledView(x: ScheduledItem): ScheduledView {
  return {
    id: x.id,
    peer: x.peer,
    text: x.text,
    attachments: x.attachments,
    sendAt: x.sendAt,
    silent: x.silent,
    failed: x.failed,
  };
}

/** Pinned conversations at most (2.1). */
const MAX_PINNED = 10;

interface ChatPrefs {
  pinnedAt?: string;
  archived?: boolean;
  unread?: boolean;
}

/** What travels inside the libsignal envelope. Everything here is untrusted input when received. */
const msgId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const messageFields = {
  id: msgId,
  text: z.string().max(4000),
  replyTo: msgId.optional(),
  attachments: z.array(attachmentPointerSchema).max(10).optional(),
  sentAt: z.iso.datetime(),
  groupId: msgId.optional(),
  /** Disappearing messages (2.4): delete after this many seconds. */
  expiresIn: z.number().int().min(1).max(MAX_TIMER).optional(),
  /** Sent without sound (2.5): no notification. */
  silent: z.boolean().optional(),
  /** A poll (2.10.4). */
  poll: pollInputSchema.optional(),
  /** The sender's link preview (2.10.6). */
  embed: linkEmbedSchema.optional(),
};

const contentSchema = z.discriminatedUnion('t', [
  z.object({ v: z.literal(1), t: z.literal('msg'), ...messageFields }),
  /**
   * Linked devices (1.3): a message this account sent from another of its devices, so every
   * device shows the whole conversation. Accepted only from this account's own devices.
   */
  z.object({
    v: z.literal(1),
    t: z.literal('sync'),
    /** The conversation: a person's River ID or a group ID. */
    conv: z.string().min(1).max(64),
    message: z.object(messageFields).strict(),
  }),
  /**
   * Linked devices: an edit, delete for everyone, reaction, pin, timer change or read made on
   * another of this account's devices. Accepted only from this account's own devices.
   */
  z.object({
    v: z.literal(1),
    t: z.literal('syncOp'),
    conv: z.string().min(1).max(64),
    op: z.discriminatedUnion('t', [
      z.object({ t: z.literal('edit'), id: msgId, text: z.string().min(1).max(4000) }),
      z.object({ t: z.literal('delete'), id: msgId }),
      z.object({ t: z.literal('react'), id: msgId, emoji: z.string().min(1).max(32), on: z.boolean() }),
      z.object({ t: z.literal('pin'), id: msgId, pinned: z.boolean() }),
      z.object({ t: z.literal('timer'), seconds: z.number().int().min(0).max(MAX_TIMER) }),
      z.object({ t: z.literal('read'), at: z.iso.datetime() }),
    ]),
  }),
  /** Disappearing messages timer for this conversation (2.4); 0 turns it off. */
  z.object({
    v: z.literal(1),
    t: z.literal('timer'),
    seconds: z.number().int().min(0).max(MAX_TIMER),
    groupId: msgId.optional(),
  }),
  /** Linked devices: a device asks this account's other devices for the friends list. */
  z.object({ v: z.literal(1), t: z.literal('contactsReq') }),
  /** Linked devices: the friends list (accepted and blocked people) from another of our devices. */
  z.object({
    v: z.literal(1),
    t: z.literal('contacts'),
    contacts: z
      .array(
        z.object({
          riverId: z.uuid(),
          state: z.enum(['accepted', 'blocked']),
          name: z.string().max(64).nullable(),
        }),
      )
      .max(2000),
    /** Names of this account's devices (2.0.3). */
    devices: z.record(z.string(), z.string().max(64)).optional(),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('edit'),
    id: msgId,
    text: z.string().min(1).max(4000),
    groupId: msgId.optional(),
  }),
  z.object({ v: z.literal(1), t: z.literal('delete'), id: msgId, groupId: msgId.optional() }),
  /** Pin or unpin a message in this conversation (1.0.29); anyone in it may. */
  z.object({
    v: z.literal(1),
    t: z.literal('pin'),
    id: msgId,
    pinned: z.boolean(),
    groupId: msgId.optional(),
  }),
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
    /** An emoji for the group (1.0.25); older apps ignore it. */
    icon: z.string().min(1).max(16).nullable().optional(),
  }),
  z.object({ v: z.literal(1), t: z.literal('groupLeave'), groupId: msgId }),
  z.object({
    v: z.literal(1),
    t: z.literal('ckey'),
    communityId: msgId,
    epoch: z.number().int().min(0).max(1_000_000),
    key: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
    /** Proof the sender held the previous key (2.11): the key sealed under epoch `prev`'s key. */
    wrap: z.string().max(400).optional(),
    prev: z.number().int().min(0).max(1_000_000).optional(),
  }),
  z.object({
    v: z.literal(1),
    t: z.literal('ckeyReq'),
    communityId: msgId,
    epoch: z.number().int().min(0).max(1_000_000),
    /** The newest epoch the requester holds (2.11). */
    have: z.number().int().min(0).max(1_000_000).optional(),
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
type SyncOp = Extract<Content, { t: 'syncOp' }>['op'];
type SendAct = Extract<z.infer<typeof dmActionSchema>, { a: 'send' }>;

/**
 * A decrypted message that was not applied yet. libsignal never decrypts a message twice, so the
 * plaintext is kept (in this device's encrypted database) until it is applied.
 */
interface Inbound {
  sender: string;
  receivedAt: string;
  content: Content;
  /** Group traffic for a group this device does not know yet: applied once its details arrive. */
  waitGroup?: string;
  /** When it was kept, and how often applying it failed. */
  keptAt: number;
  tries: number;
}
const INBOX_MAX_WAITING = 500;
/** Messages one sender may have waiting for groups this device does not know yet. */
const INBOX_MAX_WAITING_PER_SENDER = 20;
/** Live signals: never kept to be applied later. */
const EPHEMERAL = new Set(['call', 'typing']);
/** How long a removed group stays remembered, so its traffic is dropped instead of waiting. */
const GROUP_TOMBSTONE_MS = 90 * 86_400_000;
/** Peer device lists are fetched and verified again at least this often. */
const DEVICE_LIST_MAX_AGE_MS = 24 * 3_600_000;
const INBOX_WAIT_MS = 7 * 86_400_000;
const INBOX_MAX_TRIES = 5;
/** Decrypted messages kept in memory while storage is unavailable (their envelopes stay on the server). */
const UNDELIVERED_MAX = 1000;

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
  /** Emoji icon (1.0.25), or null. */
  icon?: string | null;
}

const PREKEY_TARGET = 100;
const PREKEY_LOW = 25;
const SIGNED_ROTATE_MS = 7 * 24 * 60 * 60 * 1000;

/** The name of your own notes conversation (2.9). */
const NOTE_TO_SELF = 'Note to self';

interface Deps {
  db: () => LocalDatabase | null;
  identity: IdentityService;
  account: AccountService;
  community: CommunityService;
  log: Logger;
  /** Privacy choices (2.6): read receipts and typing indicators, both ways. Default: on. */
  privacy?: () => { readReceipts: boolean; typing: boolean };
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
  expires_at?: string | null;
  /** When this device stored it (local clock); unread counts use it, ordering uses sent_at. */
  received_at?: string | null;
}

interface ContactRow {
  river_id: string;
  name: string | null;
  avatar: string | null;
  state: 'accepted' | 'request' | 'blocked';
  created_at: string;
  last_read: string | null;
  key_changed: number;
  heard_from: number;
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
  /** Set after restoring a backup: contacts need new sessions with us (also kept in meta). */
  private reintroduce = false;
  private reintroducing = false;
  /** Called when someone is blocked here or on another of our devices (SocialService drops their posts). */
  private readonly blockListeners = new Set<(riverId: string) => void>();
  /** Databases whose leftover 'sending' messages (from a crash) were already marked failed. */
  private readonly recovered = new WeakSet<LocalDatabase>();
  /** Decrypted messages that could not be applied or kept while storage was unavailable. */
  private readonly undelivered = new Map<string, Inbound>();
  /** Scheduled messages being sent right now, and whether they were cancelled meanwhile. */
  private readonly scheduledInFlight = new Map<string, { cancelled: boolean }>();
  /** When each person last answered a call with us (either side), so an answered call that then failed is not "missed". */
  private readonly callAnswered = new Map<string, number>();
  /** A changed bio goes to friends once typing has settled (not once per save). */
  private bioShareTimer: NodeJS.Timeout | undefined;

  constructor(deps: Deps) {
    this.deps = deps;
    deps.community.onServerEvent((e) => this.onServerEvent(e));
    deps.community.setKeyChannel({ send: (peer, message) => this.sendContent(peer, { v: 1, ...message }) });
    // Disappearing messages are deleted on time even if nobody opens the conversation.
    const sweep = setInterval(() => {
      try {
        this.sweepExpired();
        if (this.deps.account.status().state === 'registered')
          void this.sendDueScheduled().catch(() => undefined);
      } catch {
        // storage not open yet (locked): next time
      }
    }, 15_000);
    sweep.unref?.();
  }

  onEvent(listener: (e: DmEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Used by notifications: brings a conversation to the front. */
  /** The call invite ringing right now, if any (in memory only). */
  private ringing: { event: Extract<DmEvent, { t: 'call' }>; at: number; answer?: boolean } | null = null;

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
    if (!this.recovered.has(db)) {
      this.recovered.add(db);
      // Messages still 'sending' when River last stopped were never confirmed: show them as failed.
      try {
        db.prepare(`UPDATE dm_messages SET status = 'failed' WHERE status = 'sending'`).run();
      } catch (err) {
        this.deps.log.warn(`Could not check for unsent messages: ${(err as Error).message}`);
      }
    }
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
      // Their devices are looked up again under the new key before the next message goes out.
      this.storage().delete('meta', `dm:devicesAt:${riverId}`);
      this.emitConversations();
    };
    protocol.approveIdentityChange = (change) => this.confirmIdentityChange(change);
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
    await this.requestContacts();
  }

  private async drainMailbox(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      // Messages decrypted earlier whose applying failed get another go first.
      await this.serial(async () => this.retryKept());
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
    // Decrypted before, but storage was unavailable to apply or keep it: libsignal will not decrypt
    // the same message twice, so use the plaintext kept in memory.
    let inbound = this.undelivered.get(env.id);
    if (!inbound) {
      // The server names the sender. Content "from us" (copies, contacts, groups) is accepted only
      // from another device in this account's identity-signed device list; libsignal also checks
      // that such a session uses this account's own identity key (RiverProtocol).
      if (env.sender === this.me()) {
        const listed =
          env.senderDevice !== this.deviceId() &&
          (await this.deps.account.ownDeviceListed(env.senderDevice).catch(() => false));
        if (!listed) {
          this.deps.log.warn('Dropped a message claiming to come from a device this account does not have');
          return true;
        }
      } else {
        this.hintDevice(env.sender, env.senderDevice);
      }
      let content: Content;
      try {
        const plain = await this.protocol().decrypt(env.sender, env.senderDevice, env);
        content = contentSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
      } catch (err) {
        if (err instanceof IdentityChangeRefusedError) {
          this.deps.log.warn(
            'Dropped a direct message under a new safety key that River could not confirm for its sender',
          );
        } else {
          this.deps.log.warn(`Dropped a direct message that could not be decrypted (${(err as Error).name})`);
        }
        return true;
      }
      inbound = { sender: env.sender, receivedAt: env.receivedAt, content, keptAt: Date.now(), tries: 0 };
    }
    return this.process(env.id, inbound);
  }

  /**
   * Applies a decrypted message. The ratchet has already moved on, so a message whose applying
   * fails is never just dropped: it is kept in this device's encrypted database (and the envelope
   * acknowledged) and applied again on the next sync. If even keeping it fails (storage locked or
   * unavailable), the plaintext stays in memory and the envelope stays on the server, so its next
   * delivery uses the plaintext instead of failing to decrypt.
   */
  private process(id: string, inbound: Inbound): boolean {
    let waitGroup: string | null;
    try {
      waitGroup = this.apply(inbound);
    } catch (err) {
      this.deps.log.warn(`A direct message could not be applied yet: ${(err as Error).message}`);
      // Live signals are worthless later: a call replayed after unlocking would ring long after it ended.
      if (EPHEMERAL.has(inbound.content.t)) {
        this.undelivered.delete(id);
        return true;
      }
      try {
        this.keep(id, { ...inbound, tries: inbound.tries + 1 });
        this.undelivered.delete(id);
        return true;
      } catch {
        if (this.undelivered.size < UNDELIVERED_MAX || this.undelivered.has(id)) {
          this.undelivered.set(id, inbound);
          return false;
        }
        return true;
      }
    }
    this.undelivered.delete(id);
    if (waitGroup && !EPHEMERAL.has(inbound.content.t)) {
      // Group traffic that arrived before the group's details: keep it for a while (bounded in
      // total and per sender, so nobody can fill the space with made-up groups).
      try {
        if (
          this.keptCount() < INBOX_MAX_WAITING &&
          this.keptFrom(inbound.sender) < INBOX_MAX_WAITING_PER_SENDER
        )
          this.keep(id, { ...inbound, waitGroup });
      } catch (err) {
        this.deps.log.warn(`A group message could not be kept: ${(err as Error).message}`);
      }
    }
    return true;
  }

  /**
   * Traffic for a group this device does not know waits for the group's details only from
   * people it already knows (contacts, members of its groups, its own devices), and never for a
   * group that was removed here.
   */
  private mayWaitForGroup(sender: string, groupId: string): boolean {
    const gone = Number(this.meta(`groupGone:${groupId}`) ?? 0);
    if (gone && Date.now() - gone < GROUP_TOMBSTONE_MS) return false;
    if (sender === this.me()) return true;
    const c = this.contact(sender);
    if (c) return c.state !== 'blocked';
    return (
      this.db().prepare(`SELECT members FROM dm_groups WHERE state != 'left'`).all() as Array<{
        members: string;
      }>
    ).some((g) => this.list(g.members).includes(sender));
  }

  private keep(id: string, inbound: Inbound): void {
    this.setMeta(`inbox:${id}`, JSON.stringify(inbound));
  }

  private unkeep(id: string): void {
    this.storage().delete('meta', `dm:inbox:${id}`);
  }

  /** Kept messages from one sender that wait for a group. */
  private keptFrom(sender: string): number {
    return this.kept().filter(([, x]) => x.sender === sender && x.waitGroup).length;
  }

  private keptCount(): number {
    return (
      this.db()
        .prepare(`SELECT COUNT(*) AS n FROM signal_store WHERE kind = 'meta' AND id LIKE 'dm:inbox:%'`)
        .get() as { n: number }
    ).n;
  }

  /** Kept messages, oldest first (unreadable entries are removed). */
  private kept(): Array<[string, Inbound]> {
    const rows = this.db()
      .prepare(`SELECT id, value FROM signal_store WHERE kind = 'meta' AND id LIKE 'dm:inbox:%'`)
      .all() as Array<{ id: string; value: Uint8Array }>;
    const out: Array<[string, Inbound]> = [];
    for (const r of rows) {
      const id = r.id.slice('dm:inbox:'.length);
      try {
        const raw = JSON.parse(Buffer.from(r.value).toString('utf8')) as Inbound;
        // Calls and typing kept by older versions are long over.
        if (EPHEMERAL.has((raw.content as { t?: string } | undefined)?.t ?? '')) throw new Error('ephemeral');
        out.push([
          id,
          {
            sender: z.uuid().parse(raw.sender),
            receivedAt: z.iso.datetime().parse(raw.receivedAt),
            content: contentSchema.parse(raw.content),
            ...(raw.waitGroup ? { waitGroup: msgId.parse(raw.waitGroup) } : {}),
            keptAt: Number(raw.keptAt) || 0,
            tries: Number(raw.tries) || 0,
          },
        ]);
      } catch {
        this.unkeep(id);
      }
    }
    return out.sort((a, b) => a[1].keptAt - b[1].keptAt);
  }

  /** Applies kept messages again (all of them, or those waiting for one group that just arrived). */
  private retryKept(onlyGroup?: string): void {
    let list: Array<[string, Inbound]>;
    try {
      list = this.kept();
    } catch {
      return;
    }
    for (const [id, x] of list) {
      if (onlyGroup && x.waitGroup !== onlyGroup) continue;
      try {
        // Already applied meanwhile (a group that arrived replayed what waited for it).
        if (!this.meta(`inbox:${id}`)) continue;
        if (x.waitGroup && !this.group(x.waitGroup)) {
          if (Date.now() - x.keptAt > INBOX_WAIT_MS) this.unkeep(id);
          continue;
        }
        const { waitGroup: _w, ...rest } = x;
        // Unlink first: applying a group's details replays what waited for it (no double apply).
        this.unkeep(id);
        try {
          const wait = this.apply(rest);
          if (wait) this.keep(id, { ...rest, waitGroup: wait });
        } catch (err) {
          if (x.tries + 1 < INBOX_MAX_TRIES) this.keep(id, { ...x, tries: x.tries + 1 });
          else this.deps.log.warn(`Dropped a direct message that kept failing: ${(err as Error).message}`);
        }
      } catch {
        return; // storage went away: next time
      }
    }
  }

  /**
   * Applies one decrypted message. Returns a group ID when it is traffic for a group this device
   * does not know yet (it is then kept until the group's details arrive), otherwise null.
   */
  private apply(inbound: Inbound): string | null {
    const { content, sender: peer } = inbound;
    const me = this.me();
    if (peer === me) {
      switch (content.t) {
        case 'sync':
          return this.applySync(content.conv, content.message);
        case 'syncOp':
          return this.applySyncOp(content.conv, content.op);
        case 'contactsReq':
          void this.shareContacts();
          return null;
        case 'contacts':
          this.applyContacts(content.contacts);
          // Names this device does not have yet (its own name stays as typed here).
          if (content.devices) this.deps.account.setDeviceNames(content.devices, true);
          return null;
        case 'group':
          // A group this account created or changed (as its admin) on another device.
          this.applyGroupUpdate(me, content);
          return null;
        case 'groupLeave': {
          // We left (or removed) the group on another device.
          const g = this.group(content.groupId);
          if (g && g.state !== 'left') {
            this.saveGroup({
              ...g,
              state: 'left',
              members: JSON.stringify(this.list(g.members).filter((m) => m !== me)),
              admins: JSON.stringify(this.list(g.admins).filter((m) => m !== me)),
            });
            this.emitConversations();
          }
          return null;
        }
        default:
          return null;
      }
    }
    // Device-to-device content is only ever accepted from this account's own devices.
    if (
      content.t === 'sync' ||
      content.t === 'syncOp' ||
      content.t === 'contactsReq' ||
      content.t === 'contacts'
    )
      return null;
    const contact = this.contact(peer);
    if (contact?.state === 'blocked') return null;
    if (SOCIAL.has(content.t)) {
      this.socialHandler?.(peer, content as SocialContent);
      return null;
    }
    if (content.t === 'ckey' || content.t === 'ckeyReq') {
      // Community key exchange between members; not a conversation.
      const { v: _v, ...message } = content;
      void this.deps.community.handleKeyMessage(peer, message).catch(() => undefined);
      return null;
    }
    const now = new Date();
    if (content.t === 'group') {
      this.applyGroupUpdate(peer, content);
      return null;
    }
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
      return null;
    }
    if (content.t === 'profile' && content.groupId) {
      const g = this.group(content.groupId);
      if (!g) return this.mayWaitForGroup(peer, content.groupId) ? content.groupId : null;
      if (this.list(g.members).includes(peer)) {
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
      return null;
    }
    // Group traffic is accepted only from current members of a group we are in.
    const groupId = 'groupId' in content ? content.groupId : undefined;
    let conv = peer;
    if (groupId) {
      const g = this.group(groupId);
      // Not known yet (its details may still be on the way): wait for them, except typing.
      if (!g) return content.t !== 'typing' && this.mayWaitForGroup(peer, groupId) ? groupId : null;
      if (g.state === 'left' || !this.list(g.members).includes(peer)) return null;
      conv = groupId;
    }
    switch (content.t) {
      case 'msg': {
        if (!groupId && !contact) this.upsertContact(peer, 'request');
        const claimed = Date.parse(content.sentAt);
        const received = Date.parse(inbound.receivedAt);
        // A sender's clock may be wrong or lying: keep timestamps near when the server got it.
        const sentAt = new Date(
          Math.min(Math.max(claimed, received - 30 * 86_400_000), received + 60_000) || now.getTime(),
        ).toISOString();
        const exists = this.db().prepare('SELECT 1 FROM dm_messages WHERE id = ?').get(content.id);
        if (exists) return null;
        // A disappearing message's time starts when it reaches this device; this device's own
        // timer for the conversation applies too (the longer of the two).
        const ttl = Math.max(this.timerOf(conv), content.expiresIn ?? 0);
        const expiresAt = ttl ? new Date(now.getTime() + ttl * 1000).toISOString() : null;
        this.db()
          .prepare(
            `INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions, expires_at, received_at)
             VALUES (?, ?, ?, ?, ?, 'received', '{}', ?, ?)`,
          )
          .run(
            content.id,
            conv,
            peer,
            JSON.stringify({
              text: content.text,
              replyTo: content.replyTo,
              attachments: content.attachments,
              ...(content.silent ? { silent: true } : {}),
              ...(content.poll ? { poll: content.poll } : {}),
              ...(content.embed ? { embed: content.embed } : {}),
            }),
            sentAt,
            expiresAt,
            now.toISOString(),
          );
        this.db().prepare('UPDATE contacts SET heard_from = 1 WHERE river_id = ?').run(peer);
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
        return null;
      }
      case 'edit': {
        const row = this.row(content.id);
        if (row && row.peer === conv && row.sender === peer && !row.deleted) this.editRow(row, content.text);
        return null;
      }
      case 'pin': {
        const row = this.row(content.id);
        if (row && row.peer === conv && !row.deleted) this.setPinned(row, content.pinned);
        return null;
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
        return null;
      }
      case 'react': {
        const row = this.row(content.id);
        if (row && row.peer === conv) this.applyReaction(row, peer, content.emoji, content.on);
        return null;
      }
      case 'receipt': {
        // Read receipts off: you do not see other people's either (delivered still shows).
        if (content.kind === 'read' && !this.privacy().readReceipts) return null;
        const rank = { sending: 0, failed: 0, sent: 1, delivered: 2, read: 3 } as Record<string, number>;
        for (const id of content.ids) {
          const row = this.row(id);
          if (!row || row.peer !== peer || row.sender !== me) continue;
          if ((rank[content.kind] ?? 0) > (rank[row.status] ?? 0)) {
            this.db().prepare('UPDATE dm_messages SET status = ? WHERE id = ?').run(content.kind, id);
            this.emitMessage(id, false);
          }
        }
        return null;
      }
      case 'timer': {
        if (!groupId && contact?.state !== 'accepted') return null;
        this.applyTimer(conv, content.seconds, peer);
        return null;
      }
      case 'typing':
        if (!this.privacy().typing) return null;
        if (groupId) this.emit({ t: 'typing', peer: conv, who: peer });
        else if (contact?.state === 'accepted') this.emit({ t: 'typing', peer });
        return null;
      case 'call': {
        // Only accepted contacts can ring you; call setup is never stored.
        if (contact?.state !== 'accepted') return null;
        if (content.data !== undefined && JSON.stringify(content.data).length > 30_000) return null;
        // An invite that waited in the mailbox (or in storage) longer than a ring lasts is over.
        const age = now.getTime() - Date.parse(inbound.receivedAt);
        if (content.kind === 'invite' && !(age <= RING_MS)) return null;
        const event = {
          t: 'call' as const,
          peer,
          callId: content.callId,
          kind: content.kind,
          video: content.video ?? false,
          ...(content.data !== undefined ? { data: content.data } : {}),
        };
        // An invite is remembered while it rings, so a window that opens because of it can show it.
        if (content.kind === 'invite') this.ringing = { event, at: Date.now() };
        else if (this.ringing?.event.callId === content.callId) this.ringing = null;
        if (content.kind === 'accept') this.callAnswered.set(peer, Date.now());
        this.emit(event);
        return null;
      }
      case 'profile': {
        if (!contact) this.upsertContact(peer, 'request');
        // A profile shared with you directly means they accepted (or started) the conversation.
        if (!content.groupId)
          this.db().prepare('UPDATE contacts SET heard_from = 1 WHERE river_id = ?').run(peer);
        this.db()
          .prepare('UPDATE contacts SET name = ?, avatar = ?, bio = ? WHERE river_id = ?')
          .run(
            content.name ? content.name.slice(0, 64) : null,
            content.avatar ?? null,
            content.bio ?? null,
            peer,
          );
        this.emitConversations();
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * After a restore our old sessions are gone (they are never in backups), so
   * message every contact once: our new PreKey message gives them a fresh
   * session with us, and their later messages decrypt again. Remembered in
   * this device's database until everyone has been reached.
   */
  afterRestore(): void {
    this.protocolCache = null;
    this.reintroduce = true;
    try {
      this.setMeta('reintroduce', JSON.stringify({ targets: this.reintroductionTargets(), tries: 0 }));
    } catch {
      // storage unavailable: the in-memory flag covers this run
    }
  }

  /** Friends get our profile; people we share only groups with get a group-scoped one (no request). */
  private reintroductionTargets(): Array<{ peer: string; groupId?: string }> {
    const me = this.me();
    // Also people we wrote to who have not answered yet: their request stays readable.
    const friends = new Set(this.acceptedContacts(false));
    const targets: Array<{ peer: string; groupId?: string }> = [...friends].map((peer) => ({ peer }));
    const reached = new Set(friends);
    for (const g of this.db()
      .prepare(`SELECT id, members FROM dm_groups WHERE state != 'left'`)
      .all() as Array<{
      id: string;
      members: string;
    }>) {
      for (const m of this.list(g.members)) {
        if (m === me || reached.has(m)) continue;
        reached.add(m);
        targets.push({ peer: m, groupId: g.id });
      }
    }
    return targets;
  }

  private async reintroduceIfNeeded(): Promise<void> {
    if (this.reintroducing) return;
    type Saved = { targets: Array<{ peer: string; groupId?: string }>; tries: number };
    const saved = ((): Saved | null => {
      try {
        const raw = this.meta('reintroduce');
        const parsed = raw ? (JSON.parse(raw) as Saved) : null;
        return parsed && Array.isArray(parsed.targets) ? parsed : null;
      } catch {
        return null;
      }
    })();
    if (!saved && !this.reintroduce) return;
    this.reintroducing = true;
    try {
      const targets = saved?.targets ?? this.reintroductionTargets();
      this.reintroduce = false;
      const failed: Array<{ peer: string; groupId?: string }> = [];
      for (const t of targets) {
        try {
          await this.shareProfile(t.peer, t.groupId);
        } catch {
          failed.push(t);
        }
      }
      // People we could not reach are tried again on the next sync (for a while).
      const tries = (saved?.tries ?? 0) + 1;
      if (failed.length && tries < 20)
        this.setMeta('reintroduce', JSON.stringify({ targets: failed, tries }));
      else this.storage().delete('meta', 'dm:reintroduce');
    } finally {
      this.reintroducing = false;
    }
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

  /**
   * Your friends: accepted contacts who have answered. A request you sent (or a chat you only
   * opened) is not a friend yet, so posts and stories never go to them — as on the Friends page.
   */
  friends(): string[] {
    return this.acceptedContacts(true);
  }

  /** Accepted contacts, also those who have not answered yet unless `answered`. */
  private acceptedContacts(answered: boolean): string[] {
    return (
      this.db()
        .prepare(
          `SELECT river_id FROM contacts WHERE state = 'accepted'${answered ? ' AND heard_from = 1' : ''}`,
        )
        .all() as Array<{
        river_id: string;
      }>
    )
      .map((r) => r.river_id)
      .filter((id) => id !== this.me());
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

  /**
   * Saves your bio and returns it as saved. Friends get it a few seconds after the last change
   * (one profile update however often you save; unchanged profiles are never re-sent).
   */
  setMyBio(bio: string): string {
    const saved = bio.trim().slice(0, 300);
    const before = this.myBio();
    this.db()
      .prepare('INSERT INTO profile (id, bio) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET bio = excluded.bio')
      .run(saved);
    if (saved !== before) {
      clearTimeout(this.bioShareTimer);
      this.bioShareTimer = setTimeout(() => {
        this.bioShareTimer = undefined;
        void this.shareProfileWithFriends().catch(() => undefined);
      }, BIO_SHARE_DELAY_MS);
      this.bioShareTimer.unref?.();
    }
    return saved;
  }

  /** Sends your current profile to every friend who has not got it yet (others: next message). */
  async shareProfileWithFriends(): Promise<void> {
    if (!this.deps.db() || this.deps.account.status().state !== 'registered') return;
    for (const peer of this.friends()) {
      await this.shareProfile(peer).catch((err: unknown) =>
        this.deps.log.warn(`Could not share the profile with one friend: ${(err as Error).message}`),
      );
    }
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
        `INSERT INTO dm_groups (id, name, members, admins, profiles, state, created_at, last_read, icon)
         VALUES (@id, @name, @members, @admins, @profiles, @state, @created_at, @last_read, @icon)
         ON CONFLICT(id) DO UPDATE SET name = @name, members = @members, admins = @admins,
           profiles = @profiles, state = @state, last_read = @last_read, icon = @icon`,
      )
      .run({ ...g, icon: g.icon ?? null });
  }

  /**
   * Group state from an admin (or a new group that includes us), or from another of our own
   * devices (sender = us) for a group we created or changed there.
   */
  private applyGroupUpdate(
    sender: string,
    update: { groupId: string; name: string; members: string[]; admins: string[]; icon?: string | null },
  ): void {
    const me = this.me();
    const mine = sender === me;
    const members = [...new Set(update.members)].slice(0, MAX_GROUP);
    const admins = [...new Set(update.admins)].filter((a) => members.includes(a) || a === sender);
    const existing = this.group(update.groupId);
    if (existing) {
      if (!this.list(existing.admins).includes(sender)) return;
      const stillIn = members.includes(me);
      // Added back after leaving: you choose whether to rejoin (a request, not straight back in).
      const rejoin = existing.state === 'left' ? 'request' : existing.state;
      this.saveGroup({
        ...existing,
        icon: update.icon ?? null,
        name: update.name.slice(0, 64),
        members: JSON.stringify(members),
        admins: JSON.stringify(admins),
        state: !stillIn ? 'left' : mine ? 'accepted' : rejoin,
      });
    } else {
      if (!members.includes(me) || !members.includes(sender) || !admins.includes(sender)) return;
      if (!mine && this.contact(sender)?.state === 'blocked') return;
      this.saveGroup({
        id: update.groupId,
        icon: update.icon ?? null,
        name: update.name.slice(0, 64),
        members: JSON.stringify(members),
        admins: JSON.stringify(admins),
        profiles: '{}',
        // Groups started on our other devices or by people you have accepted open directly;
        // others are requests.
        state: mine || this.contact(sender)?.state === 'accepted' ? 'accepted' : 'request',
        created_at: new Date().toISOString(),
        last_read: null,
      });
      // Added (back) on purpose: it is no longer a removed group.
      this.storage().delete('meta', `dm:groupGone:${update.groupId}`);
      // Messages that arrived before the group's details can be shown now.
      this.retryKept(update.groupId);
    }
    this.emitConversations();
  }

  /**
   * Sends to a person, or to every other member of a group (pairwise libsignal sessions).
   * Returns the group members it could not be delivered to (the others got it).
   */
  private async deliver(conv: string, content: Content, ephemeral = false): Promise<string[]> {
    // Note to self (2.9): stays on this device; new notes reach linked devices as a sync.
    if (conv === this.me()) return [];
    if (!isGroupId(conv)) {
      await this.sendContent(conv, content, ephemeral);
      return [];
    }
    const g = this.group(conv);
    if (!g || g.state === 'left') throw new CommunityError('You are not in this group.');
    const me = this.me();
    const failed: string[] = [];
    const others = this.list(g.members).filter((m) => m !== me);
    for (const m of others) {
      // Our group-scoped profile is a nicety: the message still goes if sharing it fails.
      if (!ephemeral) {
        await this.shareProfile(m, conv).catch((err: unknown) =>
          this.deps.log.warn(`Group profile not shared: ${(err as Error).message}`),
        );
      }
      try {
        await this.sendContent(m, content, ephemeral);
      } catch {
        failed.push(m);
      }
    }
    if (others.length && failed.length === others.length && !ephemeral) {
      throw new CommunityError('The message could not be delivered to anyone in the group.');
    }
    return failed;
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
      ...(g.icon ? { icon: g.icon } : {}),
    };
    // Our other devices first, so they know the group before anyone in it answers.
    await this.toMyDevices(content, 'A group change');
    for (const m of recipients) {
      // The group must exist on their side before our group-scoped profile arrives.
      await this.sendContent(m, content).catch((err: unknown) =>
        this.deps.log.warn(`Group update not delivered: ${(err as Error).message}`),
      );
      if (this.list(g.members).includes(m)) await this.shareProfile(m, g.id).catch(() => undefined);
    }
  }

  /** How a person appears (contact name, shared community, or their group's records). */
  /**
   * Android (2.11): the call ringing now was answered on the phone's own call screen. River's
   * window, opening because of it, finds it as `pendingCall` with `answer` and answers it.
   */
  answerRinging(callId: string): boolean {
    if (!this.ringing || this.ringing.event.callId !== callId || Date.now() - this.ringing.at > RING_MS)
      return false;
    this.ringing.answer = true;
    return true;
  }

  /** The call ringing now (in memory only), or null. */
  ringingCall(): Extract<DmEvent, { t: 'call' }> | null {
    return this.ringing && Date.now() - this.ringing.at <= RING_MS ? this.ringing.event : null;
  }

  nameOf(riverId: string, g?: GroupRow): string {
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

  /** Sends content to this account's other devices (if it has any); failures are only logged. */
  private async toMyDevices(content: Content, what: string): Promise<void> {
    if (!this.deps.account.hasOtherDevices()) return;
    try {
      await this.sendContent(this.me(), content);
    } catch (err) {
      this.deps.log.warn(`${what} was not copied to your other devices: ${(err as Error).message}`);
    }
  }

  /** Copies a message we sent to this account's other devices (if it has any). */
  private async syncToMyDevices(
    conv: string,
    message: z.infer<z.ZodObject<typeof messageFields>>,
  ): Promise<void> {
    await this.toMyDevices({ v: 1, t: 'sync', conv, message }, 'A sent message');
  }

  /** Copies an edit, delete, reaction, pin, timer or read to this account's other devices. */
  private syncOp(conv: string, op: SyncOp): void {
    void this.toMyDevices({ v: 1, t: 'syncOp', conv, op }, 'A change');
  }

  /** Sends the friends list to this account's other devices (linked devices). */
  private async shareContacts(): Promise<void> {
    if (!this.deps.account.hasOtherDevices()) return;
    const rows = this.db()
      .prepare(`SELECT river_id, state, name FROM contacts WHERE state IN ('accepted', 'blocked') LIMIT 2000`)
      .all() as Array<{ river_id: string; state: 'accepted' | 'blocked'; name: string | null }>;
    const me = this.me();
    const contacts = rows
      .filter((r) => r.river_id !== me)
      .map((r) => ({
        riverId: r.river_id,
        state: r.state,
        name: r.name ? r.name.slice(0, 64) : null,
      }));
    try {
      await this.sendContent(this.me(), {
        v: 1,
        t: 'contacts',
        contacts,
        devices: this.deps.account.deviceNames(),
      });
    } catch (err) {
      this.deps.log.warn(`Your friends list was not copied to your other devices: ${(err as Error).message}`);
    }
  }

  /**
   * The friends list from another of our devices: people we do not know yet are added, requests
   * become friends, and blocks are applied. Nobody is unblocked or removed by a copy (a stale
   * list must never undo a block).
   */
  private applyContacts(
    contacts: Array<{ riverId: string; state: 'accepted' | 'blocked'; name: string | null }>,
  ): void {
    const me = this.me();
    for (const c of contacts) {
      if (c.riverId === me) continue;
      const existing = this.contact(c.riverId);
      if (c.state === 'blocked') {
        if (!existing) this.upsertContact(c.riverId, 'blocked', c.name);
        else if (existing.state !== 'blocked') this.setBlocked(c.riverId, existing.state);
        if (existing?.state !== 'blocked') this.notifyBlocked(c.riverId);
      } else if (!existing) {
        this.upsertContact(c.riverId, 'accepted', c.name);
      } else if (existing.state === 'request') {
        this.db().prepare(`UPDATE contacts SET state = 'accepted' WHERE river_id = ?`).run(c.riverId);
      }
    }
    this.setMeta('contactsSynced', me);
    this.emitConversations();
  }

  private contactsRequested = false;

  /** A device that has not had the friends list from its other devices yet asks for it, once a run. */
  private async requestContacts(): Promise<void> {
    if (this.contactsRequested || this.meta('contactsSynced') === this.me()) return;
    if (!this.deps.account.hasOtherDevices()) return;
    this.contactsRequested = true;
    try {
      await this.sendContent(this.me(), { v: 1, t: 'contactsReq' });
    } catch (err) {
      this.contactsRequested = false;
      this.deps.log.warn(`Could not ask your other devices for your friends list: ${(err as Error).message}`);
    }
  }

  /** Blocks someone here, remembering their state before so unblocking can restore it. */
  private setBlocked(riverId: string, before: ContactRow['state']): void {
    if (before !== 'blocked') this.setMeta(`unblockTo:${riverId}`, before);
    this.db().prepare(`UPDATE contacts SET state = 'blocked' WHERE river_id = ?`).run(riverId);
  }

  /** Someone was blocked (here or on another of our devices): their posts and stories go too. */
  onBlocked(listener: (riverId: string) => void): () => void {
    this.blockListeners.add(listener);
    return () => this.blockListeners.delete(listener);
  }

  private notifyBlocked(riverId: string): void {
    for (const l of this.blockListeners) {
      try {
        l(riverId);
      } catch (err) {
        this.deps.log.warn(`Could not clear a blocked person's posts: ${(err as Error).message}`);
      }
    }
  }

  /** A message this account sent from another device: show it as ours. */
  private applySync(conv: string, message: z.infer<z.ZodObject<typeof messageFields>>): string | null {
    if (this.db().prepare('SELECT 1 FROM dm_messages WHERE id = ?').get(message.id)) return null;
    if (isGroupId(conv)) {
      const g = this.group(conv);
      if (!g) return this.mayWaitForGroup(this.me(), conv) ? conv : null;
      if (g.state === 'left') return null;
    } else if (!this.contact(conv)) {
      this.upsertContact(conv, 'accepted');
    }
    // Disappearing messages: the time starts when the copy reaches this device.
    const now = new Date();
    const ttl = Math.max(this.timerOf(conv), message.expiresIn ?? 0);
    const expiresAt = ttl ? new Date(now.getTime() + ttl * 1000).toISOString() : null;
    this.db()
      .prepare(
        `INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions, expires_at, received_at)
         VALUES (?, ?, ?, ?, ?, 'sent', '{}', ?, ?)`,
      )
      .run(
        message.id,
        conv,
        this.me(),
        JSON.stringify({
          text: message.text,
          replyTo: message.replyTo,
          attachments: message.attachments,
          ...(message.poll ? { poll: message.poll } : {}),
          ...(message.embed ? { embed: message.embed } : {}),
        }),
        message.sentAt,
        expiresAt,
        now.toISOString(),
      );
    this.emitMessage(message.id, false);
    this.emitConversations();
    return null;
  }

  /**
   * A change this account made on another device. The same rules as for everyone else apply:
   * only our own messages are edited or deleted, and only in the conversation they are in.
   */
  private applySyncOp(conv: string, op: SyncOp): string | null {
    const me = this.me();
    if (isGroupId(conv)) {
      const g = this.group(conv);
      if (!g) return this.mayWaitForGroup(me, conv) ? conv : null;
      if (g.state === 'left' && op.t !== 'read') return null;
    }
    switch (op.t) {
      case 'edit': {
        const row = this.row(op.id);
        if (row && row.peer === conv && row.sender === me && !row.deleted) this.editRow(row, op.text);
        return null;
      }
      case 'delete': {
        // Deleted for everyone on another device: that device removed its copy, so does this one.
        const row = this.row(op.id);
        if (row && row.peer === conv && row.sender === me) {
          this.db().prepare('DELETE FROM dm_messages WHERE id = ?').run(op.id);
          this.emit({ t: 'remove', peer: conv, id: op.id });
          this.emitConversations();
        }
        return null;
      }
      case 'react': {
        const row = this.row(op.id);
        if (row && row.peer === conv) this.applyReaction(row, me, op.emoji, op.on);
        return null;
      }
      case 'pin': {
        const row = this.row(op.id);
        if (row && row.peer === conv && !row.deleted) this.setPinned(row, op.pinned);
        return null;
      }
      case 'timer':
        if (isGroupId(conv) || this.contact(conv)?.state === 'accepted')
          this.applyTimer(conv, op.seconds, me);
        return null;
      case 'read':
        this.markRead(conv, op.at);
        return null;
    }
  }

  /** Moves a conversation's read marker forward to `at` (never back); returns whether it moved. */
  private markRead(conv: string, at: string): boolean {
    this.clearMarkedUnread(conv);
    const table = isGroupId(conv) ? 'dm_groups' : 'contacts';
    const key = isGroupId(conv) ? 'id' : 'river_id';
    const moved =
      this.db()
        .prepare(
          `UPDATE ${table} SET last_read = ? WHERE ${key} = ? AND (last_read IS NULL OR last_read < ?)`,
        )
        .run(at, conv, at).changes > 0;
    this.emitConversations();
    return moved;
  }

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
    // The cached list is used while it is fresh; it is fetched and verified again at least daily,
    // and sooner when a message arrives from a device it does not have (hintDevice).
    const checkedAt = Number(this.meta(`devicesAt:${peer}`) ?? 0);
    const fresh = Date.now() - checkedAt < DEVICE_LIST_MAX_AGE_MS && checkedAt <= Date.now();
    if (!force && fresh && cached?.length && cached.every((d) => protocol.hasSession(peer, d.deviceId)))
      return cached;

    const { res, identityKey, list } = await this.verifiedKeys(peer);
    // A server must not bring back a device that was removed by replaying an older signed list.
    // Versions count per identity key: a new key (after a reinstall) starts its own list.
    const stored = peer === this.me() ? null : protocol.identityOf(peer);
    const sameKey = !stored || Buffer.from(stored).equals(identityKey);
    const seen = Number(this.meta(`listVersion:${peer}`) ?? '0');
    if (sameKey && list.version < seen) {
      throw new CommunityError(
        'The server offered an older device list for this person than River has already seen. Messages were not sent.',
      );
    }
    const devices: Array<{ deviceId: number; registrationId: number }> = [];
    for (const d of res.devices) {
      if (peer === this.me() && d.deviceId === this.deviceId()) continue;
      const listed = list.devices.find((x) => x.deviceId === d.deviceId);
      if (!listed || listed.registrationId !== d.registrationId) continue;
      if (force || !protocol.hasSession(peer, d.deviceId)) {
        await protocol.startSession(peer, identityKey, d);
      }
      devices.push({ deviceId: d.deviceId, registrationId: d.registrationId });
    }
    if (!devices.length) throw new CommunityError('That person has not set up messaging yet.');
    // This list is now the newest seen for the key River holds (libsignal accepted a new one, if any).
    const nowStored = peer === this.me() ? null : protocol.identityOf(peer);
    const adopted = !nowStored || Buffer.from(nowStored).equals(identityKey);
    if (adopted && (!sameKey || list.version > seen))
      this.setMeta(`listVersion:${peer}`, String(list.version));
    this.setMeta(`devices:${peer}`, JSON.stringify(devices));
    this.setMeta(`devicesAt:${peer}`, String(Date.now()));
    return devices;
  }

  /**
   * A person's key bundle, checked against what the server cannot forge on its own: the device
   * list must be signed by the identity key it comes with, and that key must match the one in
   * their sealed profile in a shared community (when there is one).
   */
  private async verifiedKeys(peer: string): Promise<{
    res: z.infer<typeof keyBundleResponseSchema>;
    identityKey: Buffer;
    list: z.infer<typeof deviceListSchema>;
  }> {
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
    const fromCommunity = peer === this.me() ? null : this.deps.community.communityIdentityKey(peer);
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
    return { res, identityKey, list };
  }

  /**
   * A contact's identity key changed on an incoming message. Accepted only if the server's
   * current bundle for them carries that same key, their device list is signed by it and lists
   * the sending device (with the registration ID it claimed), and no shared community holds a
   * different key for them. A verified contact stays marked "changed since verified" (sending
   * stops) until the user compares safety numbers again; verification is never cleared.
   */
  private async confirmIdentityChange(change: IncomingIdentityChange): Promise<boolean> {
    const peer = change.riverId;
    const newKey = Buffer.from(change.identityKey);
    try {
      const { identityKey, list } = await this.verifiedKeys(peer);
      if (!identityKey.equals(newKey)) return false;
      const listed = list.devices.find((d) => d.deviceId === change.deviceId);
      if (!listed) return false;
      if (change.registrationId !== null && listed.registrationId !== change.registrationId) return false;
      // The new key's device list starts its own version count; cached devices are looked up again.
      this.setMeta(`listVersion:${peer}`, String(list.version));
      this.storage().delete('meta', `dm:devicesAt:${peer}`);
      return true;
    } catch (err) {
      this.deps.log.warn(`A changed safety key was not accepted: ${(err as Error).message}`);
      return false;
    }
  }

  /** A message from a device the cached list does not have: look the list up again before sending. */
  private hintDevice(peer: string, deviceId: number): void {
    try {
      const raw = this.meta(`devices:${peer}`);
      if (!raw) return;
      const cached = JSON.parse(raw) as Array<{ deviceId: number }>;
      if (!cached.some((d) => d.deviceId === deviceId)) this.storage().delete('meta', `dm:devicesAt:${peer}`);
    } catch {
      // storage unavailable: the daily check still runs
    }
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
    if (peer === this.me()) return;
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
        case 'folders':
          return out(this.folderList());
        case 'saveFolder': {
          const list = this.folderList();
          const peers = [...new Set(act.peers)];
          if (act.id) {
            const i = list.findIndex((f) => f.id === act.id);
            if (i < 0) throw new CommunityError('That folder is gone.');
            list[i] = { id: act.id, name: act.name, peers };
          } else {
            if (list.length >= MAX_FOLDERS)
              throw new CommunityError(`You can have up to ${MAX_FOLDERS} folders.`);
            list.push({ id: randomBytes(16).toString('base64url'), name: act.name, peers });
          }
          this.setMeta('folders', JSON.stringify(list));
          return out(list);
        }
        case 'deleteFolder': {
          const list = this.folderList().filter((f) => f.id !== act.id);
          this.setMeta('folders', JSON.stringify(list));
          return out(list);
        }
        case 'noteToSelf': {
          const me = this.me();
          if (!this.contact(me)) this.upsertContact(me, 'accepted', NOTE_TO_SELF, null);
          this.emitConversations();
          return out(this.conversations().find((c) => c.riverId === me)!);
        }
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
        case 'logCall': {
          // Someone answered (we or they) but the call never connected: it failed, it was not missed.
          const answeredAt = this.callAnswered.get(act.peer);
          this.callAnswered.delete(act.peer);
          const outcome: CallOutcome = act.answered
            ? 'answered'
            : (act.outcome ??
              (answeredAt !== undefined && Date.now() - answeredAt < CALL_ANSWER_WINDOW_MS
                ? 'failed'
                : 'missed'));
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
              CALL_OUTCOME_CODE[outcome],
              act.durationSec,
            );
          this.emit({ t: 'calls' });
          return out(null);
        }
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
              outcome: CALL_OUTCOMES[c.answered] ?? 'missed',
              durationSec: c.duration_sec,
              startedAt: c.started_at,
            })),
          );
        case 'search': {
          const like = `%${act.query.replace(/[!%_]/g, (c) => `!${c}`)}%`;
          const rows = this.db()
            .prepare(
              `SELECT * FROM dm_messages
               WHERE deleted = 0 AND (? IS NULL OR peer = ?)
                 AND (json_extract(body, '$.text') LIKE ? ESCAPE '!'
                 OR EXISTS (SELECT 1 FROM json_each(body, '$.attachments') AS a
                            WHERE json_extract(a.value, '$.name') LIKE ? ESCAPE '!'))
               ORDER BY sent_at DESC LIMIT 100`,
            )
            .all(act.peer ?? null, act.peer ?? null, like, like) as MessageRow[];
          return out(rows.map((r) => this.view(r)));
        }
        case 'conversations':
          return out(this.conversations());
        case 'messages': {
          // The latest 500, or everything since `since` when that is more (up to 5000).
          const latest = (): MessageRow[] =>
            this.db()
              .prepare(
                'SELECT * FROM (SELECT * FROM dm_messages WHERE peer = ? ORDER BY sent_at DESC LIMIT 500) ORDER BY sent_at',
              )
              .all(act.peer) as MessageRow[];
          let rows = act.since
            ? (this.db()
                .prepare(
                  'SELECT * FROM (SELECT * FROM dm_messages WHERE peer = ? AND sent_at >= ? ORDER BY sent_at DESC LIMIT 5000) ORDER BY sent_at',
                )
                .all(act.peer, act.since) as MessageRow[])
            : [];
          if (rows.length < 500) rows = latest();
          return out(rows.map((r) => this.view(r)));
        }
        case 'open': {
          if (act.peer === this.me()) throw new CommunityError('That is your own River ID.');
          await this.prepareSessions(act.peer);
          const known = this.deps.community.knownProfile(act.peer);
          this.upsertContact(act.peer, 'accepted', act.name ?? known?.name ?? null, known?.avatar ?? null);
          this.emitConversations();
          return out(this.conversations().find((c) => c.riverId === act.peer)!);
        }
        case 'send':
          return out(await this.sendMessage(act));
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
          this.editRow(row, act.text);
          this.syncOp(act.peer, { t: 'edit', id: act.id, text: act.text });
          return out(null);
        }
        case 'pin': {
          const row = this.row(act.id);
          if (!row || row.peer !== act.peer || row.deleted) throw new CommunityError('That message is gone.');
          await this.deliver(act.peer, {
            v: 1,
            t: 'pin',
            id: act.id,
            pinned: act.pinned,
            ...(isGroupId(act.peer) ? { groupId: act.peer } : {}),
          });
          this.setPinned(row, act.pinned);
          this.syncOp(act.peer, { t: 'pin', id: act.id, pinned: act.pinned });
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
            this.syncOp(act.peer, { t: 'delete', id: act.id });
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
          this.syncOp(act.peer, { t: 'react', id: act.id, emoji: act.emoji, on: act.on });
          return out(null);
        }
        case 'schedule': {
          const when = Date.parse(act.sendAt);
          if (when < Date.now() + 30_000)
            throw new CommunityError('Choose a time at least a minute from now.');
          if (when > Date.now() + 366 * 86_400_000) throw new CommunityError('Choose a time within a year.');
          const list = this.scheduledList();
          if (list.length >= 100) throw new CommunityError('You have 100 messages waiting already.');
          const item: ScheduledItem = {
            id: randomBytes(16).toString('base64url'),
            peer: act.peer,
            text: act.text,
            ...(act.replyTo ? { replyTo: act.replyTo } : {}),
            attachments: act.attachments ?? [],
            sendAt: new Date(when).toISOString(),
            silent: act.silent === true,
            failed: false,
          };
          this.setScheduled([...list, item]);
          return out(scheduledView(item));
        }
        case 'scheduled':
          return out(
            this.scheduledList()
              .filter((x) => x.peer === act.peer)
              .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
              .map(scheduledView),
          );
        case 'cancelScheduled': {
          // Being sent right now: if that attempt fails, it is not put back.
          const flight = this.scheduledInFlight.get(act.id);
          if (flight) flight.cancelled = true;
          this.setScheduled(this.scheduledList().filter((x) => x.id !== act.id));
          return out(null);
        }
        case 'sendScheduledNow':
          await this.sendScheduled(act.id);
          return out(null);
        case 'setTimer': {
          if (isGroupId(act.peer)) {
            const g = this.group(act.peer);
            if (!g || g.state === 'left') throw new CommunityError('You are not in this group.');
          } else if (this.contact(act.peer)?.state !== 'accepted') {
            throw new CommunityError('You can set a timer once you are friends.');
          }
          await this.deliver(act.peer, {
            v: 1,
            t: 'timer',
            seconds: act.seconds,
            ...(isGroupId(act.peer) ? { groupId: act.peer } : {}),
          });
          this.applyTimer(act.peer, act.seconds, this.me());
          this.syncOp(act.peer, { t: 'timer', seconds: act.seconds });
          return out(null);
        }
        case 'chatFlags': {
          const prefs = this.chatPrefs();
          const p = { ...prefs[act.peer] };
          if (act.pinned === true && !p.pinnedAt) {
            // Only conversations that still exist count (a removed one may have left a pin behind).
            const existing = this.conversationIds();
            const pinned = Object.entries(prefs).filter(([id, x]) => x.pinnedAt && existing.has(id)).length;
            if (pinned >= MAX_PINNED) {
              throw new CommunityError(`You can pin up to ${MAX_PINNED} conversations.`);
            }
            p.pinnedAt = new Date().toISOString();
            p.archived = false;
          }
          if (act.pinned === false) delete p.pinnedAt;
          if (act.archived !== undefined) {
            p.archived = act.archived;
            if (act.archived) delete p.pinnedAt;
          }
          if (act.markedUnread !== undefined) p.unread = act.markedUnread;
          this.setChatPrefs({ ...prefs, [act.peer]: p });
          this.emitConversations();
          return out(null);
        }
        case 'read': {
          const now = new Date().toISOString();
          const group = isGroupId(act.peer) ? this.group(act.peer) : undefined;
          const contact = group ? undefined : this.contact(act.peer);
          if (!group && !contact) {
            this.clearMarkedUnread(act.peer);
            return out(null);
          }
          // Unread means arrived on this device after you last read (not the sender's claimed time).
          const unread = this.db()
            .prepare(
              `SELECT id FROM dm_messages WHERE peer = ? AND sender ${group ? '!=' : '='} ?
                 AND COALESCE(received_at, sent_at) > ? AND deleted = 0 ORDER BY sent_at`,
            )
            .all(act.peer, group ? this.me() : act.peer, (group ?? contact)?.last_read ?? '') as Array<{
            id: string;
          }>;
          this.markRead(act.peer, now);
          // Your other devices mark it read too.
          if (unread.length && act.peer !== this.me()) this.syncOp(act.peer, { t: 'read', at: now });
          if (
            contact &&
            unread.length &&
            contact.state === 'accepted' &&
            act.peer !== this.me() &&
            this.privacy().readReceipts
          ) {
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
          if (!this.privacy().typing) return out(null);
          if (isGroupId(act.peer)) {
            if (this.group(act.peer)?.state === 'accepted') {
              void this.deliver(act.peer, { v: 1, t: 'typing', groupId: act.peer }, true).catch(
                () => undefined,
              );
            }
          } else if (act.peer !== this.me() && this.contact(act.peer)?.state === 'accepted') {
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
          // Sharing your profile is also how the other side learns you accepted.
          await this.shareProfile(act.peer).catch(() => undefined);
          void this.shareContacts();
          return out(null);
        case 'block': {
          await this.deps.community.api(`/blocks/${act.peer}`, 'PUT', {}, z.unknown());
          const before = this.contact(act.peer);
          if (!before) this.upsertContact(act.peer, 'blocked');
          else this.setBlocked(act.peer, before.state);
          this.emitConversations();
          if (before?.state !== 'blocked') this.notifyBlocked(act.peer);
          void this.shareContacts();
          return out(null);
        }
        case 'unblock': {
          await this.deps.community.api(`/blocks/${act.peer}`, 'DELETE', undefined, z.unknown());
          if (this.contact(act.peer)?.state === 'blocked') {
            // Back to what it was before the block: a request stays a request. Blocks from before
            // this was remembered: a friend if you ever wrote to them, otherwise a request.
            const saved = this.meta(`unblockTo:${act.peer}`);
            const wrote = !!this.db()
              .prepare('SELECT 1 FROM dm_messages WHERE peer = ? AND sender = ? LIMIT 1')
              .get(act.peer, this.me());
            const state =
              saved === 'accepted' || saved === 'request' ? saved : wrote ? 'accepted' : 'request';
            this.db().prepare('UPDATE contacts SET state = ? WHERE river_id = ?').run(state, act.peer);
          }
          this.storage().delete('meta', `dm:unblockTo:${act.peer}`);
          this.emitConversations();
          return out(null);
        }
        case 'removeConversation':
          if (isGroupId(act.peer)) {
            const g = this.group(act.peer);
            if (g && g.state !== 'left') {
              await this.deliver(act.peer, { v: 1, t: 'groupLeave', groupId: act.peer }).catch(
                () => undefined,
              );
              void this.toMyDevices({ v: 1, t: 'groupLeave', groupId: act.peer }, 'Leaving a group');
            }
            this.db().prepare('DELETE FROM dm_messages WHERE peer = ?').run(act.peer);
            this.db().prepare('DELETE FROM dm_groups WHERE id = ?').run(act.peer);
            // Remembered as removed: its traffic is dropped instead of waiting for the group to return.
            this.setMeta(`groupGone:${act.peer}`, String(Date.now()));
            for (const [id, x] of this.kept()) if (x.waitGroup === act.peer) this.unkeep(id);
            this.forgetConversation(act.peer);
            this.emitConversations();
            return out(null);
          }
          this.db().prepare('DELETE FROM dm_messages WHERE peer = ?').run(act.peer);
          this.db().prepare(`DELETE FROM contacts WHERE river_id = ? AND state != 'blocked'`).run(act.peer);
          this.forgetConversation(act.peer);
          this.emitConversations();
          return out(null);
        case 'pendingCall': {
          const ringing = this.ringing;
          if (!ringing || Date.now() - ringing.at > RING_MS) return out(null);
          return out(ringing.answer ? { ...ringing.event, answer: true } : ringing.event);
        }
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
            changedSinceVerified: this.protocol().verificationState(act.peer) === 'changed',
            theirName: this.contact(act.peer)?.name ?? 'This person',
          });
        }
        case 'setVerified': {
          if (!act.verified) {
            this.protocol().setVerified(act.peer, false);
          } else {
            // Only the key whose safety number the user compared is marked: if it changed while
            // the number was on screen, nothing is marked.
            const mine = this.deps.identity.protocolIdentity();
            const theirs = this.protocol().identityOf(act.peer);
            const shown =
              mine && theirs
                ? safetyNumber(
                    { riverId: mine.riverId, publicKey: mine.publicKey },
                    { riverId: act.peer, publicKey: theirs },
                  ).digits
                : null;
            if (
              !theirs ||
              !act.digits ||
              shown !== act.digits ||
              !this.protocol().setVerified(act.peer, true, theirs)
            )
              throw new CommunityError(
                'The safety number changed while it was on screen. Compare the new number before verifying.',
              );
          }
          this.db().prepare('UPDATE contacts SET key_changed = 0 WHERE river_id = ?').run(act.peer);
          this.emitConversations();
          return out(null);
        }
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
        case 'setGroupIcon': {
          const g = this.group(act.peer);
          if (!g || !this.list(g.admins).includes(this.me())) {
            throw new CommunityError('Only group admins can change the group.');
          }
          const next: GroupRow = { ...g, icon: act.icon };
          this.saveGroup(next);
          await this.sendGroupState(next);
          this.emitConversations();
          return out(null);
        }
        case 'renameGroup':
        case 'addGroupMembers':
        case 'removeGroupMember': {
          const isAdmin = (x: GroupRow | undefined): x is GroupRow =>
            !!x && x.state !== 'left' && this.list(x.admins).includes(this.me());
          let g = this.group(act.peer);
          if (!isAdmin(g)) throw new CommunityError('Only group admins can change the group.');
          let removed: string[] = [];
          if (act.a === 'addGroupMembers') {
            const before = this.list(g.members);
            for (const m of act.members) if (!before.includes(m)) await this.prepareSessions(m);
            // The group may have changed while we waited (someone left): start from what it is now.
            g = this.group(act.peer);
            if (!isAdmin(g)) throw new CommunityError('Only group admins can change the group.');
          }
          let members = this.list(g.members);
          if (act.a === 'addGroupMembers') {
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
          void this.toMyDevices({ v: 1, t: 'groupLeave', groupId: act.peer }, 'Leaving a group');
          const me = this.me();
          // Read again: the group may have changed while the goodbyes were sent.
          const latest = this.group(act.peer) ?? g;
          this.saveGroup({
            ...latest,
            state: 'left',
            members: JSON.stringify(this.list(latest.members).filter((m) => m !== me)),
            admins: JSON.stringify(this.list(latest.admins).filter((m) => m !== me)),
          });
          this.emitConversations();
          return out(null);
        }
        case 'call':
          if (act.peer === this.me() || this.contact(act.peer)?.state !== 'accepted')
            throw new CommunityError('You can only call your contacts.');
          // Answered, declined or ended here: the call no longer rings for a window that opens later.
          if (act.kind !== 'signal' && act.kind !== 'invite' && this.ringing?.event.callId === act.callId)
            this.ringing = null;
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
          if (act.kind === 'accept') this.callAnswered.set(act.peer, Date.now());
          return out(null);
      }
    } catch (err) {
      if (err instanceof SafetyNumberChangedError) throw new CommunityError(err.message);
      throw err;
    }
  }

  /**
   * Sends a message. `reuseId` (scheduled messages) retries the same message: its earlier failed
   * copy is reused instead of adding another one, and receivers ignore a copy they already have.
   */
  private async sendMessage(act: SendAct, reuseId?: string): Promise<DirectMessageView> {
    const group = isGroupId(act.peer) ? this.group(act.peer) : undefined;
    if (isGroupId(act.peer)) {
      if (!group || group.state === 'left') throw new CommunityError('You are not in this group.');
      if (group.state === 'request') this.saveGroup({ ...group, state: 'accepted' });
    } else {
      const contact = this.contact(act.peer);
      if (contact?.state === 'blocked') throw new CommunityError('Unblock this person to message them.');
      if (!contact || contact.state === 'request') this.upsertContact(act.peer, 'accepted');
    }
    const me = this.me();
    const earlier = reuseId ? this.row(reuseId) : undefined;
    const reuse = !!earlier && earlier.sender === me && earlier.peer === act.peer;
    const id = reuseId && (!earlier || reuse) ? reuseId : randomBytes(16).toString('base64url');
    const sentAt = new Date().toISOString();
    const body = {
      text: act.text,
      replyTo: act.replyTo,
      attachments: act.attachments,
      ...(act.poll ? { poll: act.poll } : {}),
      ...(act.embed ? { embed: act.embed } : {}),
    };
    const ttl = this.timerOf(act.peer);
    const expiresAt = ttl ? new Date(Date.parse(sentAt) + ttl * 1000).toISOString() : null;
    if (reuse) {
      this.db()
        .prepare(
          `UPDATE dm_messages SET body = ?, sent_at = ?, received_at = ?, status = 'sending', expires_at = ?
           WHERE id = ?`,
        )
        .run(JSON.stringify(body), sentAt, sentAt, expiresAt, id);
    } else {
      this.db()
        .prepare(
          `INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions, expires_at, received_at)
           VALUES (?, ?, ?, ?, ?, 'sending', '{}', ?, ?)`,
        )
        .run(id, act.peer, me, JSON.stringify(body), sentAt, expiresAt, sentAt);
    }
    this.emitMessage(id, false);
    try {
      if (!group) await this.shareProfile(act.peer);
      const undelivered = await this.deliver(act.peer, {
        v: 1,
        t: 'msg',
        id,
        text: act.text,
        ...(act.replyTo ? { replyTo: act.replyTo } : {}),
        ...(act.attachments?.length ? { attachments: act.attachments } : {}),
        sentAt,
        ...(group ? { groupId: group.id } : {}),
        ...(ttl ? { expiresIn: ttl } : {}),
        ...(act.silent ? { silent: true } : {}),
        ...(act.poll ? { poll: act.poll } : {}),
        ...(act.embed ? { embed: act.embed } : {}),
      });
      if (undelivered.length) {
        // Some group members did not get it (the others did): recorded on the message.
        this.deps.log.warn(`A group message was not delivered to ${undelivered.length} member(s)`);
        this.db()
          .prepare('UPDATE dm_messages SET body = ? WHERE id = ?')
          .run(JSON.stringify({ ...body, undelivered }), id);
      }
      this.db().prepare(`UPDATE dm_messages SET status = 'sent' WHERE id = ? AND status = 'sending'`).run(id);
      void this.syncToMyDevices(act.peer, {
        id,
        text: act.text,
        ...(act.replyTo ? { replyTo: act.replyTo } : {}),
        ...(act.attachments?.length ? { attachments: act.attachments } : {}),
        sentAt,
        ...(group ? { groupId: group.id } : {}),
        ...(ttl ? { expiresIn: ttl } : {}),
        ...(act.poll ? { poll: act.poll } : {}),
        ...(act.embed ? { embed: act.embed } : {}),
      });
    } catch (err) {
      this.db().prepare(`UPDATE dm_messages SET status = 'failed' WHERE id = ?`).run(id);
      this.emitMessage(id, false);
      throw err;
    }
    this.emitMessage(id, false);
    this.emitConversations();
    return this.view(this.row(id)!);
  }

  /** Changes a message's text (an edit by its author) and refreshes the chat list if it is the latest. */
  private editRow(row: MessageRow, text: string): void {
    const body = JSON.parse(row.body) as Record<string, unknown>;
    this.db()
      .prepare('UPDATE dm_messages SET body = ?, edited_at = ? WHERE id = ?')
      .run(JSON.stringify({ ...body, text }), new Date().toISOString(), row.id);
    this.emitMessage(row.id, false);
    const latest = this.db()
      .prepare('SELECT id FROM dm_messages WHERE peer = ? ORDER BY sent_at DESC LIMIT 1')
      .get(row.peer) as { id: string } | undefined;
    if (latest?.id === row.id) this.emitConversations();
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

  /** Pins live in the local copy of the message (1.0.29). */
  private setPinned(row: MessageRow, pinned: boolean): void {
    const body = JSON.parse(row.body) as Record<string, unknown>;
    const { pinned: _was, ...rest } = body;
    this.db()
      .prepare('UPDATE dm_messages SET body = ? WHERE id = ?')
      .run(JSON.stringify(pinned ? { ...rest, pinned: true } : rest), row.id);
    this.emitMessage(row.id, false);
  }

  private view(r: MessageRow): DirectMessageView {
    const body = JSON.parse(r.body) as {
      text?: string;
      replyTo?: string;
      attachments?: AttachmentPointer[];
      pinned?: unknown;
      notice?: { timer?: unknown };
      silent?: unknown;
      poll?: unknown;
      embed?: unknown;
      undelivered?: unknown;
    };
    const me = this.me();
    const reactions = JSON.parse(r.reactions) as Record<string, string[]>;
    const undelivered = Array.isArray(body.undelivered)
      ? body.undelivered.filter((x): x is string => typeof x === 'string')
      : [];
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
      pinned: !r.deleted && body.pinned === true,
      status: r.status as DirectMessageView['status'],
      reactions: Object.entries(reactions).map(([emoji, users]) => ({
        emoji,
        count: users.length,
        mine: users.includes(me),
        users,
      })),
      expiresAt: r.expires_at ?? null,
      silent: body.silent === true,
      poll: r.deleted ? null : readPoll(body.poll),
      embed: r.deleted ? null : this.embedOf(body.embed, String(body.text ?? '')),
      notice: body.notice && typeof body.notice.timer === 'number' ? { timer: body.notice.timer } : null,
      ...(undelivered.length && r.sender === me ? { undeliveredTo: undelivered } : {}),
    };
  }

  /** A preview only for a link that is really in the message. */
  private embedOf(raw: unknown, text: string): DirectMessageView['embed'] {
    const e = linkEmbedSchema.safeParse(raw);
    return e.success && text.includes(e.data.url) ? e.data : null;
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

  private privacy(): { readReceipts: boolean; typing: boolean } {
    return this.deps.privacy?.() ?? { readReceipts: true, typing: true };
  }

  /** Disappearing-message timers per conversation (2.4), in this device's encrypted database. */
  private timers(): Record<string, number> {
    try {
      const raw = this.meta('timers');
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
    } catch {
      return {};
    }
  }

  timerOf(conv: string): number {
    const t = this.timers()[conv];
    return typeof t === 'number' && t > 0 && t <= MAX_TIMER ? t : 0;
  }

  /** Sets the timer and adds a notice to the conversation ("X set messages to disappear after…"). */
  private applyTimer(conv: string, seconds: number, by: string): void {
    const timers = this.timers();
    if ((timers[conv] ?? 0) === seconds) return;
    if (seconds) timers[conv] = seconds;
    else delete timers[conv];
    this.setMeta('timers', JSON.stringify(timers));
    const id = randomBytes(16).toString('base64url');
    const now = new Date().toISOString();
    this.db()
      .prepare(
        `INSERT INTO dm_messages (id, peer, sender, body, sent_at, status, reactions, received_at)
         VALUES (?, ?, ?, ?, ?, 'received', '{}', ?)`,
      )
      .run(id, conv, by, JSON.stringify({ text: '', notice: { timer: seconds } }), now, now);
    this.emitMessage(id, true);
    this.emitConversations();
  }

  private scheduledList(): ScheduledItem[] {
    try {
      const raw = this.meta('scheduled');
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as ScheduledItem[]) : [];
    } catch {
      return [];
    }
  }

  private setScheduled(list: ScheduledItem[]): void {
    this.setMeta('scheduled', JSON.stringify(list));
    this.emit({ t: 'scheduled' });
  }

  private sendingScheduled = false;

  /**
   * Sends one scheduled message now. It is taken off the list before anything is awaited, so a
   * cancelled item, or one already being sent (the timer and "send now" at once), is never sent
   * (again). A failed attempt puts it back with a back-off, unless it was cancelled meanwhile;
   * every attempt reuses the same message, so retries never add more failed copies.
   */
  private async sendScheduled(id: string): Promise<boolean> {
    const list = this.scheduledList();
    const item = list.find((x) => x.id === id);
    if (!item || this.scheduledInFlight.has(id)) return false;
    this.setScheduled(list.filter((x) => x.id !== id));
    const flight = { cancelled: false };
    this.scheduledInFlight.set(id, flight);
    const messageId =
      item.messageId && msgId.safeParse(item.messageId).success
        ? item.messageId
        : randomBytes(16).toString('base64url');
    try {
      const act = dmActionSchema.parse({
        a: 'send',
        peer: item.peer,
        text: item.text,
        ...(item.replyTo ? { replyTo: item.replyTo } : {}),
        ...(item.attachments.length ? { attachments: item.attachments } : {}),
        ...(item.silent ? { silent: true } : {}),
      }) as SendAct;
      await this.sendMessage(act, messageId);
      return true;
    } catch (err) {
      this.deps.log.warn(`A scheduled message was not sent: ${(err as Error).message}`);
      if (!flight.cancelled) {
        const tries = (item.tries ?? 0) + 1;
        try {
          this.setScheduled([
            ...this.scheduledList(),
            {
              ...item,
              failed: true,
              messageId,
              tries,
              retryAt: new Date(Date.now() + scheduledBackoff(tries)).toISOString(),
            },
          ]);
        } catch {
          // storage unavailable
        }
      }
      return false;
    } finally {
      this.scheduledInFlight.delete(id);
    }
  }

  /** Sends scheduled messages whose time (or next retry) has come (2.5). Returns how many went out. */
  async sendDueScheduled(now = new Date()): Promise<number> {
    if (this.sendingScheduled) return 0;
    this.sendingScheduled = true;
    try {
      const due = this.scheduledList().filter((x) => Date.parse(x.retryAt ?? x.sendAt) <= now.getTime());
      let sent = 0;
      for (const item of due) if (await this.sendScheduled(item.id)) sent++;
      return sent;
    } finally {
      this.sendingScheduled = false;
    }
  }

  /** Everything kept about a conversation that was removed: its flags, timer, folders and schedule. */
  private forgetConversation(peer: string): void {
    const prefs = this.chatPrefs();
    if (prefs[peer]) {
      delete prefs[peer];
      this.setChatPrefs(prefs);
    }
    const timers = this.timers();
    if (peer in timers) {
      delete timers[peer];
      this.setMeta('timers', JSON.stringify(timers));
    }
    const folders = this.folderList();
    if (folders.some((f) => f.peers.includes(peer))) {
      this.setMeta(
        'folders',
        JSON.stringify(folders.map((f) => ({ ...f, peers: f.peers.filter((p) => p !== peer) }))),
      );
    }
    const scheduled = this.scheduledList();
    if (scheduled.some((x) => x.peer === peer)) {
      for (const x of scheduled) {
        if (x.peer === peer) {
          const flight = this.scheduledInFlight.get(x.id);
          if (flight) flight.cancelled = true;
        }
      }
      this.setScheduled(scheduled.filter((x) => x.peer !== peer));
    }
  }

  /** IDs of the conversations that exist (people and groups). */
  private conversationIds(): Set<string> {
    return new Set(
      (
        this.db()
          .prepare('SELECT river_id AS id FROM contacts UNION SELECT id FROM dm_groups')
          .all() as Array<{
          id: string;
        }>
      ).map((r) => r.id),
    );
  }
  /** Deletes this device's copies of messages whose time is up (2.4). Returns how many. */
  sweepExpired(now = new Date()): number {
    const db = this.db();
    const rows = db
      .prepare('SELECT id, peer, body FROM dm_messages WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .all(now.toISOString()) as Array<{ id: string; peer: string; body: string }>;
    for (const r of rows) {
      db.prepare('DELETE FROM dm_messages WHERE id = ?').run(r.id);
      try {
        const body = JSON.parse(r.body) as { attachments?: Array<{ id: string }> };
        for (const a of body.attachments ?? []) void this.deps.community.forgetAttachment?.(a.id);
      } catch {
        // nothing to forget
      }
      this.emit({ t: 'remove', peer: r.peer, id: r.id });
    }
    if (rows.length) this.emitConversations();
    return rows.length;
  }

  /** Chat-list flags per conversation (2.1), in this device's encrypted database. */
  /** Chat folders (2.10.8), in this device's encrypted database. */
  private folderList(): ChatFolder[] {
    try {
      const raw: unknown = JSON.parse(this.meta('folders') ?? '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter(
          (f): f is ChatFolder =>
            !!f &&
            typeof f === 'object' &&
            typeof (f as ChatFolder).id === 'string' &&
            typeof (f as ChatFolder).name === 'string' &&
            Array.isArray((f as ChatFolder).peers),
        )
        .slice(0, MAX_FOLDERS);
    } catch {
      return [];
    }
  }

  private chatPrefs(): Record<string, ChatPrefs> {
    try {
      const raw = this.meta('chatPrefs');
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, ChatPrefs>) : {};
    } catch {
      return {};
    }
  }

  private setChatPrefs(prefs: Record<string, ChatPrefs>): void {
    const kept = Object.fromEntries(
      Object.entries(prefs).filter(([, p]) => p.pinnedAt || p.archived || p.unread),
    );
    this.setMeta('chatPrefs', JSON.stringify(kept));
  }

  private clearMarkedUnread(peer: string): void {
    const prefs = this.chatPrefs();
    if (!prefs[peer]?.unread) return;
    this.setChatPrefs({ ...prefs, [peer]: { ...prefs[peer], unread: false } });
  }

  conversations(): ConversationView[] {
    const prefs = this.chatPrefs();
    const flags = (id: string): Pick<ConversationView, 'pinned' | 'archived' | 'markedUnread' | 'timer'> => ({
      pinned: !!prefs[id]?.pinnedAt,
      archived: !!prefs[id]?.archived,
      markedUnread: !!prefs[id]?.unread,
      timer: this.timerOf(id),
    });
    const contacts = this.db().prepare('SELECT * FROM contacts').all() as ContactRow[];
    const groups = this.db().prepare('SELECT * FROM dm_groups').all() as GroupRow[];
    const protocol = this.deps.identity.protocolIdentity() ? this.protocol() : null;
    const me = this.me();
    const groupViews: ConversationView[] = groups.map((g) => {
      const admins = this.list(g.admins);
      const unread = (
        this.db()
          .prepare(
            'SELECT COUNT(*) AS n FROM dm_messages WHERE peer = ? AND sender != ? AND COALESCE(received_at, sent_at) > ? AND deleted = 0',
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
        icon: g.icon ?? null,
        state: g.state,
        last: this.lastOf(g.id),
        unread,
        verified: false,
        keyChanged: false,
        awaitingReply: false,
        ...flags(g.id),
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
              'SELECT COUNT(*) AS n FROM dm_messages WHERE peer = ? AND sender = ? AND COALESCE(received_at, sent_at) > ? AND deleted = 0',
            )
            .get(c.river_id, c.river_id, c.last_read ?? '') as { n: number }
        ).n;
        const known = this.deps.community.knownProfile(c.river_id);
        const lastView = last ? this.view(last) : null;
        const self = c.river_id === me;
        return {
          riverId: c.river_id,
          kind: 'direct' as const,
          members: [],
          isAdmin: false,
          ...(self ? { self: true } : {}),
          name: self ? NOTE_TO_SELF : (c.name ?? known?.name ?? `River ${c.river_id.slice(0, 8)}`),
          avatar: c.avatar ?? known?.avatar ?? null,
          state: c.state,
          last: lastView
            ? {
                text: lastView.notice
                  ? '⏱ Disappearing messages changed'
                  : lastView.deleted
                    ? 'Message deleted'
                    : lastView.text ||
                      (lastView.attachments.length ? `📎 ${lastView.attachments[0]!.name}` : ''),
                sentAt: lastView.sentAt,
                mine: lastView.mine,
              }
            : null,
          unread: self ? 0 : unread,
          verified: !self && (protocol?.isVerified(c.river_id) ?? false),
          keyChanged: !self && c.key_changed === 1,
          ...(!self && protocol?.verificationState(c.river_id) === 'changed'
            ? { verifiedChanged: true }
            : {}),
          awaitingReply: !self && c.state === 'accepted' && c.heard_from === 0,
          ...flags(c.river_id),
        };
      }),
    ].sort((a, b) => {
      // Pinned conversations first, in the order they were pinned; then the most recent.
      const pa = prefs[a.riverId]?.pinnedAt;
      const pb = prefs[b.riverId]?.pinnedAt;
      if (pa || pb) return !pa ? 1 : !pb ? -1 : pa.localeCompare(pb);
      return (b.last?.sentAt ?? '').localeCompare(a.last?.sentAt ?? '');
    });
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
