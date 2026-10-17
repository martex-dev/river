import { useSyncExternalStore } from 'react';

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

/** Who wants to hear when the followed threads change (the Follow button). */
const listeners = new Set<() => void>();

/** Subscribes to changes in which threads are followed; returns the unsubscribe. */
export function subscribeFollowing(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setFollowing(threadId: string, on: boolean): void {
  const list = read().filter((x) => x !== threadId);
  write(on ? [...list, threadId] : list);
  for (const l of listeners) l();
}

/** Whether a thread is followed, kept current when it changes anywhere (e.g. after you reply). */
export function useFollowing(threadId: string): boolean {
  return useSyncExternalStore(
    subscribeFollowing,
    () => isFollowing(threadId),
    () => false,
  );
}

/** Should a new reply in this thread alert you? Not your own, not while you read it. */
export function alertForReply(threadId: string, mine: boolean, viewing: boolean): boolean {
  return !mine && !viewing && isFollowing(threadId);
}
