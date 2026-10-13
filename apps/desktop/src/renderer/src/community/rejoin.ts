/**
 * "Rejoin call" (1.0.34): River remembers the voice channel you are in, so if
 * the app closes, crashes or loses the call without you pressing Disconnect,
 * it offers to put you back. Leaving on purpose forgets it.
 */
const KEY = 'river.lastCall';
/** Offer to rejoin only a call you were in recently. */
export const REJOIN_WITHIN_MS = 2 * 60 * 60 * 1000;

export interface LastCall {
  channelId: string;
  at: number;
}

export function rememberCall(channelId: string, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ channelId, at: now }));
  } catch {
    // storage unavailable: no rejoin offer
  }
}

export function forgetCall(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function lastCall(now = Date.now()): LastCall | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LastCall> | null;
    if (!v || typeof v.channelId !== 'string' || typeof v.at !== 'number') return null;
    if (v.channelId.startsWith('dm:') || now - v.at > REJOIN_WITHIN_MS || v.at > now) return null;
    return { channelId: v.channelId, at: v.at };
  } catch {
    return null;
  }
}
