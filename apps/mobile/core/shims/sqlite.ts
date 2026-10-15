import { native, NativeError } from '../native.ts';

/**
 * The part of better-sqlite3(-multiple-ciphers) River's client core uses,
 * over SQLCipher on the phone. Synchronous like the original: every call is a
 * synchronous native call.
 *
 * Keying: `openEncryptedDatabase` sets `cipher`, `legacy` and `key` pragmas
 * before the first read. SQLCipher for Android has to be keyed when the file
 * is opened, so the native open is deferred until the first statement and the
 * key pragma is passed to it.
 */

type Row = Record<string, unknown>;

const BLOB = '$b';

function encodeValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (v instanceof Uint8Array)
    return { [BLOB]: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') };
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
}

function decodeValue(v: unknown): unknown {
  if (v && typeof v === 'object' && BLOB in v)
    return Buffer.from((v as Record<string, string>)[BLOB]!, 'base64');
  return v;
}

/**
 * Walks SQL outside string literals, identifiers and comments. Used to split
 * scripts into statements and to rewrite named parameters as positional ones.
 */
function scan(sql: string, onCode: (ch: string, i: number) => void): void {
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) break;
        if (sql[j] === close) {
          if (close !== ']' && sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
    } else if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end + 1;
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else {
      onCode(ch, i);
      i++;
    }
  }
}

/** Splits a script into single statements (no triggers: River's schema has none). */
export function splitStatements(script: string): string[] {
  const out: string[] = [];
  let start = 0;
  scan(script, (ch, i) => {
    if (ch === ';') {
      out.push(script.slice(start, i));
      start = i + 1;
    }
  });
  out.push(script.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() !== '');
}

/** Rewrites @name / :name / $name parameters to `?` and returns their order. */
export function positional(sql: string): { sql: string; names: string[] } {
  const names: string[] = [];
  const cuts: Array<[number, number]> = [];
  scan(sql, (ch, i) => {
    if ((ch === '@' || ch === ':' || ch === '$') && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j]!)) j++;
      names.push(sql.slice(i + 1, j));
      cuts.push([i, j]);
    }
  });
  let out = '';
  let last = 0;
  for (const [a, b] of cuts) {
    out += `${sql.slice(last, a)}?`;
    last = b;
  }
  return { sql: out + sql.slice(last), names };
}

function bind(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const single = params.length === 1 ? params[0] : undefined;
  if (
    single !== null &&
    typeof single === 'object' &&
    !(single instanceof Uint8Array) &&
    !Array.isArray(single)
  ) {
    const named = positional(sql);
    const values = single as Record<string, unknown>;
    return {
      sql: named.sql,
      params: named.names.map((n) => {
        if (!(n in values)) throw new RangeError(`Missing named parameter "${n}"`);
        return encodeValue(values[n]);
      }),
    };
  }
  const flat = params.length === 1 && Array.isArray(single) ? single : params;
  return { sql, params: flat.map(encodeValue) };
}

function sqliteError(err: unknown): unknown {
  if (err instanceof NativeError) {
    return Object.assign(new Error(err.message), { code: err.code ?? 'SQLITE_ERROR' });
  }
  return err;
}

class Statement {
  private readonly db: Database;
  readonly source: string;
  constructor(db: Database, source: string) {
    this.db = db;
    this.source = source;
  }
  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const b = bind(this.source, params);
    return this.db.call('db.run', b.sql, b.params);
  }
  all(...params: unknown[]): Row[] {
    const b = bind(this.source, params);
    const { columns, rows } = this.db.call('db.all', b.sql, b.params);
    return rows.map((r) => {
      const o: Row = {};
      columns.forEach((c, i) => {
        o[c] = decodeValue(r[i]);
      });
      return o;
    });
  }
  get(...params: unknown[]): Row | undefined {
    return this.all(...params)[0];
  }
}

export default class Database {
  readonly name: string;
  private handle: number | null = null;
  private closed = false;
  private depth = 0;

  constructor(path: string) {
    this.name = path;
  }

  get open(): boolean {
    return !this.closed;
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  private ensure(): number {
    if (this.closed) throw new TypeError('The database connection is not open');
    if (this.handle === null) {
      throw Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
    }
    return this.handle;
  }

  /** Native call with the database handle; errors become SQLite-style errors with a code. */
  call<M extends 'db.run' | 'db.all'>(
    method: M,
    sql: string,
    params: unknown[],
  ): M extends 'db.run'
    ? { changes: number; lastInsertRowid: number }
    : { columns: string[]; rows: unknown[][] } {
    const db = this.ensure();
    try {
      return native(method, { db, sql, params }) as never;
    } catch (err) {
      throw sqliteError(err);
    }
  }

  prepare(sql: string): Statement {
    this.ensure();
    return new Statement(this, sql);
  }

  exec(script: string): this {
    for (const sql of splitStatements(script)) this.call('db.run', sql, []);
    return this;
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    const m = /^\s*(\w+)\s*(?:=\s*(.*))?$/s.exec(source);
    const name = m?.[1]?.toLowerCase();
    // Cipher settings of SQLite3 Multiple Ciphers: SQLCipher for Android always uses the SQLCipher 4 format.
    if (name === 'cipher' || name === 'legacy') return [];
    if (name === 'key') {
      const hex = /^"x'([0-9a-fA-F]{64})'"$/.exec(m?.[2]?.trim() ?? '')?.[1];
      if (!hex) throw new Error('Only raw 32-byte keys are supported');
      if (this.handle !== null) throw new Error('The database is already keyed');
      try {
        this.handle = native('db.open', { path: this.name, key: Buffer.from(hex, 'hex').toString('base64') });
      } catch (err) {
        throw sqliteError(err);
      }
      return [];
    }
    const rows = this.prepare(`PRAGMA ${source}`).all();
    if (options?.simple) {
      const first = rows[0];
      return first ? Object.values(first)[0] : undefined;
    }
    return rows;
  }

  /**
   * Like better-sqlite3's, except that a nested transaction is part of the
   * outer one rather than a savepoint (SQLCipher for Android cannot roll back
   * to a savepoint inside its transactions): an error in it rolls back the
   * whole transaction when it reaches the outermost one. River's client code
   * does not nest transactions.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      if (this.depth > 0) return fn(...args);
      this.exec('BEGIN');
      this.depth++;
      try {
        const result = fn(...args);
        this.depth--;
        this.exec('COMMIT');
        return result;
      } catch (err) {
        this.depth--;
        this.exec('ROLLBACK');
        throw err;
      }
    };
  }

  close(): this {
    if (!this.closed && this.handle !== null) native('db.close', { db: this.handle });
    this.closed = true;
    this.handle = null;
    return this;
  }
}
