import { afterEach, describe, expect, it } from 'vitest';
import Database from '../../apps/mobile/core/shims/sqlite.ts';

/**
 * The phone's better-sqlite3 shim (apps/mobile/core/shims/sqlite.ts) over a
 * fake native interface: transactions keep their depth right and report the
 * error that matters when COMMIT or ROLLBACK fail.
 */

const KEY = `"x'${'ab'.repeat(32)}'"`;

function fakeNative(fail: (sql: string) => string | null): string[] {
  const statements: string[] = [];
  (globalThis as { RiverNative?: unknown }).RiverNative = {
    call(method: string, argsJson: string): string {
      const args = JSON.parse(argsJson) as { sql?: string };
      if (method === 'db.open') return JSON.stringify({ v: 1 });
      if (method === 'db.close') return JSON.stringify({ v: null });
      const sql = args.sql ?? '';
      statements.push(sql);
      const error = fail(sql);
      if (error) return JSON.stringify({ e: error, code: 'SQLITE_ERROR' });
      if (method === 'db.all') return JSON.stringify({ v: { columns: [], rows: [] } });
      return JSON.stringify({ v: { changes: 0, lastInsertRowid: 0 } });
    },
  };
  return statements;
}

function open(): Database {
  const db = new Database('/data/river.db');
  db.pragma(`key = ${KEY}`);
  return db;
}

afterEach(() => {
  delete (globalThis as { RiverNative?: unknown }).RiverNative;
});

describe('phone SQLite transactions', () => {
  it('commits, and is out of the transaction afterwards', () => {
    const statements = fakeNative(() => null);
    const db = open();
    const result = db.transaction(() => {
      expect(db.inTransaction).toBe(true);
      db.prepare('INSERT INTO t VALUES (1)').run();
      return 42;
    })();
    expect(result).toBe(42);
    expect(db.inTransaction).toBe(false);
    expect(statements).toEqual(['BEGIN', 'INSERT INTO t VALUES (1)', 'COMMIT']);
  });

  it('a failed COMMIT reports its own error, rolls back, and leaves the depth at zero', () => {
    const statements = fakeNative((sql) => (sql === 'COMMIT' ? 'database is locked' : null));
    const db = open();
    expect(() => db.transaction(() => undefined)()).toThrow('database is locked');
    expect(db.inTransaction).toBe(false);
    expect(statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
    // The next transaction starts afresh rather than being taken as nested.
    const next = fakeNative(() => null);
    db.transaction(() => expect(db.inTransaction).toBe(true))();
    expect(db.inTransaction).toBe(false);
    expect(next).toEqual(['BEGIN', 'COMMIT']);
  });

  it('a ROLLBACK that fails (already rolled back) does not hide the real error', () => {
    fakeNative((sql) =>
      sql.startsWith('INSERT')
        ? 'UNIQUE constraint failed'
        : sql === 'ROLLBACK'
          ? 'no transaction is active'
          : null,
    );
    const db = open();
    expect(() => db.transaction(() => db.prepare('INSERT INTO t VALUES (1)').run())()).toThrow(
      'UNIQUE constraint failed',
    );
    expect(db.inTransaction).toBe(false);
  });

  it('nested transactions are part of the outer one', () => {
    const statements = fakeNative(() => null);
    const db = open();
    db.transaction(() => db.transaction(() => db.exec('DELETE FROM t'))())();
    expect(statements).toEqual(['BEGIN', 'DELETE FROM t', 'COMMIT']);
  });
});
