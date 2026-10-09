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
}

export interface CommunityMembersTable {
  community_id: string;
  river_id: string;
  role: string;
  profile: string;
  joined_on: string;
}

export interface ChannelsTable {
  id: string;
  community_id: string;
  kind: string;
  name: string;
  position: number;
}

export interface InvitesTable {
  code_hash: string;
  community_id: string;
  expires_at: string;
  uses: number;
  max_uses: number;
}

export interface MessagesTable {
  id: string;
  channel_id: string;
  sender: string;
  body: string;
  sent_at: string;
  edited_at: string | null;
  pinned: number;
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

export interface Database {
  communities: CommunitiesTable;
  community_members: CommunityMembersTable;
  channels: ChannelsTable;
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
