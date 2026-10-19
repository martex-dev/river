import {
  BackupError,
  generateRecoverySecret,
  openBackup,
  parseRecoveryPhrase,
  recoveryPhrase,
  sealBackup,
} from '@river/crypto';
import type { LocalDatabase } from '../storage/database.ts';
import { msg } from '../../shared/i18n/index.ts';

/**
 * Encrypted backups of everything needed to get your account back on a new
 * computer: identity and device keys, account, community keys, contacts and
 * their safety-number trust, groups, message history and social posts.
 *
 * Not included on purpose: libsignal sessions and prekeys (restoring stale
 * ratchet state would break conversations) — fresh ones are made after a
 * restore and contacts are re-contacted automatically. Files are referenced,
 * not copied.
 */
const TABLES = [
  'identity',
  'account',
  'profile',
  'communities',
  'community_keys',
  'contacts',
  'dm_groups',
  'dm_messages',
  'posts',
  'post_comments',
  'post_reactions',
  'story_views',
  'call_log',
  'channel_reads',
  'community_nicknames',
] as const;
/** Contacts' identity keys (trust on first use) and verification marks. */
const SIGNAL_KINDS = ['identity', 'verified'];
/**
 * Disappearing-message timers per conversation (2.20): without them a restored River would send
 * new messages that never disappear. The messages that are set to disappear are not in backups.
 */
const DM_TIMERS = 'dm:timers';
/**
 * Protocol facts that guard against a server rolling things back (2.11): the newest device list
 * version seen for each contact, and community members known to hold a genuine key. Without
 * them a restored River would accept an older device list again.
 */
const SIGNAL_META_PREFIXES = ['dm:listVersion:', 'community:vouched:', DM_TIMERS];
const backedUpSignal = (kind: string, id: string): boolean =>
  SIGNAL_KINDS.includes(kind) || (kind === 'meta' && SIGNAL_META_PREFIXES.some((p) => id.startsWith(p)));

type Cell = string | number | null | { $b64: string };
interface BackupFile {
  format: 'river-backup';
  version: 1;
  createdAt: string;
  tables: Record<string, Array<Record<string, Cell>>>;
  signal: Array<{ kind: string; id: string; value: string }>;
}

export class BackupService {
  private readonly db: () => LocalDatabase | null;

  constructor(deps: { db: () => LocalDatabase | null }) {
    this.db = deps.db;
  }

  private require(): LocalDatabase {
    const db = this.db();
    if (!db) throw new BackupError(msg('River is locked.'));
    return db;
  }

  private meta(key: string): string | null {
    const row = this.require().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.require().prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  /**
   * Installs from before 2.11.0 never wrote `recovery_phrase_shown`, which locked existing users out
   * of "Save encrypted backup" (2.11.2). Since 2.11.0 the recovery secret is only created together
   * with that mark (showing the phrase, or restoring with it), so a secret without the mark comes
   * from an older River, where it was made by showing the phrase or by saving a backup: counted as
   * shown, once.
   */
  private migratePhraseShown(): void {
    if (this.meta('recovery_phrase_shown') !== null || this.meta('recovery_secret') === null) return;
    this.setMeta('recovery_phrase_shown', `migrated ${new Date().toISOString()}`);
  }

  status(): { hasPhrase: boolean; phraseShown: boolean; lastBackupAt: string | null } {
    if (!this.db()) return { hasPhrase: false, phraseShown: false, lastBackupAt: null };
    this.migratePhraseShown();
    return {
      hasPhrase: this.meta('recovery_secret') !== null,
      phraseShown: this.meta('recovery_phrase_shown') !== null,
      lastBackupAt: this.meta('last_backup_at'),
    };
  }

  private secret(): Uint8Array {
    const hex = this.meta('recovery_secret');
    if (hex) return Uint8Array.from(Buffer.from(hex, 'hex'));
    const secret = generateRecoverySecret();
    this.setMeta('recovery_secret', Buffer.from(secret).toString('hex'));
    return secret;
  }

  /** The recovery phrase (created on first use). Main-process only until the user asks to see it. */
  phrase(): string[] {
    const words = recoveryPhrase(this.secret());
    // Only a phrase the person has seen can open a backup: backups need this first.
    this.setMeta('recovery_phrase_shown', new Date().toISOString());
    return words;
  }

  /**
   * Encrypts a backup. It counts as made only once the file is written (`saved`): a cancelled or
   * failed save must not show "Last backup: now". Needs the recovery phrase to have been shown —
   * without it the file could never be opened.
   */
  create(): { file: Uint8Array; createdAt: string } {
    const db = this.require();
    this.migratePhraseShown();
    if (this.meta('recovery_phrase_shown') === null) {
      throw new BackupError(
        msg('Show your recovery phrase and write it down first: without it, no backup can be opened.'),
      );
    }
    const tables: BackupFile['tables'] = {};
    for (const t of TABLES) {
      // Disappearing messages never go into a backup: a file outlives their timer (2.20).
      const where = t === 'dm_messages' ? ' WHERE expires_at IS NULL' : '';
      const rows = db.prepare(`SELECT * FROM ${t}${where}`).all() as Array<Record<string, unknown>>;
      tables[t] = rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : (v as Cell),
          ]),
        ),
      );
    }
    const signal = (
      db
        .prepare(
          `SELECT kind, id, value FROM signal_store WHERE kind IN (${SIGNAL_KINDS.map(() => '?').join(', ')})
             OR (kind = 'meta' AND (${SIGNAL_META_PREFIXES.map(() => 'id LIKE ?').join(' OR ')}))`,
        )
        .all(...SIGNAL_KINDS, ...SIGNAL_META_PREFIXES.map((p) => `${p}%`)) as Array<{
        kind: string;
        id: string;
        value: Uint8Array;
      }>
    )
      .filter((r) => backedUpSignal(r.kind, r.id))
      .map((r) => ({ kind: r.kind, id: r.id, value: Buffer.from(r.value).toString('base64') }));
    const file: BackupFile = {
      format: 'river-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      tables,
      signal,
    };
    return { file: sealBackup(this.secret(), file), createdAt: file.createdAt };
  }

  /** The backup made at `createdAt` was written to a file. */
  saved(createdAt: string): void {
    if (Number.isNaN(Date.parse(createdAt))) return;
    this.setMeta('last_backup_at', createdAt);
  }

  /** Restores into a fresh River (no identity yet). Throws BackupError with a message for people. */
  restore(file: Uint8Array, phrase: string): void {
    const db = this.require();
    if (db.prepare('SELECT 1 FROM identity').get()) {
      throw new BackupError(
        msg('This River already has an identity. Restore only works on a fresh install.'),
      );
    }
    const secret = parseRecoveryPhrase(phrase);
    const data = openBackup<BackupFile>(secret, file);
    if (data?.format !== 'river-backup' || data.version !== 1 || typeof data.tables !== 'object') {
      throw new BackupError(msg('This backup was made by a newer River. Update River and try again.'));
    }
    const decode = (v: Cell): unknown =>
      v && typeof v === 'object' && '$b64' in v ? Buffer.from(String(v.$b64), 'base64') : v;
    db.transaction(() => {
      for (const t of TABLES) {
        const rows = data.tables[t] ?? [];
        if (!rows.length) continue;
        // Only columns this River has (backups from older versions may lack newer ones).
        const columns = new Set(
          (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name),
        );
        for (const row of rows) {
          const keys = Object.keys(row).filter((k) => columns.has(k));
          if (!keys.length) continue;
          db.prepare(
            `INSERT OR REPLACE INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          ).run(...keys.map((k) => decode(row[k]!)));
        }
      }
      for (const s of data.signal ?? []) {
        if (typeof s.id !== 'string' || !backedUpSignal(s.kind, s.id)) continue;
        db.prepare('INSERT OR REPLACE INTO signal_store (kind, id, value) VALUES (?, ?, ?)').run(
          s.kind,
          s.id,
          Buffer.from(s.value, 'base64'),
        );
      }
      this.setMeta('recovery_secret', Buffer.from(secret).toString('hex'));
      // The person typed the phrase to restore: they have it.
      this.setMeta('recovery_phrase_shown', new Date().toISOString());
      this.setMeta('last_backup_at', data.createdAt);
    })();
  }
}
