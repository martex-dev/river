import {
  createIdentity,
  formatFingerprint,
  identityFingerprint,
  sign,
  verificationWords,
} from '@river/crypto';
import { z } from 'zod';
import type { IdentityInfo } from '../../shared/ipc.ts';
import type { LocalDatabase } from '../storage/database.ts';

export const displayNameSchema = z
  .string()
  .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(z.string().max(64))
  .transform((s) => (s === '' ? null : s));

export interface IdentitySigner {
  riverId: string;
  publicKey: Uint8Array;
  registrationId: number;
  sign(message: Uint8Array): Uint8Array;
}

interface IdentityRow {
  river_id: string;
  public_key: Uint8Array;
  display_name: string | null;
  created_at: string;
}

/**
 * Owns the user's identity key pair. The private key is stored only in the
 * encrypted local database and never leaves the main process: everything this
 * service returns to the UI is derived from the public key.
 */
export class IdentityService {
  private readonly db: () => LocalDatabase | null;
  private readonly now: () => Date;

  constructor(db: () => LocalDatabase | null, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  get(): IdentityInfo | null {
    const db = this.db();
    if (!db) return null;
    const row = db
      .prepare('SELECT river_id, public_key, display_name, created_at FROM identity WHERE id = 1')
      .get() as IdentityRow | undefined;
    return row ? toInfo(row) : null;
  }

  /** Creates the identity once. Throws if storage is not open or an identity already exists. */
  create(rawDisplayName: unknown): IdentityInfo {
    const db = this.db();
    if (!db) throw new Error('Local storage is not open');
    const displayName = displayNameSchema.parse(rawDisplayName ?? '');
    if (this.get()) throw new Error('An identity already exists');
    const keys = createIdentity();
    try {
      db.prepare(
        `INSERT INTO identity (id, river_id, public_key, private_key, registration_id, display_name, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      ).run(
        keys.riverId,
        Buffer.from(keys.publicKey),
        Buffer.from(keys.privateKey),
        keys.registrationId,
        displayName,
        this.now().toISOString(),
      );
    } finally {
      keys.privateKey.fill(0);
    }
    return this.get()!;
  }

  /**
   * Main-process-only: the full identity for libsignal's identity-key store,
   * which needs the private key for session agreement. Never sent over IPC.
   */
  protocolIdentity(): {
    riverId: string;
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    registrationId: number;
  } | null {
    const db = this.db();
    if (!db) return null;
    const row = db
      .prepare('SELECT river_id, public_key, private_key, registration_id FROM identity WHERE id = 1')
      .get() as
      | { river_id: string; public_key: Uint8Array; private_key: Uint8Array; registration_id: number }
      | undefined;
    if (!row) return null;
    return {
      riverId: row.river_id,
      publicKey: new Uint8Array(row.public_key),
      privateKey: new Uint8Array(row.private_key),
      registrationId: row.registration_id,
    };
  }

  /**
   * Main-process-only access for protocol code: public material plus a signing
   * function. The private key is read, used and zeroed inside `sign`.
   */
  signer(): IdentitySigner | null {
    const db = this.db();
    if (!db) return null;
    const row = db
      .prepare('SELECT river_id, public_key, registration_id FROM identity WHERE id = 1')
      .get() as { river_id: string; public_key: Uint8Array; registration_id: number } | undefined;
    if (!row) return null;
    return {
      riverId: row.river_id,
      publicKey: new Uint8Array(row.public_key),
      registrationId: row.registration_id,
      sign: (message) => {
        const { private_key } = db.prepare('SELECT private_key FROM identity WHERE id = 1').get() as {
          private_key: Uint8Array;
        };
        try {
          return sign(private_key, message);
        } finally {
          private_key.fill(0);
        }
      },
    };
  }

  setDisplayName(rawDisplayName: unknown): IdentityInfo {
    const db = this.db();
    if (!db || !this.get()) throw new Error('No identity');
    db.prepare('UPDATE identity SET display_name = ? WHERE id = 1').run(
      displayNameSchema.parse(rawDisplayName),
    );
    return this.get()!;
  }
}

function toInfo(row: IdentityRow): IdentityInfo {
  const fp = identityFingerprint(new Uint8Array(row.public_key));
  return {
    riverId: row.river_id,
    displayName: row.display_name,
    fingerprint: formatFingerprint(fp),
    words: verificationWords(fp),
    createdAt: row.created_at,
  };
}
