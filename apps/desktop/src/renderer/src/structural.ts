/**
 * Structural sharing for state that main sends whole (every community, every conversation) on
 * each change: returns `next`, but with every part that equals the same part of `prev` replaced
 * by `prev`'s object. A presence change in a community of 1000 then gives one new member object
 * (and new objects on its path), and the other 999 rows, the other communities and the chat list
 * keep their identity, so memoised rows and store selectors skip them.
 *
 * Plain JSON-like data only (objects, arrays, primitives), which is what IPC delivers.
 */
export function shareEqual<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    let same = prev.length === next.length;
    let borrowed = false;
    const out = next.map((item: unknown, i) => {
      const shared = shareEqual(prev[i], item);
      if (shared !== prev[i]) same = false;
      if (shared !== item) borrowed = true;
      return shared;
    });
    // Nothing taken from prev: `next` itself (its parts may already be shared objects).
    return (same ? prev : borrowed ? out : next) as T;
  }
  if (isPlain(next)) {
    if (!isPlain(prev)) return next;
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    let borrowed = false;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const shared = shareEqual(prev[k], next[k]);
      if (shared !== prev[k] || !(k in prev)) same = false;
      if (shared !== next[k]) borrowed = true;
      out[k] = shared;
    }
    return (same ? prev : borrowed ? out : next) as T;
  }
  return next;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Shares array items by key (a list that was reordered keeps each item's identity). `share`
 * shares one item with its earlier version (default: shareEqual).
 */
export function shareByKey<T>(
  prev: readonly T[],
  next: T[],
  key: (item: T) => string,
  share: (old: T | undefined, item: T) => T = shareEqual,
): T[] {
  const old = new Map(prev.map((p) => [key(p), p]));
  const out = next.map((n) => share(old.get(key(n)), n));
  return out.length === prev.length && out.every((x, i) => x === prev[i]) ? (prev as T[]) : out;
}
