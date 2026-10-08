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
];
