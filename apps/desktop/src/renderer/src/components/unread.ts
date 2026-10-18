/**
 * Small pure helpers for message lists, shared by direct messages and channels (2.10.12).
 */

/**
 * How many messages from others arrived after `after` (the send time of the newest message when
 * you scrolled up; '' when there was none). Counting by time, not by position, keeps older
 * messages loaded above (a jump back, "Load older") from counting as new.
 */
export function newSince(messages: ReadonlyArray<{ mine: boolean; sentAt: string }>, after: string): number {
  let n = 0;
  for (const m of messages) if (!m.mine && m.sentAt > after) n++;
  return n;
}

/**
 * The newest messages as main sent them, plus what arrived live while that answer was on its way
 * (2.13.1): a message newer than the answer's newest that the answer does not have is kept, not
 * dropped until the conversation is opened again.
 */
export function withLiveMessages<T extends { id: string; sentAt: string }>(
  loaded: T[],
  current: readonly T[] | undefined,
): T[] {
  if (!current?.length) return loaded;
  const newest = loaded.at(-1)?.sentAt ?? '';
  const known = new Set(loaded.map((m) => m.id));
  const live = current.filter((m) => !known.has(m.id) && m.sentAt > newest);
  return live.length ? [...loaded, ...live] : loaded;
}

/** A date as YYYY-MM-DD in this device's time zone (what a date picker shows). */
export function localDay(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
