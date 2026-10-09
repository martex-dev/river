import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Community content encryption: AES-256-GCM with a random 96-bit nonce under
 * the 32-byte community key. The associated data binds each ciphertext to its
 * community and purpose (e.g. a message to its channel), so the server cannot
 * move ciphertext between communities, channels or fields.
 * Format: base64(nonce ‖ ciphertext ‖ tag).
 */
export type SealPurpose =
  | 'meta'
  | 'profile'
  | `channel:${string}`
  | `category:${string}`
  | `message:${string}`
  | `signal:${string}`
  | `role:${string}`
  | `reaction:${string}`
  | 'invite';

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

/**
 * Lets the server group identical reactions without learning the emoji:
 * HMAC-SHA256 under a key derived (HKDF) from the community key, over the
 * message ID and emoji, truncated to 128 bits.
 */
export function reactionTag(key: Uint8Array, communityId: string, messageId: string, emoji: string): string {
  const tagKey = Buffer.from(
    hkdfSync('sha256', key, Buffer.alloc(0), `river-reaction-tag-v1|${communityId}`, 32),
  );
  return createHmac('sha256', tagKey)
    .update(`${messageId}|${emoji}`)
    .digest()
    .subarray(0, 16)
    .toString('hex');
}

export function randomId(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Invite links: https://server/join#c=<code>&k=<key>&e=<epoch>. The fragment
 * never reaches a server. Links from before key epochs have no `e` (epoch 0).
 */
export function formatInvite(serverUrl: string, code: string, key: Uint8Array, epoch = 0): string {
  const base = `${serverUrl}/join#c=${code}&k=${Buffer.from(key).toString('base64url')}`;
  return epoch ? `${base}&e=${epoch}` : base;
}

export function parseInvite(
  link: string,
): { serverUrl: string; code: string; key: Buffer; epoch: number } | null {
  try {
    const url = new URL(link.trim());
    if (!url.pathname.endsWith('/join')) return null;
    const params = new URLSearchParams(url.hash.slice(1));
    const code = params.get('c') ?? '';
    const key = Buffer.from(params.get('k') ?? '', 'base64url');
    const epoch = Number(params.get('e') ?? '0');
    if (!Number.isInteger(epoch) || epoch < 0 || epoch > 1_000_000) return null;
    if (!/^[A-Za-z0-9_-]{22}$/.test(code) || key.length !== 32) return null;
    const base = url.pathname.slice(0, -'/join'.length);
    return { serverUrl: `${url.origin}${base}`, code, key, epoch };
  } catch {
    return null;
  }
}

/**
 * All keys a member holds for one community, newest first. New content is
 * sealed with the newest key; anything can be opened with whichever key made it.
 */
export class KeyRing {
  private readonly entries: Array<{ epoch: number; key: Buffer }>;

  constructor(entries: Array<{ epoch: number; key: Buffer }>) {
    this.entries = [...entries].sort((a, b) => b.epoch - a.epoch);
  }

  get newest(): { epoch: number; key: Buffer } {
    return this.entries[0]!;
  }

  has(epoch: number): boolean {
    return this.entries.some((e) => e.epoch === epoch);
  }

  keyFor(epoch: number): Buffer | null {
    return this.entries.find((e) => e.epoch === epoch)?.key ?? null;
  }

  /** Opens with whichever key sealed the value; also says which key that was. */
  openWith<T = unknown>(
    communityId: string,
    purpose: SealPurpose,
    sealed: string,
  ): { value: T; key: Buffer } {
    for (const { key } of this.entries) {
      try {
        return { value: open<T>(key, communityId, purpose, sealed), key };
      } catch {
        // try an older key
      }
    }
    throw new Error('no key opens this value');
  }

  open<T = unknown>(communityId: string, purpose: SealPurpose, sealed: string): T {
    return this.openWith<T>(communityId, purpose, sealed).value;
  }
}
