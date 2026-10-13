/**
 * A community's word filter (1.0.28). The server cannot read messages, so it
 * cannot filter them: every River app applies the filter itself — the
 * sender's app refuses blocked words (when set to block) and readers' apps
 * fold away messages that contain them. A modified app could ignore it;
 * moderators still see everything.
 */
export type FilterMode = 'hide' | 'block';

export interface WordFilter {
  words: string[];
  mode: FilterMode;
}

export const MAX_FILTER_WORDS = 200;

/** Lower case, accents removed, common look-alike characters folded, so "Spâm" and "sp4m" match "spam". */
export function normalize(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[@4]/g, 'a')
      .replace(/3/g, 'e')
      .replace(/1/g, 'i')
      // ! and | only stand for i inside a word ("sp!t"), not as punctuation ("spam!").
      .replace(/[!|](?=\p{L})/gu, 'i')
      .replace(/0/g, 'o')
      .replace(/5/g, 's')
      .replace(/\$(?=\p{L})/gu, 's')
      .replace(/7/g, 't')
  );
}

/** Cleans a list typed by a moderator: one word or phrase per line or comma, no duplicates. */
export function parseWords(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const w = part.trim().slice(0, 60);
    if (w && !out.some((x) => normalize(x) === normalize(w))) out.push(w);
    if (out.length >= MAX_FILTER_WORDS) break;
  }
  return out;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The first filtered word or phrase in a message (whole words only), or null. */
export function findFiltered(text: string, words: string[]): string | null {
  if (!words.length || !text) return null;
  const hay = normalize(text);
  for (const w of words) {
    const needle = normalize(w).trim();
    if (!needle) continue;
    // Whole words: not part of a longer word ("ass" does not match "class").
    const re = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escape(needle).replace(/\s+/g, '\\s+')}(?=$|[^\\p{L}\\p{N}])`,
      'u',
    );
    if (re.test(hay)) return w;
  }
  return null;
}

export function readFilter(raw: unknown): WordFilter | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { words?: unknown; mode?: unknown };
  const words = Array.isArray(r.words)
    ? r.words
        .filter((w): w is string => typeof w === 'string')
        .map((w) => w.slice(0, 60))
        .slice(0, MAX_FILTER_WORDS)
    : [];
  if (!words.length) return null;
  return { words, mode: r.mode === 'block' ? 'block' : 'hide' };
}
