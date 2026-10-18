import type { Generated } from 'kysely';

/** Kysely table types. Every table added by a migration is declared here. */
export interface ServerMetaTable {
  key: string;
  value: string;
}

export interface AccountsTable {
  river_id: string;
  identity_key: string;
  device_list: string;
  device_list_signature: string;
  device_list_version: number;
  created_on: string;
  /** Suspended by the server operator until this ISO time (a ban: far future). */
  suspended_until: string | null;
  suspend_reason: string | null;
  /** Lowercase, unique (1.0.13). */
  username: string | null;
}

/** A username given up recently: only its previous owner may take it back until `until` (2.11). */
export interface UsernameHoldsTable {
  username: string;
  river_id: string;
  until: string;
}

/** A deleted account's River ID and identity key: the ID returns only with that key (2.11). */
export interface AccountTombstonesTable {
  river_id: string;
  identity_key: string;
  deleted_on: string;
}

export interface SignupsTable {
  code_hash: string;
  username: string;
  created_at: string;
  expires_at: string;
}

export interface DevicesTable {
  river_id: string;
  device_id: number;
  auth_key: string;
  registration_id: number;
  created_on: string;
}

export interface SessionsTable {
  token_hash: string;
  river_id: string;
  device_id: number;
  expires_at: string;
  /** Absolute end (2.20): renewing never moves `expires_at` past it. Null only before 0029 ran. */
  not_after: string | null;
}

export interface AuthChallengesTable {
  challenge_hash: string;
  purpose: string;
  expires_at: string;
}

export interface CommunitiesTable {
  id: string;
  owner: string;
  meta: string;
  created_on: string;
  key_epoch: Generated<number>;
  rotation_needed: Generated<number>;
  /** Sealed rules and welcome note (1.0.24). */
  onboarding: string | null;
  screening: Generated<number>;
  /** JSON array of role IDs members may give themselves. */
  self_roles: Generated<string>;
  /** Sealed { icon, banner } (1.0.29). */
  art: string | null;
  /** When and by whom the current key epoch was claimed, until a member reports having it (2.11). */
  epoch_claimed_at: string | null;
  epoch_claimed_by: string | null;
  /** How often a rotation that reached nobody was asked for again (2.11). */
  rotation_retries: Generated<number>;
}

export interface CommunityMembersTable {
  community_id: string;
  river_id: string;
  role: string;
  profile: string;
  joined_on: string;
  timeout_until: string | null;
  /** 0 while a new member has not accepted the rules of a screened community (1.0.24). */
  accepted: Generated<number>;
  /** The invite they joined with (1.0.31). */
  invite_id?: string | null;
}

export interface ChannelsTable {
  id: string;
  community_id: string;
  kind: string;
  name: string;
  position: number;
  parent_id: string | null;
  synced: Generated<number>;
  announcement: Generated<number>;
  forum: Generated<number>;
  stage: Generated<number>;
  slowmode: Generated<number>;
  user_limit: Generated<number>;
}

export interface ThreadsTable {
  id: string;
  channel_id: string;
  name: string;
  creator: string;
  created_at: string;
  last_at: string | null;
  count: Generated<number>;
  archived: Generated<number>;
}

export interface CategoriesTable {
  id: string;
  community_id: string;
  name: string;
  position: number;
}

export interface InvitesTable {
  code_hash: string;
  community_id: string;
  expires_at: string;
  uses: number;
  max_uses: number;
  check: string | null;
  /** Public ID, creator and creation time (1.0.31); null for older invites. */
  id?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

export interface MessagesTable {
  id: string;
  channel_id: string;
  sender: string;
  body: string;
  sent_at: string;
  edited_at: string | null;
  pinned: number;
  thread_id: string | null;
  /** Posted through this incoming webhook (1.0.32). */
  webhook_id?: string | null;
}

export interface RolesTable {
  id: string;
  community_id: string;
  name: string;
  color: number;
  permissions: number;
  position: number;
}

export interface MemberRolesTable {
  community_id: string;
  river_id: string;
  role_id: string;
  /** A role given for a while ends then (1.0.30); null = for good. */
  expires_at?: string | null;
}

export interface CategoryOverwritesTable {
  category_id: string;
  role_id: string;
  allow: number;
  deny: number;
}

export interface AuditLogTable {
  id: string;
  community_id: string;
  actor: string;
  action: string;
  target: string | null;
  details: string;
  created_at: string;
}

export interface ChannelOverwritesTable {
  channel_id: string;
  role_id: string;
  allow: number;
  deny: number;
}

export interface BansTable {
  community_id: string;
  river_id: string;
  banned_on: string;
  /** When a temporary ban ends (1.0.22), or null. */
  until: string | null;
}

export interface MessageReactionsTable {
  message_id: string;
  river_id: string;
  tag: string;
  emoji: string;
}

export interface AttachmentsTable {
  id: string;
  uploader: string;
  size: number;
  created_at: string;
  message_id: string | null;
  retain_until: string | null;
}

export interface SignedPreKeysTable {
  river_id: string;
  device_id: number;
  key_id: number;
  public_key: string;
  signature: string;
}

export interface PreKeysTable {
  river_id: string;
  device_id: number;
  key_id: number;
  public_key: string;
}

export interface KyberPreKeysTable {
  river_id: string;
  device_id: number;
  key_id: number;
  public_key: string;
  signature: string;
  last_resort: number;
}

export interface MailboxTable {
  id: string;
  recipient: string;
  recipient_device: number;
  sender: string;
  sender_device: number;
  type: number;
  body: string;
  received_at: string;
}

export interface BlocksTable {
  river_id: string;
  blocked: string;
}

export interface CommunityEventsTable {
  id: string;
  community_id: string;
  created_by: string;
  data: string;
  starts_at: string;
  ends_at: string;
  channel_id: string | null;
  canceled: number;
  created_at: string;
}

export interface CommunityEventRsvpsTable {
  event_id: string;
  river_id: string;
}

export interface CommunityEmojisTable {
  id: string;
  community_id: string;
  created_by: string;
  data: string;
  created_at: string;
}

export interface CommunityReportsTable {
  id: string;
  community_id: string;
  channel_id: string;
  message_id: string;
  reporter: string;
  target: string;
  data: string;
  status: string;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface CommunitySoundsTable {
  id: string;
  community_id: string;
  created_by: string;
  data: string;
  created_at: string;
}

export interface MemberNotesTable {
  id: string;
  community_id: string;
  target: string;
  author: string;
  data: string;
  created_at: string;
}

export interface WebhooksTable {
  id: string;
  community_id: string;
  channel_id: string;
  sealed: string;
  token_hash: string | null;
  created_by: string;
  created_at: string;
  revoked: Generated<number>;
}

export interface CommunityStickersTable {
  id: string;
  community_id: string;
  created_by: string;
  data: string;
  created_at: string;
}

export interface Database {
  community_stickers: CommunityStickersTable;
  webhooks: WebhooksTable;
  member_notes: MemberNotesTable;
  community_sounds: CommunitySoundsTable;
  community_reports: CommunityReportsTable;
  community_emojis: CommunityEmojisTable;
  community_events: CommunityEventsTable;
  community_event_rsvps: CommunityEventRsvpsTable;
  signed_prekeys: SignedPreKeysTable;
  prekeys: PreKeysTable;
  kyber_prekeys: KyberPreKeysTable;
  mailbox: MailboxTable;
  blocks: BlocksTable;
  attachments: AttachmentsTable;
  communities: CommunitiesTable;
  community_members: CommunityMembersTable;
  channels: ChannelsTable;
  categories: CategoriesTable;
  category_overwrites: CategoryOverwritesTable;
  audit_log: AuditLogTable;
  threads: ThreadsTable;
  invites: InvitesTable;
  messages: MessagesTable;
  roles: RolesTable;
  member_roles: MemberRolesTable;
  channel_overwrites: ChannelOverwritesTable;
  bans: BansTable;
  message_reactions: MessageReactionsTable;
  server_meta: ServerMetaTable;
  signups: SignupsTable;
  username_holds: UsernameHoldsTable;
  account_tombstones: AccountTombstonesTable;
  accounts: AccountsTable;
  devices: DevicesTable;
  sessions: SessionsTable;
  auth_challenges: AuthChallengesTable;
}
