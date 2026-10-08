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
];
