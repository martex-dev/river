import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Community content encryption: AES-256-GCM with a random 96-bit nonce under
 * the 32-byte community key. The associated data binds each ciphertext to its
 * community and purpose (e.g. a message to its channel), so the server cannot
 * move ciphertext between communities, channels or fields.
 * Format: base64(nonce ‖ ciphertext ‖ tag).
 */
export type SealPurpose = 'meta' | 'profile' | `channel:${string}` | `message:${string}` | `signal:${string}`;

const aad = (communityId: string, purpose: SealPurpose): Buffer =>
  Buffer.from(`river-community-v1|${communityId}|${purpose}`, 'utf8');

export function newCommunityKey(): Buffer {
  return randomBytes(32);
}

export function seal(key: Uint8Array, communityId: string, purpose: SealPurpose, value: unknown): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(communityId, purpose));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString('base64');
}

/** Throws if the ciphertext was not made with this key for this community and purpose. */
export function open<T = unknown>(
  key: Uint8Array,
  communityId: string,
  purpose: SealPurpose,
  sealed: string,
): T {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < 12 + 16) throw new Error('sealed value too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(aad(communityId, purpose));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const pt = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
  return JSON.parse(pt.toString('utf8')) as T;
}

export function randomId(): string {
  return randomBytes(16).toString('base64url');
}

/** Invite links: https://server/join#c=<code>&k=<key>. The fragment never reaches a server. */
export function formatInvite(serverUrl: string, code: string, key: Uint8Array): string {
  return `${serverUrl}/join#c=${code}&k=${Buffer.from(key).toString('base64url')}`;
}

export function parseInvite(link: string): { serverUrl: string; code: string; key: Buffer } | null {
  try {
    const url = new URL(link.trim());
    if (!url.pathname.endsWith('/join')) return null;
    const params = new URLSearchParams(url.hash.slice(1));
    const code = params.get('c') ?? '';
    const key = Buffer.from(params.get('k') ?? '', 'base64url');
    if (!/^[A-Za-z0-9_-]{22}$/.test(code) || key.length !== 32) return null;
    const base = url.pathname.slice(0, -'/join'.length);
    return { serverUrl: `${url.origin}${base}`, code, key };
  } catch {
    return null;
  }
}
