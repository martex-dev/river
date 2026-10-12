import { useEffect, useState } from 'react';

/**
 * Every Unicode emoji with its name, keywords and :shortcodes: (from the
 * bundled emojibase data, MIT; loaded the first time a picker or :shortcode:
 * is used, never fetched from the internet). Recently used emoji are kept on
 * this device only.
 */
export interface EmojiEntry {
  emoji: string;
  label: string;
  tags: string[];
  shortcodes: string[];
  group: number;
}

export interface EmojiIndex {
  all: EmojiEntry[];
  groups: Array<{ name: string; icon: string; items: EmojiEntry[] }>;
}

const GROUP_NAMES = [
  'Smileys & emotion',
  'People & body',
  'Components',
  'Animals & nature',
  'Food & drink',
  'Travel & places',
  'Activities',
  'Objects',
  'Symbols',
  'Flags',
];

let loading: Promise<EmojiIndex> | null = null;
let loaded: EmojiIndex | null = null;

export function buildIndex(
  data: Array<{
    unicode: string;
    label: string;
    tags?: string[];
    group?: number;
    hexcode: string;
    order?: number;
  }>,
  shortcodes: Record<string, string | string[]>,
): EmojiIndex {
  const all: EmojiEntry[] = data
    .filter((d) => d.group !== undefined && d.group !== 2)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((d) => {
      const sc = shortcodes[d.hexcode];
      return {
        emoji: d.unicode,
        label: d.label,
        tags: d.tags ?? [],
        shortcodes: sc === undefined ? [] : Array.isArray(sc) ? sc : [sc],
        group: d.group!,
      };
    });
  const groups = GROUP_NAMES.map((name, g) => ({
    name,
    items: all.filter((e) => e.group === g),
  }))
    .filter((g) => g.items.length > 0)
    .map((g) => ({ ...g, icon: g.items[0]!.emoji }));
  return { all, groups };
}

export function loadEmoji(): Promise<EmojiIndex> {
  loading ??= Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/shortcodes/github.json'),
  ]).then(([data, codes]) => {
    loaded = buildIndex(
      (data as { default: Parameters<typeof buildIndex>[0] }).default,
      (codes as { default: Record<string, string | string[]> }).default,
    );
    return loaded;
  });
  return loading;
}

/** The emoji index once loaded (starts loading on first use, or once `wanted` turns true). */
export function useEmojiIndex(wanted = true): EmojiIndex | null {
  const [index, setIndex] = useState<EmojiIndex | null>(loaded);
  useEffect(() => {
    if (index || !wanted) return;
    let alive = true;
    void loadEmoji().then((i) => alive && setIndex(i));
    return () => {
      alive = false;
    };
  }, [index, wanted]);
  return index;
}

/**
 * Turns :shortcodes: into emoji when a message is sent (outside code), like
 * Discord. Unknown codes are left as typed.
 */
export function replaceShortcodes(text: string, index: EmojiIndex): string {
  const byCode = new Map<string, string>();
  for (const e of index.all) for (const c of e.shortcodes) if (!byCode.has(c)) byCode.set(c, e.emoji);
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part) =>
      part.startsWith('`')
        ? part
        : part.replace(/:([a-z0-9_+-]{2,32}):/gi, (m, c: string) => byCode.get(c.toLowerCase()) ?? m),
    )
    .join('');
}

/** Best matches for a search: exact shortcode, shortcode prefix, name words, then keywords. */
export function searchEmoji(index: EmojiIndex, query: string, limit = 60): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/^:|:$/g, '');
  if (!q) return [];
  const scored: Array<[number, EmojiEntry]> = [];
  for (const e of index.all) {
    let score = -1;
    if (e.shortcodes.includes(q)) score = 0;
    else if (e.shortcodes.some((s) => s.startsWith(q))) score = 1;
    else if (
      e.label
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(q))
    )
      score = 2;
    else if (e.tags.some((t) => t.startsWith(q))) score = 3;
    else if (e.label.toLowerCase().includes(q)) score = 4;
    if (score >= 0) scored.push([score, e]);
  }
  return scored
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, e]) => e);
}

const RECENT_KEY = 'river.emoji.recent';
const RECENT_MAX = 24;

export function recentEmoji(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): void {
  try {
    const next = [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // private storage unavailable: no recents
  }
}

const FAVORITES_KEY = 'river.emoji.favorites';
const FAVORITES_MAX = 60;

/** Favourite emoji (1.0.20), on this device; right-click one in the picker to add or remove it. */
export function favoriteEmoji(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, FAVORITES_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Adds or removes a favourite and returns the new list. */
export function toggleFavoriteEmoji(emoji: string): string[] {
  const current = favoriteEmoji();
  const next = current.includes(emoji)
    ? current.filter((e) => e !== emoji)
    : [...current, emoji].slice(0, FAVORITES_MAX);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // private storage unavailable: favourites last until the picker closes
  }
  return next;
}

/** Turns :name: into the community's own emoji (<:name:id>) when sent, outside code (1.0.19). */
export function replaceCustomShortcodes(text: string, custom: Array<{ id: string; name: string }>): string {
  if (custom.length === 0) return text;
  const byName = new Map(custom.map((e) => [e.name.toLowerCase(), e]));
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`|<a?:[A-Za-z0-9_]{2,32}:[A-Za-z0-9_-]{22}>)/g)
    .map((part) =>
      part.startsWith('`') || part.startsWith('<')
        ? part
        : part.replace(/:([A-Za-z0-9_]{2,32}):/g, (m, name: string) => {
            const e = byName.get(name.toLowerCase());
            return e ? `<:${e.name}:${e.id}>` : m;
          }),
    )
    .join('');
}
