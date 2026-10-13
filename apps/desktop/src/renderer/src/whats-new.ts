/**
 * "What's new" after an update (1.0.40): a short list for the version you just
 * got, shown once. Fresh installs see nothing; full notes are in the release.
 */
export const HIGHLIGHTS: Record<string, string[]> = {
  '1.0.40': [
    'Webhooks that stay end-to-end encrypted — services post, the server still reads nothing',
    'Priority speaker, moving people between voice channels, and a quick way back into a call',
    'Temporary roles, drag to reorder roles, and role changes for many members at once',
    'Invite tracking, a word filter and warnings before suspicious links',
    'Community pictures and banners, animated avatars, pins in direct messages',
    'Screen readers hear new messages; reduced motion keeps animated pictures still',
  ],
};

const KEY = 'river.lastSeenVersion';

/** The highlights to show now, or null (pure, for tests). */
export function whatsNew(current: string, lastSeen: string | null): string[] | null {
  if (!lastSeen || lastSeen === current) return null;
  return HIGHLIGHTS[current] ?? null;
}

export function readLastSeen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function markSeen(version: string): void {
  try {
    localStorage.setItem(KEY, version);
  } catch {
    // storage unavailable: the card may show again
  }
}
