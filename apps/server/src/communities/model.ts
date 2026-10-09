import type { Kysely } from 'kysely';
import {
  Permission,
  TIMEOUT_DENIES,
  computePermissions,
  topPosition,
  type CommunityWire,
  type MessageWire,
  type OverwriteWire,
  type ReactionWire,
  type RoleWire,
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
  }

  /** The @everyone role has the community's ID. */
  get everyoneRoleId(): string {
    return this.id;
  }

  member(riverId: string): MemberModel | undefined {
    return this.members.find((m) => m.riverId === riverId);
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
    const m = this.member(riverId);
    if (!m) return 0;
    const perms = computePermissions({
      ownerId: this.ownerId,
      everyoneRoleId: this.everyoneRoleId,
      roles: this.roles,
      member: { riverId, roles: m.roles },
      overwrites: channelId ? this.channel(channelId)?.overwrites : undefined,
    });
    // A timeout takes away talking, not reading; owners and administrators are never timed out.
    if (this.timedOut(riverId) && riverId !== this.ownerId && !(perms & Permission.ADMINISTRATOR))
      return perms & ~TIMEOUT_DENIES;
    // In an announcement channel only people who may manage messages post.
    if (channelId && this.channel(channelId)?.announcement && !(perms & Permission.MANAGE_MESSAGES))
      return perms & ~Permission.SEND_MESSAGES;
    return perms;
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
    online: (id: string) => boolean,
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
        online: online(m.riverId),
        timeoutUntil: this.timedOut(m.riverId) ? m.timeoutUntil : null,
      })),
    };
  }
}

export async function loadCommunity(db: Kysely<Database>, id: string): Promise<CommunityModel | null> {
  const c = await db
    .selectFrom('communities')
    .select(['id', 'owner', 'meta', 'key_epoch', 'rotation_needed'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!c) return null;
  const [roles, channels, overwrites, members, memberRoles, categories, categoryOverwrites] =
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
      db.selectFrom('member_roles').selectAll().where('community_id', '=', id).execute(),
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
    ]);
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
      };
    }),
    categories: categoryModels,
    members: members.map((m) => ({
      riverId: m.river_id,
      legacyRole: m.role as 'owner' | 'admin' | 'member',
      roles: memberRoles.filter((r) => r.river_id === m.river_id).map((r) => r.role_id),
      profile: m.profile,
      timeoutUntil: m.timeout_until,
    })),
  });
}

/** When the newest message in each channel was sent (for unread markers). */
export async function lastMessageTimes(
  db: Kysely<Database>,
  channelIds: string[],
): Promise<Map<string, string>> {
  if (channelIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('messages')
    .select((eb) => ['channel_id', eb.fn.max('sent_at').as('last')])
    .where('channel_id', 'in', channelIds)
    .groupBy('channel_id')
    .execute();
  return new Map(rows.map((r) => [r.channel_id, String(r.last)]));
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
    };
  });
}
