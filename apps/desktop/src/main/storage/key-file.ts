import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import sodium from 'libsodium-wrappers-sumo';
import { z } from 'zod';

/**
 * The local database key is 32 random bytes. It is never stored in plaintext:
 * either the operating system keystore wraps it (Windows DPAPI, macOS
 * Keychain, Linux Secret Service via Electron safeStorage), or — where no real
 * keystore exists — it is encrypted under a key derived from the user's
 * passphrase with Argon2id (RFC 9106) and sealed with AES-256-GCM.
 */
export const DB_KEY_BYTES = 32;

/**
 * Argon2id with 64 MiB and 3 passes (RFC 9106 §4 second option's memory and
 * time cost). libsodium's implementation uses a single lane, so parallelism is 1.
 * Note: Electron's BoringSSL has no Argon2, so River uses libsodium rather than
 * node:crypto (which only has it when built with OpenSSL ≥ 3.2).
 */
export const ARGON2_PARAMS = { memory: 64 * 1024, passes: 3, parallelism: 1 } as const;
export type Argon2Params = { memory: number; passes: number; parallelism: 1 };

const AAD = Buffer.from('river-db-key-v1', 'utf8');
const b64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const keyFileSchema = z.discriminatedUnion('protection', [
  z.object({
    version: z.literal(1),
    protection: z.literal('os-keystore'),
    wrapped: b64,
  }),
  z.object({
    version: z.literal(1),
    protection: z.literal('passphrase'),
    kdf: z.object({
      algorithm: z.literal('argon2id'),
      memory: z
        .number()
        .int()
        .min(19 * 1024)
        .max(4 * 1024 * 1024),
      passes: z.number().int().min(1).max(16),
      parallelism: z.literal(1),
      salt: b64,
    }),
    nonce: b64,
    ciphertext: b64,
    tag: b64,
  }),
]);
export type KeyFile = z.infer<typeof keyFileSchema>;

export class WrongPassphraseError extends Error {
  constructor() {
    super('Incorrect passphrase');
    this.name = 'WrongPassphraseError';
  }
}

export function newDatabaseKey(): Buffer {
  return randomBytes(DB_KEY_BYTES);
}

export const MIN_PASSPHRASE_LENGTH = 10;

/** Argon2id via libsodium (`crypto_pwhash`, ALG_ARGON2ID13). `memory` is in KiB. */
export async function deriveKek(passphrase: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  await sodium.ready;
  if (salt.length !== sodium.crypto_pwhash_SALTBYTES) throw new Error('Bad salt length');
  const out = sodium.crypto_pwhash(
    32,
    Buffer.from(passphrase.normalize('NFKC'), 'utf8'),
    salt,
    params.passes,
    params.memory * 1024,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return Buffer.from(out);
}

export async function sealWithPassphrase(
  dbKey: Buffer,
  passphrase: string,
  params: Argon2Params = ARGON2_PARAMS,
): Promise<KeyFile> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const salt = randomBytes(16);
  const kek = await deriveKek(passphrase, salt, params);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(dbKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  kek.fill(0);
  return {
    version: 1,
    protection: 'passphrase',
    kdf: { algorithm: 'argon2id', ...params, salt: salt.toString('base64') },
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export async function openWithPassphrase(
  file: Extract<KeyFile, { protection: 'passphrase' }>,
  passphrase: string,
): Promise<Buffer> {
  const kek = await deriveKek(passphrase, Buffer.from(file.kdf.salt, 'base64'), file.kdf);
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(file.nonce, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    const key = Buffer.concat([decipher.update(Buffer.from(file.ciphertext, 'base64')), decipher.final()]);
    if (key.length !== DB_KEY_BYTES) throw new WrongPassphraseError();
    return key;
  } catch {
    throw new WrongPassphraseError();
  } finally {
    kek.fill(0);
  }
}

/** Abstraction over Electron's safeStorage so the logic is testable without Electron. */
export interface OsKeystore {
  /** False when no real keystore exists (e.g. Linux without a Secret Service). */
  usable(): boolean;
  /** Human name for the Security Center, e.g. "Windows DPAPI". */
  name(): string;
  wrap(plaintext: Buffer): Buffer;
  unwrap(wrapped: Buffer): Buffer;
}

export function sealWithKeystore(dbKey: Buffer, keystore: OsKeystore): KeyFile {
  return { version: 1, protection: 'os-keystore', wrapped: keystore.wrap(dbKey).toString('base64') };
}

export function openWithKeystore(
  file: Extract<KeyFile, { protection: 'os-keystore' }>,
  keystore: OsKeystore,
): Buffer {
  const key = keystore.unwrap(Buffer.from(file.wrapped, 'base64'));
  if (key.length !== DB_KEY_BYTES) throw new Error('Unwrapped database key has the wrong length');
  return key;
}
