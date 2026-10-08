/** Kysely table types. Every table added by a migration is declared here. */
export interface ServerMetaTable {
  key: string;
  value: string;
}

export interface Database {
  server_meta: ServerMetaTable;
}
