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
}

export interface CommunityMembersTable {
  community_id: string;
  river_id: string;
  role: string;
  profile: string;
  joined_on: string;
  timeout_until: string | null;
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
  slowmode: Generated<number>;
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

export interface Database {
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
  accounts: AccountsTable;
  devices: DevicesTable;
  sessions: SessionsTable;
  auth_challenges: AuthChallengesTable;
}
