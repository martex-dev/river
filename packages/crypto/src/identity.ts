import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Fingerprint, IdentityKeyPair, PublicKey } from '@signalapp/libsignal-client';
import { BYTEWORDS } from './bytewords.ts';

/**
 * A River identity. The key pair is a libsignal identity key (Curve25519 with
 * XEdDSA signatures) — the same construction Signal uses. River adds only
 * presentation: a River ID, a short fingerprint and verification words.
 */
export interface IdentityKeys {
  /** Random UUID chosen on this device; becomes the account ID at registration. */
  riverId: string;
  /** libsignal-serialised public key (33 bytes: type byte 0x05 + 32-byte key). */
  publicKey: Uint8Array;
  /** libsignal-serialised private key (32 bytes). Never leaves the main process. */
  privateKey: Uint8Array;
  /** libsignal registration ID (14 bits, non-zero). */
  registrationId: number;
}

export const FINGERPRINT_BYTES = 16;

/** Iterations and version of libsignal's numeric fingerprint (the values Signal uses). */
const SAFETY_NUMBER_ITERATIONS = 5200;
const SAFETY_NUMBER_VERSION = 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createIdentity(): IdentityKeys {
  const pair = IdentityKeyPair.generate();
  return {
    riverId: randomUUID(),
    publicKey: pair.publicKey.serialize(),
    privateKey: pair.privateKey.serialize(),
    registrationId: randomInt(1, 0x3fff),
  };
}

export function isRiverId(value: string): boolean {
  return UUID_RE.test(value);
}

/** Validates and normalises a serialised identity public key (throws if invalid). */
export function parseIdentityPublicKey(bytes: Uint8Array): PublicKey {
  return PublicKey.deserialize(new Uint8Array(bytes));
}

/** SHA-256 of the serialised identity public key, truncated to 128 bits. */
export function identityFingerprint(publicKey: Uint8Array): Uint8Array {
  parseIdentityPublicKey(publicKey);
  return new Uint8Array(createHash('sha256').update(publicKey).digest().subarray(0, FINGERPRINT_BYTES));
}

/** "AB73 29FA 91C2 77D4 …" — 8 groups of 4 hex digits. */
export function formatFingerprint(fingerprint: Uint8Array): string {
  const hex = Buffer.from(fingerprint).toString('hex').toUpperCase();
  return (hex.match(/.{1,4}/g) ?? []).join(' ');
}

/** One Bytewords word per byte: 16 words for a 128-bit fingerprint. */
export function verificationWords(fingerprint: Uint8Array): string[] {
  return Array.from(fingerprint, (b) => BYTEWORDS[b]!);
}

function uuidBytes(riverId: string): Uint8Array<ArrayBuffer> {
  if (!isRiverId(riverId)) throw new Error('Invalid River ID');
  return new Uint8Array(Buffer.from(riverId.replace(/-/g, ''), 'hex'));
}

export interface SafetyNumber {
  /** 60 digits, shown as 12 groups of 5. Identical on both sides. */
  digits: string;
  /** libsignal scannable fingerprint, encoded into the QR code. */
  scannable: Uint8Array;
}

/** libsignal numeric fingerprint over both parties' River IDs and identity keys. */
export function safetyNumber(
  local: { riverId: string; publicKey: Uint8Array },
  remote: { riverId: string; publicKey: Uint8Array },
): SafetyNumber {
  const fp = Fingerprint.new(
    SAFETY_NUMBER_ITERATIONS,
    SAFETY_NUMBER_VERSION,
    uuidBytes(local.riverId),
    parseIdentityPublicKey(local.publicKey),
    uuidBytes(remote.riverId),
    parseIdentityPublicKey(remote.publicKey),
  );
  return {
    digits: fp.displayableFingerprint().toString(),
    scannable: fp.scannableFingerprint().toBuffer(),
  };
}

export function formatSafetyNumber(digits: string): string {
  return (digits.match(/.{1,5}/g) ?? []).join(' ');
}
