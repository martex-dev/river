import { create } from 'zustand';
import type { CallView, ConversationView } from '../../../shared/dm.ts';
import { isMuted } from '../../../shared/notify-rules.ts';
import type { Settings } from '../../../shared/settings.ts';
import { callOutcome } from '../pages/CallsPage.tsx';

/**
 * The call history for the phone's Calls tab and its badge (2.12). The badge counts calls you
 * missed since you last opened the tab; when you last opened it is kept on this device.
 */

const SEEN_KEY = 'river.phone.callsSeenAt';

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

interface CallHistory {
  calls: CallView[] | null;
  /** When the Calls tab was last open (ISO time, '' = never). */
  seenAt: string;
  load(): Promise<void>;
  markSeen(): void;
}

let asked = 0;

export const useCallHistory = create<CallHistory>((set) => ({
  calls: null,
  seenAt: readSeen(),
  load: async () => {
    const n = ++asked;
    const r = await window.river.dm.action({ a: 'calls' });
    // An older answer arriving late never replaces a newer one.
    if (n === asked) set({ calls: r.ok ? r.value : [] });
  },
  markSeen: () => {
    const seenAt = new Date().toISOString();
    try {
      localStorage.setItem(SEEN_KEY, seenAt);
    } catch {
      // Private storage unavailable: the badge only resets for this session.
    }
    set({ seenAt });
  },
}));

/** Calls someone made to you that you did not answer, since `seenAt`. */
export function missedSince(calls: CallView[] | null, seenAt: string): number {
  return (calls ?? []).filter(
    (c) => c.direction === 'in' && callOutcome(c) === 'missed' && c.startedAt > seenAt,
  ).length;
}

/** The Chats badge: unread messages, not counting blocked or muted conversations. */
export function chatsBadge(
  conversations: ConversationView[],
  notifications: Settings['notifications'] | undefined,
): number {
  return conversations
    .filter((c) => c.state !== 'blocked' && !(notifications && isMuted(notifications, c.riverId)))
    .reduce((n, c) => n + c.unread, 0);
}
