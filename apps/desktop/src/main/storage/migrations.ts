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
  {
    version: 9,
    name: '0009_social',
    up(db) {
      // Posts and stories (yours and ones shared with you), their comments,
      // reactions and story views. Bios for you and your contacts.
      db.exec(`
        CREATE TABLE posts (
          id         TEXT PRIMARY KEY,
          author     TEXT NOT NULL,
          kind       TEXT NOT NULL CHECK (kind IN ('post', 'story')),
          body       TEXT NOT NULL,
          audience   TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          expires_at TEXT,
          seen       INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE INDEX posts_by_time ON posts (created_at);
        CREATE TABLE post_comments (
          id         TEXT PRIMARY KEY,
          post_id    TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
          author     TEXT NOT NULL,
          author_name TEXT NOT NULL,
          text       TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE post_reactions (
          post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
          author  TEXT NOT NULL,
          emoji   TEXT NOT NULL,
          PRIMARY KEY (post_id, author, emoji)
        ) STRICT;
        CREATE TABLE story_views (
          post_id   TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
          viewer    TEXT NOT NULL,
          viewed_at TEXT NOT NULL,
          PRIMARY KEY (post_id, viewer)
        ) STRICT;
        ALTER TABLE contacts ADD COLUMN bio TEXT;
        ALTER TABLE profile ADD COLUMN bio TEXT;
      `);
    },
  },
  {
    version: 10,
    name: '0010_call_log',
    up(db) {
      // Your call history (who, when, how long). Kept only on this device.
      db.exec(`
        CREATE TABLE call_log (
          id           TEXT PRIMARY KEY,
          peer         TEXT NOT NULL,
          direction    TEXT NOT NULL CHECK (direction IN ('in', 'out')),
          video        INTEGER NOT NULL,
          started_at   TEXT NOT NULL,
          answered     INTEGER NOT NULL,
          duration_sec INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX call_log_by_time ON call_log (started_at);
      `);
    },
  },
  {
    version: 11,
    name: '0011_channel_reads',
    up(db) {
      // Where you stopped reading each community channel, for unread markers.
      db.exec(`
        CREATE TABLE channel_reads (
          channel_id TEXT PRIMARY KEY,
          read_at    TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 12,
    name: '0012_contacts_heard_from',
    up(db) {
      // Whether a contact has ever written back (a message, or the profile they
      // share when accepting), so a request you sent shows as pending, not as a friend.
      db.exec(`
        ALTER TABLE contacts ADD COLUMN heard_from INTEGER NOT NULL DEFAULT 0;
        UPDATE contacts SET heard_from = 1
          WHERE state = 'request'
             OR EXISTS (SELECT 1 FROM dm_messages m WHERE m.peer = contacts.river_id AND m.sender = contacts.river_id);
      `);
    },
  },
  {
    version: 13,
    name: '0013_community_nicknames',
    up(db) {
      // The name you use in one community instead of your River name.
      db.exec(`
        CREATE TABLE community_nicknames (
          community_id TEXT PRIMARY KEY,
          nickname     TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 14,
    name: '0014_server_instance',
    up(db) {
      // Who your server is (its identity key) and where it announces a new address,
      // so River can follow it when a home server's address changes.
      db.exec(`
        CREATE TABLE server_instance (
          id          INTEGER PRIMARY KEY CHECK (id = 1),
          instance_id TEXT NOT NULL,
          public_key  TEXT NOT NULL,
          relay       TEXT,
          topic       TEXT
        ) STRICT;
      `);
    },
  },
  {
    version: 15,
    name: '0015_outbox',
    up(db) {
      // Messages you sent that have not reached the server yet; they survive a restart.
      db.exec(`
        CREATE TABLE outbox (
          local_id   TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          payload    TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
];
