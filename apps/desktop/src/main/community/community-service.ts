import {
  API_PREFIX,
  communitiesResponseSchema,
  communitySchema,
  inviteResponseSchema,
  messageSchema,
  messagesResponseSchema,
  serverEventSchema,
  type CommunityWire,
  type MessageWire,
  type ServerEvent,
} from '@river/protocol';
import { z } from 'zod';
import type { ChatMessage, CommunityEvent, CommunityView } from '../../shared/ipc.ts';
import type { AccountService } from '../account/account-service.ts';
import { ApiError, type RequestJson } from '../http.ts';
import type { IdentityService } from '../identity/identity-service.ts';
import type { Logger } from '../logger.ts';
import type { LocalDatabase } from '../storage/database.ts';
import { formatInvite, newCommunityKey, open, parseInvite, randomId, seal } from './sealed.ts';

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

interface Deps {
  db: () => LocalDatabase | null;
  account: AccountService;
  identity: IdentityService;
  requestJson: RequestJson;
  log: Logger;
  /** Creates the realtime socket (injectable for tests). */
  createSocket?: (url: string) => WebSocket;
}

/**
 * Communities on the user's River server. All names, profiles, messages and
 * call signalling are sealed with the community key before leaving this
 * process; the renderer only ever sees decrypted, validated values.
 */
export class CommunityService {
  private readonly deps: Deps;
  private communities: CommunityView[] = [];
  private readonly keys = new Map<string, Buffer>();
  private readonly channelToCommunity = new Map<string, string>();
  private readonly voice = new Map<string, string[]>();
  private socket: WebSocket | null = null;
  private socketState: 'online' | 'offline' | 'connecting' = 'offline';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoff = 1000;
  private readonly listeners = new Set<(e: CommunityEvent) => void>();

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

  private async call<T>(
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = `${this.server()}${API_PREFIX}${path}`;
    try {
      return await this.deps.requestJson(url, { method, body, token: await this.token() }, schema);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await this.deps.account.connect(); // session expired: one fresh login, one retry
        return this.deps.requestJson(url, { method, body, token: await this.token() }, schema);
      }
      throw err;
    }
  }

  private db(): LocalDatabase {
    const db = this.deps.db();
    if (!db) throw new CommunityError('River is locked.');
    return db;
  }

  private loadKeys(): void {
    const rows = this.db().prepare('SELECT id, key FROM communities').all() as Array<{
      id: string;
      key: Uint8Array;
    }>;
    for (const r of rows) this.keys.set(r.id, Buffer.from(r.key));
  }

  private myName(): string | null {
    return this.deps.identity.get()?.displayName ?? null;
  }

  // ---- Decryption ----------------------------------------------------------------------------

  private view(c: CommunityWire): CommunityView | null {
    const key = this.keys.get(c.id);
    if (!key) return null;
    const me = this.deps.identity.get()?.riverId;
    try {
      const meta = open<{ name: string }>(key, c.id, 'meta', c.meta);
      const channels = c.channels.map((ch) => {
        let name = 'channel';
        try {
          name = open<{ name: string }>(key, c.id, `channel:${ch.id}`, ch.name).name;
        } catch {
          // keep placeholder for undecryptable names
        }
        return { id: ch.id, kind: ch.kind, name };
      });
      const members = c.members.map((m) => {
        let name: string | null = null;
        try {
          name = open<{ name: string | null }>(key, c.id, 'profile', m.profile).name;
        } catch {
          // unreadable profile
        }
        return { riverId: m.riverId, role: m.role, name: name ?? `Member ${m.riverId.slice(0, 4)}` };
      });
      for (const ch of channels) this.channelToCommunity.set(ch.id, c.id);
      const myRole = c.members.find((m) => m.riverId === me)?.role ?? 'member';
      const voice: Record<string, string[]> = {};
      for (const ch of channels) if (ch.kind === 'voice') voice[ch.id] = this.voice.get(ch.id) ?? [];
      return { id: c.id, name: String(meta.name).slice(0, 64), myRole, channels, members, voice };
    } catch {
      this.deps.log.warn('Community metadata could not be decrypted');
      return null;
    }
  }

  private toChat(communityId: string, m: MessageWire): ChatMessage | null {
    const key = this.keys.get(communityId);
    if (!key) return null;
    try {
      const body = open<{ text: string }>(key, communityId, `message:${m.channelId}`, m.body);
      const community = this.communities.find((c) => c.id === communityId);
      const sender = community?.members.find((x) => x.riverId === m.sender);
      return {
        id: m.id,
        communityId,
        channelId: m.channelId,
        sender: m.sender,
        senderName: sender?.name ?? `Member ${m.sender.slice(0, 4)}`,
        text: String(body.text).slice(0, 4000),
        sentAt: m.sentAt,
        mine: m.sender === this.deps.identity.get()?.riverId,
      };
    } catch {
      return null;
    }
  }

  // ---- Public API (called via IPC) -----------------------------------------------------------

  async refresh(): Promise<CommunityView[]> {
    this.loadKeys();
    const res = await this.call('/communities', 'GET', undefined, communitiesResponseSchema);
    this.communities = res.communities.map((c) => this.view(c)).filter((c): c is CommunityView => c !== null);
    this.emit({ t: 'communities', communities: this.communities });
    return this.communities;
  }

  async create(rawName: unknown): Promise<CommunityView> {
    const name = nameSchema.parse(rawName);
    const id = randomId();
    const key = newCommunityKey();
    const text = randomId();
    const voice = randomId();
    const body = {
      id,
      meta: seal(key, id, 'meta', { name }),
      profile: seal(key, id, 'profile', { name: this.myName() }),
      channels: [
        { id: text, kind: 'text', name: seal(key, id, `channel:${text}`, { name: 'general' }) },
        { id: voice, kind: 'voice', name: seal(key, id, `channel:${voice}`, { name: 'Lounge' }) },
      ],
    };
    const created = await this.call('/communities', 'POST', body, communitySchema);
    this.storeKey(id, key);
    const view = this.view(created);
    await this.refresh();
    this.ensureSocket();
    return view!;
  }

  async createChannel(communityId: string, kind: unknown, rawName: unknown): Promise<void> {
    const key = this.requireKey(communityId);
    const k = z.enum(['text', 'voice']).parse(kind);
    const name = nameSchema.parse(rawName);
    const id = randomId();
    await this.call(
      `/communities/${communityId}/channels`,
      'POST',
      { id, kind: k, name: seal(key, communityId, `channel:${id}`, { name }) },
      z.unknown(),
    );
    await this.refresh();
  }

  async invite(communityId: string): Promise<string> {
    const key = this.requireKey(communityId);
    const res = await this.call(`/communities/${communityId}/invites`, 'POST', {}, inviteResponseSchema);
    return formatInvite(this.server(), res.code, key);
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
    // Encrypt our profile for the community before we know its ID? The server returns it; seal after.
    // To avoid a second round-trip the profile is sealed for the ID learned from a dry decode below.
    const res = await this.call(
      '/invites/join',
      'POST',
      { code: invite.code, profile: 'AAAA' },
      communitySchema,
    ).catch((err: unknown) => {
      if (err instanceof ApiError && err.code === 'invalid_invite') {
        throw new CommunityError('This invite has expired or was already used too many times.');
      }
      throw err;
    });
    // Verify the key from the link actually opens this community before trusting it.
    try {
      open(invite.key, res.id, 'meta', res.meta);
    } catch {
      throw new CommunityError('This invite link is damaged: its key does not match the community.');
    }
    this.storeKey(res.id, invite.key);
    await this.updateProfile(res.id);
    await this.refresh();
    this.ensureSocket();
    return this.communities.find((c) => c.id === res.id)!;
  }

  /** (Re)publishes our sealed display name to a community. */
  private async updateProfile(communityId: string): Promise<void> {
    const key = this.requireKey(communityId);
    await this.call(
      `/communities/${communityId}/profile`,
      'POST',
      { profile: seal(key, communityId, 'profile', { name: this.myName() }) },
      z.unknown(),
    );
  }

  async messages(channelId: string): Promise<ChatMessage[]> {
    const communityId = this.channelToCommunity.get(channelId);
    if (!communityId) throw new CommunityError('Unknown channel');
    const res = await this.call(`/channels/${channelId}/messages`, 'GET', undefined, messagesResponseSchema);
    return res.messages.map((m) => this.toChat(communityId, m)).filter((m): m is ChatMessage => m !== null);
  }

  async send(channelId: string, rawText: unknown): Promise<ChatMessage> {
    const text = textSchema.parse(rawText);
    const communityId = this.channelToCommunity.get(channelId);
    if (!communityId) throw new CommunityError('Unknown channel');
    const key = this.requireKey(communityId);
    const sent = await this.call(
      `/channels/${channelId}/messages`,
      'POST',
      { id: randomId(), body: seal(key, communityId, `message:${channelId}`, { text }) },
      messageSchema,
    );
    return this.toChat(communityId, sent)!;
  }

  voiceJoin(channelId: string): void {
    if (!this.channelToCommunity.has(channelId)) throw new CommunityError('Unknown channel');
    this.sendEvent({ t: 'voice.join', channelId });
  }

  voiceLeave(): void {
    this.sendEvent({ t: 'voice.leave' });
  }

  /** Call signalling (SDP / ICE) sealed with the community key, relayed by the server. */
  signal(to: string, channelId: string, payload: unknown): void {
    const communityId = this.channelToCommunity.get(channelId);
    if (!communityId) throw new CommunityError('Unknown channel');
    const data = seal(this.requireKey(communityId), communityId, `signal:${channelId}`, payload);
    if (data.length > 30_000) throw new CommunityError('Signal too large');
    this.sendEvent({ t: 'signal', to: z.string().uuid().parse(to), data });
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
    switch (e.t) {
      case 'ready':
        this.backoff = 1000;
        this.setSocketState('online');
        void this.refresh().catch(() => undefined);
        return;
      case 'message': {
        const chat = this.toChat(e.communityId, e.message);
        if (chat) this.emit({ t: 'message', message: chat });
        return;
      }
      case 'member':
      case 'channel':
        void this.refresh().catch(() => undefined);
        return;
      case 'voice':
        this.voice.set(e.channelId, e.participants);
        this.emit({
          t: 'voice',
          communityId: e.communityId,
          channelId: e.channelId,
          participants: e.participants,
        });
        return;
      case 'signal': {
        const communityId = this.channelToCommunity.get(e.channelId);
        const key = communityId ? this.keys.get(communityId) : undefined;
        if (!communityId || !key) return;
        try {
          const data = open(key, communityId, `signal:${e.channelId}`, e.data);
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

  private setSocketState(state: 'online' | 'offline' | 'connecting'): void {
    if (this.socketState === state) return;
    this.socketState = state;
    this.emit({ t: 'connection', state });
  }

  private emit(e: CommunityEvent): void {
    for (const l of this.listeners) l(e);
  }

  private requireKey(communityId: string): Buffer {
    if (!this.keys.has(communityId)) this.loadKeys();
    const key = this.keys.get(communityId);
    if (!key) throw new CommunityError('Unknown community');
    return key;
  }

  private storeKey(id: string, key: Buffer): void {
    this.db()
      .prepare('INSERT OR REPLACE INTO communities (id, key, joined_at) VALUES (?, ?, ?)')
      .run(id, key, new Date().toISOString());
    this.keys.set(id, key);
  }
}
