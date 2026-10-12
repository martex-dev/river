import type { Settings } from './settings.ts';

/**
 * Per-community and per-channel notification settings (1.0.18), like
 * Discord: mute for a while or for good, and choose All messages / Only
 * @mentions / Nothing. Kept on this device in settings.json.
 *
 * Rules: a channel setting beats its community's, which beats the global one.
 * Muting silences ordinary messages (no notification, no sound, no unread dot)
 * but @mentions still reach you unless the level is Nothing.
 */
export type NotifyLevel = 'all' | 'mentions' | 'nothing';
export type Override = Settings['notifications']['overrides'][string];

/** Muted "until I turn it back on". */
export const FOREVER = '9999-12-31T00:00:00.000Z';

export interface Effective {
  level: NotifyLevel;
  muted: boolean;
}

function mutedNow(o: Override | undefined, now: number): boolean {
  return !!o?.muteUntil && Date.parse(o.muteUntil) > now;
}

export function effectiveNotify(
  prefs: Settings['notifications'],
  communityId: string | null,
  channelId: string | null,
  now = Date.now(),
): Effective {
  const ch = channelId ? prefs.overrides[channelId] : undefined;
  const co = communityId ? prefs.overrides[communityId] : undefined;
  const level: NotifyLevel =
    ch && ch.level !== 'default' ? ch.level : co && co.level !== 'default' ? co.level : prefs.mode;
  return { level, muted: mutedNow(ch, now) || mutedNow(co, now) };
}

/** Whether a new message should notify and make a sound. */
export function shouldAlert(e: Effective, mentionsMe: boolean): boolean {
  if (e.level === 'nothing') return false;
  if (mentionsMe) return true;
  return !e.muted && e.level === 'all';
}

/** Whether a channel or community counts as muted right now (for dimming and unread dots). */
export function isMuted(prefs: Settings['notifications'], id: string, now = Date.now()): boolean {
  return mutedNow(prefs.overrides[id], now);
}

/** A copy of the overrides with one entry changed (default and unmuted entries are dropped). */
export function withOverride(
  overrides: Settings['notifications']['overrides'],
  id: string,
  patch: Partial<Override>,
  now = Date.now(),
): Settings['notifications']['overrides'] {
  const next = { ...overrides };
  const merged: Override = { level: 'default', muteUntil: null, ...overrides[id], ...patch };
  if (merged.muteUntil && Date.parse(merged.muteUntil) <= now) merged.muteUntil = null;
  if (merged.level === 'default' && !merged.muteUntil) delete next[id];
  else next[id] = merged;
  return next;
}

export const MUTE_CHOICES: Array<{ label: string; ms: number | null }> = [
  { label: 'For 15 minutes', ms: 15 * 60_000 },
  { label: 'For 1 hour', ms: 3600_000 },
  { label: 'For 8 hours', ms: 8 * 3600_000 },
  { label: 'For 24 hours', ms: 24 * 3600_000 },
  { label: 'Until I turn it back on', ms: null },
];

export function muteUntil(ms: number | null, now = Date.now()): string {
  return ms === null ? FOREVER : new Date(now + ms).toISOString();
}

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Inside the quiet hours right now (local time)? A range may cross midnight (22:00–08:00). */
export function inQuietHours(q: Settings['notifications']['quietHours'], now = new Date()): boolean {
  if (!q.enabled) return false;
  const start = minutes(q.start);
  const end = minutes(q.end);
  if (start === end) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/** Do Not Disturb or quiet hours: no pop-ups and no notification sounds. */
export function silenced(s: Pick<Settings, 'notifications' | 'presence'>, now = new Date()): boolean {
  return s.presence.status === 'dnd' || inQuietHours(s.notifications.quietHours, now);
}

/** People (not you) whose reactions are on `next` but were not on `prev` (1.0.23). */
export function newReactions(
  prev: Array<{ emoji: string; users: string[] }>,
  next: Array<{ emoji: string; users: string[] }>,
  me: string,
): Array<{ emoji: string; user: string }> {
  const out: Array<{ emoji: string; user: string }> = [];
  for (const r of next) {
    const before = new Set(prev.find((p) => p.emoji === r.emoji)?.users ?? []);
    for (const user of r.users) if (user !== me && !before.has(user)) out.push({ emoji: r.emoji, user });
  }
  return out;
}
