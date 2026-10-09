/**
 * Community permissions (Discord-like). The server enforces everything it can
 * see (who may read, post, manage, moderate); media permissions in direct
 * peer-to-peer calls (speak, stream) are enforced by clients.
 */
export const Permission = {
  VIEW_CHANNELS: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  CONNECT: 1 << 2,
  SPEAK: 1 << 3,
  STREAM: 1 << 4,
  ADD_REACTIONS: 1 << 5,
  MENTION_EVERYONE: 1 << 6,
  CREATE_INVITE: 1 << 7,
  MANAGE_MESSAGES: 1 << 8,
  MANAGE_CHANNELS: 1 << 9,
  MANAGE_ROLES: 1 << 10,
  KICK_MEMBERS: 1 << 11,
  BAN_MEMBERS: 1 << 12,
  MUTE_MEMBERS: 1 << 13,
  MOVE_MEMBERS: 1 << 14,
  MANAGE_COMMUNITY: 1 << 15,
  ADMINISTRATOR: 1 << 16,
  ATTACH_FILES: 1 << 17,
  PIN_MESSAGES: 1 << 18,
  /** Time members out (1.0.6). */
  MODERATE_MEMBERS: 1 << 19,
  /** Read the community's audit log (1.0.6). */
  VIEW_AUDIT_LOG: 1 << 20,
} as const;
export type PermissionName = keyof typeof Permission;

export const ALL_PERMISSIONS = Object.values(Permission).reduce((a, b) => a | b, 0);

/** What a timed-out member cannot do (they can still read). */
export const TIMEOUT_DENIES =
  Permission.SEND_MESSAGES |
  Permission.ADD_REACTIONS |
  Permission.ATTACH_FILES |
  Permission.MENTION_EVERYONE |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.STREAM |
  Permission.CREATE_INVITE;

/** What @everyone may do in a new community. */
export const DEFAULT_EVERYONE =
  Permission.VIEW_CHANNELS |
  Permission.SEND_MESSAGES |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.STREAM |
  Permission.ADD_REACTIONS |
  Permission.CREATE_INVITE |
  Permission.ATTACH_FILES;

/** Human labels, in the order settings show them. */
export const PERMISSION_INFO: Array<{ key: PermissionName; label: string; help: string }> = [
  {
    key: 'ADMINISTRATOR',
    label: 'Administrator',
    help: 'Every permission, in every channel. Grant carefully.',
  },
  {
    key: 'MANAGE_COMMUNITY',
    label: 'Manage community',
    help: 'Rename the community and change its description.',
  },
  {
    key: 'MANAGE_ROLES',
    label: 'Manage roles',
    help: 'Create and edit roles below their own, and assign them.',
  },
  {
    key: 'MANAGE_CHANNELS',
    label: 'Manage channels',
    help: 'Create, rename, reorder, delete channels and set channel permissions.',
  },
  { key: 'KICK_MEMBERS', label: 'Kick members', help: 'Remove members (they can rejoin with an invite).' },
  { key: 'BAN_MEMBERS', label: 'Ban members', help: 'Remove members and stop them rejoining.' },
  {
    key: 'MODERATE_MEMBERS',
    label: 'Time out members',
    help: 'Stop members below them from talking, reacting and joining voice for a while.',
  },
  {
    key: 'VIEW_AUDIT_LOG',
    label: 'View audit log',
    help: 'See who changed roles, channels and settings, and who moderated whom.',
  },
  { key: 'CREATE_INVITE', label: 'Create invites', help: 'Make invite links.' },
  { key: 'VIEW_CHANNELS', label: 'View channels', help: 'See channels and read messages.' },
  { key: 'SEND_MESSAGES', label: 'Send messages', help: 'Post in text channels.' },
  { key: 'ATTACH_FILES', label: 'Attach files', help: 'Send images and files.' },
  { key: 'ADD_REACTIONS', label: 'Add reactions', help: 'React to messages.' },
  { key: 'MENTION_EVERYONE', label: 'Mention @everyone', help: 'Notify everyone at once.' },
  { key: 'MANAGE_MESSAGES', label: 'Manage messages', help: "Delete other people's messages." },
  { key: 'PIN_MESSAGES', label: 'Pin messages', help: 'Pin and unpin messages.' },
  { key: 'CONNECT', label: 'Connect to voice', help: 'Join voice channels.' },
  { key: 'SPEAK', label: 'Speak', help: 'Talk in voice channels.' },
  { key: 'STREAM', label: 'Video & screen share', help: 'Turn on camera or share a screen in voice.' },
  { key: 'MUTE_MEMBERS', label: 'Mute members', help: 'Server-mute others in voice.' },
  {
    key: 'MOVE_MEMBERS',
    label: 'Move & disconnect members',
    help: 'Move people between voice channels or disconnect them.',
  },
];

export interface PermissionRole {
  id: string;
  permissions: number;
  position: number;
}

export interface PermissionOverwrite {
  roleId: string;
  allow: number;
  deny: number;
}

/**
 * Discord's algorithm: owner → everything; @everyone ∪ member roles; ADMINISTRATOR
 * → everything; then channel overwrites: @everyone deny/allow, then the union of
 * the member's role denies and allows.
 */
export function computePermissions(args: {
  ownerId: string;
  everyoneRoleId: string;
  roles: readonly PermissionRole[];
  member: { riverId: string; roles: readonly string[] };
  overwrites?: readonly PermissionOverwrite[];
}): number {
  if (args.member.riverId === args.ownerId) return ALL_PERMISSIONS;
  const byId = new Map(args.roles.map((r) => [r.id, r]));
  let perms = byId.get(args.everyoneRoleId)?.permissions ?? 0;
  for (const id of args.member.roles) perms |= byId.get(id)?.permissions ?? 0;
  if (perms & Permission.ADMINISTRATOR) return ALL_PERMISSIONS;
  const ow = args.overwrites ?? [];
  const everyone = ow.find((o) => o.roleId === args.everyoneRoleId);
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow;
  let allow = 0;
  let deny = 0;
  for (const o of ow) {
    if (o.roleId !== args.everyoneRoleId && args.member.roles.includes(o.roleId)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  return (perms & ~deny) | allow;
}

export function has(perms: number, p: number): boolean {
  return (perms & p) === p;
}

/** Highest role position a member holds (owner: Infinity). Used for role hierarchy. */
export function topPosition(
  ownerId: string,
  roles: readonly PermissionRole[],
  member: { riverId: string; roles: readonly string[] },
): number {
  if (member.riverId === ownerId) return Number.POSITIVE_INFINITY;
  return Math.max(0, ...roles.filter((r) => member.roles.includes(r.id)).map((r) => r.position));
}
