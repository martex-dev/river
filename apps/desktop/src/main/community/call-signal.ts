import { verify } from '@river/crypto';

/**
 * Identity-bound call signals (CRYPTOGRAPHY.md §8).
 *
 * Community call setup (SDP with DTLS fingerprints, ICE candidates, relay keys)
 * is sealed with the community key, which every member holds. On its own that
 * would let the server, together with any member, forge setup "from" someone
 * else. So each signal is also signed with the sender's identity key (XEdDSA),
 * over the community, channel, sender, recipient and time, and checked against
 * the identity key libsignal already holds for that person (from direct
 * messages, verified with safety numbers). For such people a valid, fresh
 * signature is required. For people River has no such key for yet, call setup
 * stays protected by the community key only, as before — River does not trust
 * the key in a community profile for this, because a profile is not bound to
 * the person it describes.
 */

const CONTEXT = 'river-call-signal-v1';
/** Signals older or newer than this are refused (replays; clocks may differ a little). */
export const SIGNAL_MAX_AGE_MS = 10 * 60_000;

/** What travels inside the sealed signal. */
export interface SignedSignal {
  v: 1;
  /** The signal payload as JSON (signed exactly as sent). */
  j: string;
  /** When it was signed (ms since the epoch). */
  t: number;
  /** XEdDSA signature (base64) by the sender's identity key. */
  s: string;
}

export interface SignalRoute {
  communityId: string;
  channelId: string;
  from: string;
  to: string;
}

export function signalMessage(route: SignalRoute, at: number, json: string): Uint8Array {
  return Buffer.from(
    [CONTEXT, route.communityId, route.channelId, route.from, route.to, String(at), json].join('\n'),
    'utf8',
  );
}

export function signSignal(
  route: SignalRoute,
  payload: unknown,
  sign: (message: Uint8Array) => Uint8Array,
  now = Date.now(),
): SignedSignal {
  const j = JSON.stringify(payload);
  return { v: 1, j, t: now, s: Buffer.from(sign(signalMessage(route, now, j))).toString('base64') };
}

function isSigned(data: unknown): data is SignedSignal {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.v === 1 && typeof d.j === 'string' && typeof d.s === 'string' && Number.isSafeInteger(d.t);
}

/** Where the receiver finds the key it trusts for a person. */
export interface SignalKeys {
  /** The identity key libsignal holds for this person (from direct messages), if any. */
  sessionKey(riverId: string): Uint8Array | null;
}

export type OpenedSignal =
  | { ok: true; payload: unknown; identityBound: boolean }
  | { ok: false; reason: 'bad-signature' | 'unsigned' | 'stale' };

/**
 * Checks a signal that already passed the community-key seal.
 *
 * - From someone River holds an identity key for: it must be signed by that
 *   key, for this community, channel, sender and recipient, within
 *   SIGNAL_MAX_AGE_MS. Unsigned (stripped) or stale signals are refused.
 * - From anyone else: accepted on the community key alone (identityBound false).
 */
export function openSignal(
  route: SignalRoute,
  data: unknown,
  keys: SignalKeys,
  now = Date.now(),
): OpenedSignal {
  const trusted = keys.sessionKey(route.from);
  if (!isSigned(data)) {
    return trusted ? { ok: false, reason: 'unsigned' } : { ok: true, payload: data, identityBound: false };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(data.j);
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  if (!trusted) return { ok: true, payload, identityBound: false };
  if (Math.abs(now - data.t) > SIGNAL_MAX_AGE_MS) return { ok: false, reason: 'stale' };
  const signature = Buffer.from(data.s, 'base64');
  if (!verify(trusted, signalMessage(route, data.t, data.j), signature)) {
    return { ok: false, reason: 'bad-signature' };
  }
  return { ok: true, payload, identityBound: true };
}
