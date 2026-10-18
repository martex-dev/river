import type { Kysely } from 'kysely';
import {
  Permission,
  TIMEOUT_DENIES,
  computePermissions,
  topPosition,
  type CommunityWire,
  type MessageWire,
  type WebhookWire,
  type OverwriteWire,
  type ReactionWire,
  type RoleWire,
  type PresenceStatus,
} from '@river/protocol';
import type { Database } from '../db/schema.ts';

export interface ChannelModel {
  id: string;
  kind: 'text' | 'voice';
  name: string;
  position: number;
  /** Effective overwrites: the category's when the channel is synced to it. */
  overwrites: OverwriteWire[];
  parentId: string | null;
  synced: boolean;
  announcement: boolean;
  slowmode: number;
  userLimit: number;
  forum: boolean;
  stage: boolean;
}

export interface CategoryModel {
  id: string;
  name: string;
  position: number;
  overwrites: OverwriteWire[];
}

export interface MemberModel {
  riverId: string;
  legacyRole: 'owner' | 'admin' | 'member';
  roles: string[];
  profile: string;
  timeoutUntil: string | null;
  joinedOn: string;
  /** Still has to accept the rules (screened communities, 1.0.24). */
  pending: boolean;
  /** When temporary roles end, by role ID (1.0.30). */
  roleExpiry?: Record<string, string>;
}

/** Everything needed to answer "may X do Y here?" for one community. */
export class CommunityModel {
  readonly id: string;
  readonly ownerId: string;
  readonly meta: string;
  readonly keyEpoch: number;
  readonly rotationNeeded: boolean;
  readonly roles: RoleWire[];
  readonly channels: ChannelModel[];
  readonly categories: CategoryModel[];
  readonly members: MemberModel[];
  readonly onboarding: string | null;
  readonly screening: boolean;
  readonly selfRoles: string[];
  readonly art: string | null;
  readonly webhooks: WebhookWire[];
  /** Members by River ID: every permission check looks one up (for each member a message goes to). */
  private readonly byMember = new Map<string, MemberModel>();

  constructor(init: {
    id: string;
    ownerId: string;
    meta: string;
    keyEpoch: number;
    rotationNeeded: boolean;
    roles: RoleWire[];
    channels: ChannelModel[];
    categories?: CategoryModel[];
    members: MemberModel[];
    onboarding?: string | null;
    screening?: boolean;
    selfRoles?: string[];
    art?: string | null;
    webhooks?: WebhookWire[];
  }) {
    this.id = init.id;
    this.ownerId = init.ownerId;
    this.meta = init.meta;
    this.keyEpoch = init.keyEpoch;
    this.rotationNeeded = init.rotationNeeded;
    this.roles = init.roles;
    this.channels = init.channels;
    this.categories = init.categories ?? [];
    this.members = init.members;
    for (const m of this.members) if (!this.byMember.has(m.riverId)) this.byMember.set(m.riverId, m);
    this.onboarding = init.onboarding ?? null;
    this.screening = init.screening ?? false;
    this.selfRoles = init.selfRoles ?? [];
    this.art = init.art ?? null;
    this.webhooks = init.webhooks ?? [];
  }

  /** Must still accept the rules before taking part. */
  pending(riverId: string): boolean {
    return this.screening && !!this.member(riverId)?.pending && riverId !== this.ownerId;
  }

  /** The @everyone role has the community's ID. */
  get everyoneRoleId(): string {
    return this.id;
  }

  member(riverId: string): MemberModel | undefined {
    return this.byMember.get(riverId);
  }

  channel(id: string): ChannelModel | undefined {
    return this.channels.find((c) => c.id === id);
  }

  category(id: string): CategoryModel | undefined {
    return this.categories.find((c) => c.id === id);
  }

  role(id: string): RoleWire | undefined {
    return this.roles.find((r) => r.id === id);
  }

  perms(riverId: string, channelId?: string): number {
    return this.permsWith(riverId, channelId ? this.channel(channelId)?.overwrites : undefined, channelId);
  }

  /** Permissions in a category (with its own overwrites, as channels synced to it get them). */
  categoryPerms(riverId: string, categoryId: string): number {
    return this.permsWith(riverId, this.category(categoryId)?.overwrites);
  }

  private permsWith(
    riverId: string,
    overwrites: readonly OverwriteWire[] | undefined,
    channelId?: string,
  ): number {
    const m = this.member(riverId);
    if (!m) return 0;
    const perms = computePermissions({
      ownerId: this.ownerId,
      everyoneRoleId: this.everyoneRoleId,
      roles: this.roles,
      member: { riverId, roles: m.roles },
      overwrites,
    });
    // Until a new member accepts the rules of a screened community, they can only look around.
    if (this.pending(riverId) && !(perms & Permission.ADMINISTRATOR)) return perms & Permission.VIEW_CHANNELS;
    // A timeout takes away talking, not reading; owners and administrators are never timed out.
    if (this.timedOut(riverId) && riverId !== this.ownerId && !(perms & Permission.ADMINISTRATOR))
      return perms & ~TIMEOUT_DENIES;
    // In an announcement channel only people who may manage messages post.
    if (channelId && this.channel(channelId)?.announcement && !(perms & Permission.MANAGE_MESSAGES))
      return perms & ~Permission.SEND_MESSAGES;
    return perms;
  }

  /**
   * Timed out, or still to accept a screened community's rules, and neither the owner nor an
   * administrator: may read, but not take part. Used where no permission bit decides it (editing
   * your own message, renaming your thread), so a timeout cannot be talked around (2.20).
   */
  restricted(riverId: string): boolean {
    if (riverId === this.ownerId || !(this.pending(riverId) || this.timedOut(riverId))) return false;
    const m = this.member(riverId);
    if (!m) return true;
    const perms = computePermissions({
      ownerId: this.ownerId,
      everyoneRoleId: this.everyoneRoleId,
      roles: this.roles,
      member: { riverId, roles: m.roles },
    });
    return !(perms & Permission.ADMINISTRATOR);
  }

  /** Is this member timed out right now? */
  timedOut(riverId: string, now = Date.now()): boolean {
    const until = this.member(riverId)?.timeoutUntil;
    return !!until && Date.parse(until) > now;
  }

  can(riverId: string, permission: number, channelId?: string): boolean {
    return (this.perms(riverId, channelId) & permission) === permission;
  }

  /** Role hierarchy: the owner outranks everyone; otherwise highest role position. */
  top(riverId: string): number {
    const m = this.member(riverId);
    if (!m) return -1;
    return topPosition(this.ownerId, this.roles, { riverId, roles: m.roles });
  }

  /** Can `actor` act on `target` (kick, ban, assign roles, server-mute)? */
  outranks(actor: string, target: string): boolean {
    if (target === this.ownerId) return false;
    return this.top(actor) > this.top(target);
  }

  /** Members allowed to see a channel. */
  viewers(channelId: string): string[] {
    return this.members
      .filter((m) => this.can(m.riverId, Permission.VIEW_CHANNELS, channelId))
      .map((m) => m.riverId);
  }

  /** The community as one member sees it: only channels they may view. */
  wireFor(
    riverId: string,
    presence: (id: string) => PresenceStatus | null,
    last: ReadonlyMap<string, string> = new Map(),
  ): CommunityWire {
    const visible = this.channels.filter((c) => this.can(riverId, Permission.VIEW_CHANNELS, c.id));
    const manager = this.can(riverId, Permission.MANAGE_CHANNELS);
    return {
      id: this.id,
      meta: this.meta,
      ownerId: this.ownerId,
      keyEpoch: this.keyEpoch,
      rotationNeeded: this.rotationNeeded,
      onboarding: this.onboarding,
      screening: this.screening,
      selfRoles: this.selfRoles,
      art: this.art,
      ...((): { webhooks?: WebhookWire[] } => {
        const mine = this.webhooks.filter((w) => visible.some((c) => c.id === w.channelId));
        return mine.length ? { webhooks: mine } : {};
      })(),
      roles: this.roles,
      channels: visible.map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        position: c.position,
        overwrites: c.overwrites,
        parentId: c.parentId,
        lastMessageAt: last.get(c.id) ?? null,
        synced: c.synced,
        announcement: c.announcement,
        slowmode: c.slowmode,
        userLimit: c.userLimit,
        forum: c.forum,
        stage: c.stage,
      })),
      // A category whose channels are all hidden from you stays hidden too.
      categories: this.categories.filter(
        (k) =>
          manager ||
          visible.some((c) => c.parentId === k.id) ||
          !this.channels.some((c) => c.parentId === k.id),
      ),
      members: this.members.map((m) => ({
        riverId: m.riverId,
        role: m.legacyRole,
        roles: m.roles,
        profile: m.profile,
        online: presence(m.riverId) !== null,
        ...((): { status?: PresenceStatus } => {
          const p = presence(m.riverId);
          return p && p !== 'online' ? { status: p } : {};
        })(),
        timeoutUntil: this.timedOut(m.riverId) ? m.timeoutUntil : null,
        ...(/^\d{4}-\d{2}-\d{2}$/.test(m.joinedOn) ? { joinedOn: m.joinedOn } : {}),
        ...(this.pending(m.riverId) ? { pending: true } : {}),
        ...(m.roleExpiry && Object.keys(m.roleExpiry).length ? { roleExpiry: m.roleExpiry } : {}),
      })),
    };
  }
}

export async function loadCommunity(db: Kysely<Database>, id: string): Promise<CommunityModel | null> {
  const c = await db
    .selectFrom('communities')
    .select([
      'id',
      'owner',
      'meta',
      'key_epoch',
      'rotation_needed',
      'onboarding',
      'screening',
      'self_roles',
      'art',
    ])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!c) return null;
  const [roles, channels, overwrites, members, memberRoles, categories, categoryOverwrites, webhooks] =
    await Promise.all([
      db.selectFrom('roles').selectAll().where('community_id', '=', id).orderBy('position').execute(),
      db.selectFrom('channels').selectAll().where('community_id', '=', id).orderBy('position').execute(),
      db
        .selectFrom('channel_overwrites')
        .innerJoin('channels', 'channels.id', 'channel_overwrites.channel_id')
        .select([
          'channel_overwrites.channel_id',
          'channel_overwrites.role_id',
          'channel_overwrites.allow',
          'channel_overwrites.deny',
        ])
        .where('channels.community_id', '=', id)
        .execute(),
      db.selectFrom('community_members').selectAll().where('community_id', '=', id).execute(),
      db
        .selectFrom('member_roles')
        .selectAll()
        .where('community_id', '=', id)
        // A temporary role that has run out no longer counts (1.0.30).
        .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', new Date().toISOString())]))
        .execute(),
      db.selectFrom('categories').selectAll().where('community_id', '=', id).orderBy('position').execute(),
      db
        .selectFrom('category_overwrites')
        .innerJoin('categories', 'categories.id', 'category_overwrites.category_id')
        .select([
          'category_overwrites.category_id',
          'category_overwrites.role_id',
          'category_overwrites.allow',
          'category_overwrites.deny',
        ])
        .where('categories.community_id', '=', id)
        .execute(),
      db.selectFrom('webhooks').selectAll().where('community_id', '=', id).orderBy('created_at').execute(),
    ]);
  // Each member's roles, grouped once (in the order read) instead of searched for per member.
  const rolesOf = new Map<string, typeof memberRoles>();
  for (const r of memberRoles) {
    const list = rolesOf.get(r.river_id);
    if (list) list.push(r);
    else rolesOf.set(r.river_id, [r]);
  }
  const categoryModels: CategoryModel[] = categories.map((k) => ({
    id: k.id,
    name: k.name,
    position: k.position,
    overwrites: categoryOverwrites
      .filter((o) => o.category_id === k.id)
      .map((o) => ({ roleId: o.role_id, allow: o.allow, deny: o.deny })),
  }));
  return new CommunityModel({
    id: c.id,
    ownerId: c.owner,
    meta: c.meta,
    keyEpoch: c.key_epoch,
    rotationNeeded: c.rotation_needed === 1,
    onboarding: c.onboarding,
    art: c.art,
    webhooks: webhooks.map((w) => ({
      id: w.id,
      channelId: w.channel_id,
      sealed: w.sealed,
      createdBy: w.created_by,
      createdAt: w.created_at,
      revoked: w.revoked === 1,
    })),
    screening: c.screening === 1,
    selfRoles: ((): string[] => {
      try {
        const list = JSON.parse(c.self_roles) as unknown;
        return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        return [];
      }
    })(),
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      permissions: r.permissions,
      position: r.position,
    })),
    channels: channels.map((ch) => {
      const parent = categoryModels.find((k) => k.id === ch.parent_id);
      const synced = ch.synced === 1 && parent !== undefined;
      return {
        id: ch.id,
        kind: ch.kind as 'text' | 'voice',
        name: ch.name,
        position: ch.position,
        overwrites: synced
          ? parent.overwrites
          : overwrites
              .filter((o) => o.channel_id === ch.id)
              .map((o) => ({ roleId: o.role_id, allow: o.allow, deny: o.deny })),
        parentId: ch.parent_id,
        synced,
        announcement: ch.announcement === 1,
        slowmode: ch.slowmode,
        userLimit: ch.user_limit,
        forum: ch.forum === 1,
        stage: ch.stage === 1,
      };
    }),
    categories: categoryModels,
    members: members.map((m) => ({
      riverId: m.river_id,
      legacyRole: m.role as 'owner' | 'admin' | 'member',
      roles: (rolesOf.get(m.river_id) ?? []).map((r) => r.role_id),
      roleExpiry: Object.fromEntries(
        (rolesOf.get(m.river_id) ?? []).filter((r) => r.expires_at).map((r) => [r.role_id, r.expires_at!]),
      ),
      profile: m.profile,
      timeoutUntil: m.timeout_until,
      joinedOn: m.joined_on,
      pending: m.accepted === 0,
    })),
  });
}

/** When the newest message in each channel was sent (for unread markers). */
export async function lastMessageTimes(
  db: Kysely<Database>,
  channelIds: string[],
): Promise<Map<string, string>> {
  if (channelIds.length === 0) return new Map();
  // One newest-message lookup per channel (an index seek on messages_by_channel), rather than a
  // GROUP BY that reads every message of every channel.
  const rows = await db
    .selectFrom('channels')
    .select((eb) => [
      'channels.id as channel_id',
      eb
        .selectFrom('messages')
        .select((m) => m.fn.max('messages.sent_at').as('m'))
        .whereRef('messages.channel_id', '=', 'channels.id')
        .as('last'),
    ])
    .where('channels.id', 'in', channelIds)
    .execute();
  return new Map(rows.filter((r) => r.last !== null).map((r) => [r.channel_id, String(r.last)]));
}

export async function communityOfChannel(db: Kysely<Database>, channelId: string): Promise<string | null> {
  const row = await db
    .selectFrom('channels')
    .select('community_id')
    .where('id', '=', channelId)
    .executeTakeFirst();
  return row?.community_id ?? null;
}

export async function loadMessages(
  db: Kysely<Database>,
  rows: Array<{
    id: string;
    channel_id: string;
    sender: string;
    body: string;
    sent_at: string;
    edited_at: string | null;
    pinned: number;
    thread_id: string | null;
    webhook_id?: string | null;
  }>,
): Promise<MessageWire[]> {
  const ids = rows.map((r) => r.id);
  const threads = ids.length
    ? await db.selectFrom('threads').selectAll().where('id', 'in', ids).execute()
    : [];
  const reactions = ids.length
    ? await db.selectFrom('message_reactions').selectAll().where('message_id', 'in', ids).execute()
    : [];
  const files = ids.length
    ? await db
        .selectFrom('attachments')
        .select(['id', 'message_id'])
        .where('message_id', 'in', ids)
        .orderBy('id')
        .execute()
    : [];
  return rows.map((r) => {
    const grouped = new Map<string, ReactionWire>();
    for (const x of reactions.filter((x) => x.message_id === r.id)) {
      const g = grouped.get(x.tag) ?? { tag: x.tag, emoji: x.emoji, users: [] };
      g.users.push(x.river_id);
      grouped.set(x.tag, g);
    }
    return {
      id: r.id,
      channelId: r.channel_id,
      sender: r.sender,
      body: r.body,
      sentAt: r.sent_at,
      editedAt: r.edited_at,
      pinned: r.pinned === 1,
      reactions: [...grouped.values()],
      attachments: files.filter((f) => f.message_id === r.id).map((f) => f.id),
      threadId: r.thread_id,
      thread: ((t) =>
        t
          ? {
              name: t.name,
              count: t.count,
              lastAt: t.last_at,
              archived: t.archived === 1,
              creator: t.creator,
            }
          : null)(threads.find((t) => t.id === r.id)),
      ...(r.webhook_id ? { webhook: r.webhook_id } : {}),
    };
  });
}
