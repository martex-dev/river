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
  | 'onboarding'
  | 'art'
  | 'profile'
  | `channel:${string}`
  | `category:${string}`
  | `thread:${string}`
  | `message:${string}`
  | `signal:${string}`
  | `role:${string}`
  | `reaction:${string}`
  | `event:${string}`
  | `emoji:${string}`
  | `report:${string}`
  | `sound:${string}`
  | `note:${string}`
  | `sticker:${string}`
  | `webhook:${string}`
  | `epoch:${number}`
  | 'invite';

const aad = (communityId: string, purpose: SealPurpose): Buffer =>
  Buffer.from(`river-community-v1|${communityId}|${purpose}`, 'utf8');

/**
 * Associated data v2 (2.11) also binds a value to who and what it is: a message to its ID and
 * sender (`<messageId>|<senderRiverId>`), a profile to its member (`<riverId>`). The server can
 * then no longer show a message under another ID or sender, replay it as a new message, or give
 * one member's profile to another. Receivers open v2 first and fall back to v1.
 */
const aadV2 = (communityId: string, purpose: SealPurpose, binding: string): Buffer =>
  Buffer.from(`river-community-v2|${communityId}|${purpose}|${binding}`, 'utf8');

/**
 * Whether new messages and profiles are sealed with v2 associated data. Off until every
 * supported River opens v2 (receivers have since 2.11): older versions cannot read v2 values.
 * See CRYPTOGRAPHY.md §4a for the planned switch.
 */
export const SEAL_V2_DEFAULT = false;

/** What a message is bound to under v2. */
export const messageBinding = (messageId: string, sender: string): string => `${messageId}|${sender}`;

export function newCommunityKey(): Buffer {
  return randomBytes(32);
}

function sealWith(key: Uint8Array, associated: Buffer, value: unknown): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(associated);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString('base64');
}

function openWithAad<T>(key: Uint8Array, associated: Buffer, sealed: string): T {
  const raw = Buffer.from(sealed, 'base64');
  if (raw.length < 12 + 16) throw new Error('sealed value too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(associated);
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const pt = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
  return JSON.parse(pt.toString('utf8')) as T;
}

export function seal(key: Uint8Array, communityId: string, purpose: SealPurpose, value: unknown): string {
  return sealWith(key, aad(communityId, purpose), value);
}

/** Throws if the ciphertext was not made with this key for this community and purpose. */
export function open<T = unknown>(
  key: Uint8Array,
  communityId: string,
  purpose: SealPurpose,
  sealed: string,
): T {
  return openWithAad<T>(key, aad(communityId, purpose), sealed);
}

/** Seals with v2 associated data (bound to `binding`), or v1 when `v2` is false. */
export function sealBound(
  key: Uint8Array,
  communityId: string,
  purpose: SealPurpose,
  binding: string,
  value: unknown,
  v2: boolean,
): string {
  return v2
    ? sealWith(key, aadV2(communityId, purpose, binding), value)
    : seal(key, communityId, purpose, value);
}

/** Opens a v2 value bound to `binding`, else a v1 value (made before v2, or by older Rivers). */
export function openBound<T = unknown>(
  key: Uint8Array,
  communityId: string,
  purpose: SealPurpose,
  binding: string,
  sealed: string,
): { value: T; version: 1 | 2 } {
  try {
    return { value: openWithAad<T>(key, aadV2(communityId, purpose, binding), sealed), version: 2 };
  } catch {
    return { value: open<T>(key, communityId, purpose, sealed), version: 1 };
  }
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

  /** Like openWith, for values that may carry v2 associated data bound to `binding`. */
  openBoundWith<T = unknown>(
    communityId: string,
    purpose: SealPurpose,
    binding: string,
    sealed: string,
  ): { value: T; key: Buffer; epoch: number; version: 1 | 2 } {
    for (const { key, epoch } of this.entries) {
      try {
        return { ...openBound<T>(key, communityId, purpose, binding, sealed), key, epoch };
      } catch {
        // try an older key
      }
    }
    throw new Error('no key opens this value');
  }

  /** Epochs held, newest first. */
  epochs(): number[] {
    return this.entries.map((e) => e.epoch);
  }
}
