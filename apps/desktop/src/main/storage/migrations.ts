import type { ClientMigration } from './database.ts';

/**
 * Local database schema history. Append only — every installed River upgrades
 * through these in order, from whatever version it last ran.
 */
export const CLIENT_MIGRATIONS: readonly ClientMigration[] = [
  {
    version: 1,
    name: '0001_meta',
    up(db) {
      db.exec(`
        CREATE TABLE meta (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 2,
    name: '0002_identity',
    up(db) {
      // Exactly one row. private_key is protected by the database encryption (SQLCipher).
      db.exec(`
        CREATE TABLE identity (
          id              INTEGER PRIMARY KEY CHECK (id = 1),
          river_id        TEXT NOT NULL,
          public_key      BLOB NOT NULL,
          private_key     BLOB NOT NULL,
          registration_id INTEGER NOT NULL,
          display_name    TEXT,
          created_at      TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 3,
    name: '0003_account',
    up(db) {
      // The account on a River server. device_private_key never leaves this database.
      db.exec(`
        CREATE TABLE account (
          id                    INTEGER PRIMARY KEY CHECK (id = 1),
          server_url            TEXT NOT NULL,
          river_id              TEXT NOT NULL,
          device_id             INTEGER NOT NULL,
          device_public_key     BLOB NOT NULL,
          device_private_key    BLOB NOT NULL,
          device_list           BLOB NOT NULL,
          device_list_signature BLOB NOT NULL,
          device_list_version   INTEGER NOT NULL,
          registered_at         TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 4,
    name: '0004_communities',
    up(db) {
      // Community keys arrive only in invite links and never leave this database.
      db.exec(`
        CREATE TABLE communities (
          id        TEXT PRIMARY KEY,
          key       BLOB NOT NULL,
          joined_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 5,
    name: '0005_profile',
    up(db) {
      // The avatar is shared with communities only inside sealed profiles.
      db.exec(`
        CREATE TABLE profile (
          id     INTEGER PRIMARY KEY CHECK (id = 1),
          avatar TEXT
        ) STRICT;
      `);
    },
  },
];
