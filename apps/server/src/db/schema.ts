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

export interface Database {
  server_meta: ServerMetaTable;
  accounts: AccountsTable;
  devices: DevicesTable;
  sessions: SessionsTable;
  auth_challenges: AuthChallengesTable;
}
