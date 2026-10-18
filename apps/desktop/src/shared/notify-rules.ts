import type { NotifySound } from './notify-sounds.ts';
import type { Settings } from './settings.ts';

/**
 * Per-community and per-channel notification settings (1.0.18), like
 * Discord: mute for a while or for good, and choose All messages / Only
 * @mentions / Nothing. Kept on this device in settings.json.
 *
 * Rules: a channel setting beats its category's (2.10.13), which beats its community's, which
 * beats the global one.
 * Muting silences ordinary messages (no notification, no sound, no unread dot)
 * but @mentions still reach you unless the level is Nothing.
 *
 * 2.17: the same for each chat (a person or a group), a sound of your own per chat, channel or
 * community, and a community may say that @everyone and @here do not count as mentioning you.
 */
export type NotifyLevel = 'all' | 'mentions' | 'nothing';
export type Override = Settings['notifications']['overrides'][string];

/**
 * How a message mentions you: by name, through one of your roles, or by replying to you
 * ("direct"), or only through @everyone or @here ("everyone").
 */
export type MentionKind = 'direct' | 'everyone';

/** Muted "until I turn it back on". */
export const FOREVER = '9999-12-31T00:00:00.000Z';

export interface Effective {
  level: NotifyLevel;
  muted: boolean;
  /** The sound chosen nearest to the message (channel, category, community), or "default". */
  sound: NotifySound;
  /** @everyone and @here do not count as mentioning you here. */
  suppressEveryone: boolean;
}

function mutedNow(o: Override | undefined, now: number): boolean {
  return !!o?.muteUntil && Date.parse(o.muteUntil) > now;
}

export function effectiveNotify(
  prefs: Settings['notifications'],
  communityId: string | null,
  channelId: string | null,
  now = Date.now(),
  categoryId: string | null = null,
): Effective {
  const ch = channelId ? prefs.overrides[channelId] : undefined;
  const ca = categoryId ? prefs.overrides[categoryId] : undefined;
  const co = communityId ? prefs.overrides[communityId] : undefined;
  const chosen = [ch, ca, co].find((o) => o && o.level !== 'default')?.level;
  const level: NotifyLevel = chosen && chosen !== 'default' ? chosen : prefs.mode;
  return {
    level,
    muted: [ch, ca, co].some((o) => mutedNow(o, now)),
    sound: [ch, ca, co].find((o) => o?.sound && o.sound !== 'default')?.sound ?? 'default',
    suppressEveryone: [ch, ca, co].some((o) => o?.suppressEveryone === true),
  };
}

/**
 * A chat's settings (2.17): a person's or a group's own override. Chats are personal, so they
 * notify for every message unless you chose otherwise (the global "only mentions" is for
 * communities).
 */
export function conversationNotify(
  prefs: Settings['notifications'],
  conversation: string,
  now = Date.now(),
): Effective {
  const o = prefs.overrides[conversation];
  return {
    level: o && o.level !== 'default' ? o.level : 'all',
    muted: mutedNow(o, now),
    sound: o?.sound ?? 'default',
    suppressEveryone: o?.suppressEveryone === true,
  };
}

/**
 * Whether a message mentions you, after "suppress @everyone and @here": a mention only through
 * @everyone or @here does not count there. Replies to you and your name always do.
 */
export function mentionsYou(
  e: Pick<Effective, 'suppressEveryone'>,
  m: { mentionsMe?: boolean; mentionKind?: MentionKind | null },
): boolean {
  if (!m.mentionsMe) return false;
  return !(e.suppressEveryone && m.mentionKind === 'everyone');
}

/**
 * Whether `text` mentions you by one of your names, or everyone (@everyone, @here). Used for
 * groups, where everyone may mention everyone; communities check roles and permissions too.
 */
export function textMention(text: string, names: Array<string | null | undefined>): MentionKind | null {
  const lower = text.toLowerCase();
  for (const name of names) {
    const n = name?.trim().toLowerCase();
    if (n && lower.includes(`@${n}`)) return 'direct';
  }
  return /(^|\s)@(everyone|here)\b/.test(lower) ? 'everyone' : null;
}

/** Whether an @mention should count on the badge: everywhere except where the level is Nothing. */
export function countsMention(e: Effective): boolean {
  return e.level !== 'nothing';
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
  // Defaults are not written down.
  if (!merged.sound || merged.sound === 'default') delete merged.sound;
  if (!merged.suppressEveryone) delete merged.suppressEveryone;
  if (merged.level === 'default' && !merged.muteUntil && !merged.sound && !merged.suppressEveryone)
    delete next[id];
  else next[id] = merged;
  return next;
}

export const MUTE_CHOICES: Array<{ label: string; ms: number | null }> = [
  { label: 'For 15 minutes', ms: 15 * 60_000 },
  { label: 'For 1 hour', ms: 3600_000 },
  { label: 'For 8 hours', ms: 8 * 3600_000 },
  { label: 'For 1 day', ms: 24 * 3600_000 },
  { label: 'For 1 week', ms: 7 * 24 * 3600_000 },
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
