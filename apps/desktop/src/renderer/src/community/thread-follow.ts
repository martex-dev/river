/**
 * Followed threads (1.0.25): you hear about new replies in threads you
 * follow. Threads you start or reply in are followed for you. Thread IDs
 * only, kept on this device.
 */
const KEY = 'river.followedThreads';
const MAX = 500;

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(-MAX) : [];
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    // not remembered
  }
}

export const isFollowing = (threadId: string): boolean => read().includes(threadId);

export function setFollowing(threadId: string, on: boolean): void {
  const list = read().filter((x) => x !== threadId);
  write(on ? [...list, threadId] : list);
}

/** Should a new reply in this thread alert you? Not your own, not while you read it. */
export function alertForReply(threadId: string, mine: boolean, viewing: boolean): boolean {
  return !mine && !viewing && isFollowing(threadId);
}
