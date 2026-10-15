import { verify } from '@river/crypto';

/**
 * Identity-bound call signals (1.5.0, CRYPTOGRAPHY.md §8).
 *
 * Community call setup (SDP with DTLS fingerprints, ICE candidates, relay keys)
 * is sealed with the community key, which every member holds. On its own that
 * would let the server, together with any member, forge setup "from" someone
 * else. So each signal is also signed with the sender's identity key (XEdDSA),
 * over the community, channel, sender and recipient, and the recipient checks
 * it against the key it already trusts for that person.
 */

const CONTEXT = 'river-call-signal-v1';

/** What travels inside the sealed signal. */
export interface SignedSignal {
  v: 1;
  /** The signal payload as JSON (signed exactly as sent). */
  j: string;
  /** XEdDSA signature (base64) by the sender's identity key. */
  s: string;
}

export interface SignalRoute {
  communityId: string;
  channelId: string;
  from: string;
  to: string;
}

export function signalMessage(route: SignalRoute, json: string): Uint8Array {
  return Buffer.from(
    [CONTEXT, route.communityId, route.channelId, route.from, route.to, json].join('\n'),
    'utf8',
  );
}

export function signSignal(
  route: SignalRoute,
  payload: unknown,
  sign: (message: Uint8Array) => Uint8Array,
): SignedSignal {
  const j = JSON.stringify(payload);
  return { v: 1, j, s: Buffer.from(sign(signalMessage(route, j))).toString('base64') };
}

function isSigned(data: unknown): data is SignedSignal {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.v === 1 && typeof d.j === 'string' && typeof d.s === 'string';
}

/** Where the receiver finds the keys it trusts. */
export interface SignalKeys {
  /** The key libsignal holds for this person (from direct messages), if any. */
  sessionKey(riverId: string): Uint8Array | null;
  /** The key pinned the first time this person sent a signed signal. */
  pinned(riverId: string): Uint8Array | null;
  pin(riverId: string, key: Uint8Array): void;
  /** The key the person published in a shared community profile. */
  profileKey(riverId: string): Uint8Array | null;
}

export type OpenedSignal =
  { ok: true; payload: unknown; signed: boolean } | { ok: false; reason: 'bad-signature' | 'unsigned' };

/**
 * Checks a signal that already passed the community-key seal.
 *
 * - Signed: verified against the libsignal key for the sender, else the key
 *   pinned on their first signed signal, else (first time) their community
 *   profile key, which is then pinned. With no key known at all it counts as
 *   unsigned.
 * - Unsigned: only from someone who has never sent a signed signal — River
 *   before 1.5. Once a person has signed, unsigned signals from them are
 *   refused, so the protection cannot be stripped.
 */
export function openSignal(route: SignalRoute, data: unknown, keys: SignalKeys): OpenedSignal {
  if (!isSigned(data)) {
    if (keys.pinned(route.from)) return { ok: false, reason: 'unsigned' };
    return { ok: true, payload: data, signed: false };
  }
  const signature = Buffer.from(data.s, 'base64');
  const message = signalMessage(route, data.j);
  const known = keys.sessionKey(route.from) ?? keys.pinned(route.from);
  const key = known ?? keys.profileKey(route.from);
  let payload: unknown;
  try {
    payload = JSON.parse(data.j);
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  // No key to check against yet (an old profile without one): no stronger than an unsigned
  // signal, so it is treated as one, and nothing is pinned.
  if (!key) return { ok: true, payload, signed: false };
  if (!verify(key, message, signature)) return { ok: false, reason: 'bad-signature' };
  if (!keys.pinned(route.from)) keys.pin(route.from, key);
  return { ok: true, payload, signed: true };
}
