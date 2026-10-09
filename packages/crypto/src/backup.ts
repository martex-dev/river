import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BYTEWORDS } from './bytewords.ts';

/**
 * Recovery phrase and encrypted backups.
 *
 * The recovery secret is 16 random bytes (128 bits), shown as 16 Bytewords
 * plus 2 checksum words (the first two bytes of its SHA-256), so typos are
 * caught. The backup key is HKDF-SHA256(secret, info = "river-backup-v1").
 * A backup file is "RIVERBK1" ‖ nonce(12) ‖ AES-256-GCM(gzip(JSON)) with the
 * magic as associated data. Without the phrase a backup is useless.
 */
export const RECOVERY_SECRET_BYTES = 16;
const MAGIC = Buffer.from('RIVERBK1', 'ascii');

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export function generateRecoverySecret(): Uint8Array {
  return randomBytes(RECOVERY_SECRET_BYTES);
}

const checksum = (secret: Uint8Array): Buffer => createHash('sha256').update(secret).digest().subarray(0, 2);

export function recoveryPhrase(secret: Uint8Array): string[] {
  if (secret.length !== RECOVERY_SECRET_BYTES) throw new BackupError('bad secret');
  return [...secret, ...checksum(secret)].map((b) => BYTEWORDS[b]!);
}

/** Accepts the words in any case and spacing; throws if a word is unknown or the checksum fails. */
export function parseRecoveryPhrase(phrase: string): Uint8Array {
  const words = phrase
    .toLowerCase()
    .split(/[\s,.-]+/)
    .filter(Boolean);
  if (words.length !== RECOVERY_SECRET_BYTES + 2) {
    throw new BackupError(
      `The recovery phrase has ${RECOVERY_SECRET_BYTES + 2} words; you entered ${words.length}.`,
    );
  }
  const bytes = words.map((w) => {
    const i = BYTEWORDS.indexOf(w);
    if (i < 0) throw new BackupError(`"${w}" is not a recovery word. Check the spelling.`);
    return i;
  });
  const secret = Uint8Array.from(bytes.slice(0, RECOVERY_SECRET_BYTES));
  const sum = checksum(secret);
  if (sum[0] !== bytes[RECOVERY_SECRET_BYTES] || sum[1] !== bytes[RECOVERY_SECRET_BYTES + 1]) {
    throw new BackupError('The recovery phrase is not right — a word may be wrong or in the wrong order.');
  }
  return secret;
}

function backupKey(secret: Uint8Array): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'river-backup-v1', 32));
}

export function sealBackup(secret: Uint8Array, data: unknown): Uint8Array {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', backupKey(secret), nonce);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([
    cipher.update(gzipSync(Buffer.from(JSON.stringify(data), 'utf8'))),
    cipher.final(),
  ]);
  return Buffer.concat([MAGIC, nonce, body, cipher.getAuthTag()]);
}

export function openBackup<T = unknown>(secret: Uint8Array, file: Uint8Array): T {
  const buf = Buffer.from(file);
  if (buf.length < MAGIC.length + 12 + 16 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupError('This is not a River backup file.');
  }
  const nonce = buf.subarray(MAGIC.length, MAGIC.length + 12);
  const decipher = createDecipheriv('aes-256-gcm', backupKey(secret), nonce);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  let packed: Buffer;
  try {
    packed = Buffer.concat([
      decipher.update(buf.subarray(MAGIC.length + 12, buf.length - 16)),
      decipher.final(),
    ]);
  } catch {
    throw new BackupError('This recovery phrase does not open this backup.');
  }
  return JSON.parse(gunzipSync(packed, { maxOutputLength: 1024 * 1024 * 1024 }).toString('utf8')) as T;
}
