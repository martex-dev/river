import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Encrypted attachments in the Signal attachment format:
 *
 * - a fresh random 64-byte key per attachment: AES-256 key ‖ HMAC-SHA256 key;
 * - the plaintext is padded with zeros to a size bucket (hides the exact size);
 * - AES-256-CBC (PKCS#7) with a random IV, then HMAC-SHA256 over IV ‖ ciphertext
 *   (encrypt-then-MAC);
 * - blob = IV ‖ ciphertext ‖ MAC, and the SHA-256 digest of the blob travels
 *   with the key inside the end-to-end encrypted message.
 *
 * The server stores only the blob. Decryption checks the digest and the MAC in
 * constant time before decrypting anything.
 */
export const ATTACHMENT_KEY_BYTES = 64;
const IV = 16;
const MAC = 32;

export interface EncryptedAttachment {
  /** IV ‖ ciphertext ‖ MAC — what the server stores. */
  blob: Uint8Array;
  /** 64 random bytes; never leaves end-to-end encrypted messages. */
  key: Uint8Array;
  /** SHA-256 of `blob`. */
  digest: Uint8Array;
  /** Size of the original plaintext in bytes. */
  size: number;
}

export class AttachmentIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentIntegrityError';
  }
}

/** Padded length for `size`: ≥ 541 bytes, then 5 % size buckets (as Signal does). */
export function paddedSize(size: number): number {
  return Math.max(541, Math.floor(1.05 ** Math.ceil(Math.log(Math.max(size, 1)) / Math.log(1.05))));
}

export function encryptAttachment(plaintext: Uint8Array): EncryptedAttachment {
  const key = randomBytes(ATTACHMENT_KEY_BYTES);
  const iv = randomBytes(IV);
  const padded = Buffer.alloc(Math.max(paddedSize(plaintext.length), plaintext.length));
  padded.set(plaintext);
  const cipher = createCipheriv('aes-256-cbc', key.subarray(0, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const mac = createHmac('sha256', key.subarray(32)).update(iv).update(ciphertext).digest();
  const blob = Buffer.concat([iv, ciphertext, mac]);
  return { blob, key, digest: createHash('sha256').update(blob).digest(), size: plaintext.length };
}

export function decryptAttachment(
  blob: Uint8Array,
  pointer: { key: Uint8Array; digest: Uint8Array; size: number },
): Uint8Array {
  if (pointer.key.length !== ATTACHMENT_KEY_BYTES) throw new AttachmentIntegrityError('bad key');
  if (blob.length < IV + 16 + MAC || (blob.length - IV - MAC) % 16 !== 0) {
    throw new AttachmentIntegrityError('bad length');
  }
  const digest = createHash('sha256').update(blob).digest();
  if (pointer.digest.length !== 32 || !timingSafeEqual(digest, pointer.digest)) {
    throw new AttachmentIntegrityError('digest mismatch');
  }
  const buf = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const iv = buf.subarray(0, IV);
  const ciphertext = buf.subarray(IV, buf.length - MAC);
  const mac = buf.subarray(buf.length - MAC);
  const key = Buffer.from(pointer.key);
  const expected = createHmac('sha256', key.subarray(32)).update(iv).update(ciphertext).digest();
  if (!timingSafeEqual(mac, expected)) throw new AttachmentIntegrityError('MAC mismatch');
  const decipher = createDecipheriv('aes-256-cbc', key.subarray(0, 32), iv);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (pointer.size < 0 || pointer.size > padded.length) throw new AttachmentIntegrityError('bad size');
  return padded.subarray(0, pointer.size);
}
