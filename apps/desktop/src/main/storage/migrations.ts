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
  {
    version: 6,
    name: '0006_direct_messages',
    up(db) {
      // libsignal protocol state (sessions, identities, prekeys) and decrypted
      // direct-message history. All of it lives only in this encrypted database.
      db.exec(`
        CREATE TABLE signal_store (
          kind  TEXT NOT NULL,
          id    TEXT NOT NULL,
          value BLOB NOT NULL,
          PRIMARY KEY (kind, id)
        ) STRICT;
        CREATE TABLE contacts (
          river_id   TEXT PRIMARY KEY,
          name       TEXT,
          avatar     TEXT,
          state      TEXT NOT NULL CHECK (state IN ('accepted', 'request', 'blocked')),
          created_at TEXT NOT NULL,
          last_read  TEXT,
          key_changed INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE dm_messages (
          id          TEXT PRIMARY KEY,
          peer        TEXT NOT NULL,
          sender      TEXT NOT NULL,
          body        TEXT NOT NULL,
          sent_at     TEXT NOT NULL,
          edited_at   TEXT,
          deleted     INTEGER NOT NULL DEFAULT 0,
          status      TEXT NOT NULL,
          reactions   TEXT NOT NULL DEFAULT '{}'
        ) STRICT;
        CREATE INDEX dm_messages_by_peer ON dm_messages (peer, sent_at);
      `);
    },
  },
  {
    version: 7,
    name: '0007_community_key_epochs',
    up(db) {
      // Every key a community has had. Existing keys become epoch 0.
      db.exec(`
        CREATE TABLE community_keys (
          community_id TEXT NOT NULL,
          epoch        INTEGER NOT NULL,
          key          BLOB NOT NULL,
          added_at     TEXT NOT NULL,
          PRIMARY KEY (community_id, epoch)
        ) STRICT;
        INSERT INTO community_keys (community_id, epoch, key, added_at)
          SELECT id, 0, key, joined_at FROM communities;
      `);
    },
  },
  {
    version: 8,
    name: '0008_dm_groups',
    up(db) {
      // Group conversations (pairwise libsignal fan-out); members/admins/profiles are JSON.
      db.exec(`
        CREATE TABLE dm_groups (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          members    TEXT NOT NULL,
          admins     TEXT NOT NULL,
          profiles   TEXT NOT NULL,
          state      TEXT NOT NULL CHECK (state IN ('accepted', 'request', 'left')),
          created_at TEXT NOT NULL,
          last_read  TEXT
        ) STRICT;
      `);
    },
  },
];
