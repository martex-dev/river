import { looksLikeInvite, parseFriend, parseSignup } from '../shared/invite-link.ts';
import type { DeepLink } from '../shared/ipc.ts';

/** The scheme River registers with the operating system ("Open in River" on invite pages). */
export const DEEP_LINK_SCHEME = 'river';

/**
 * Reads a `river://open?link=<invite, friend or sign-up link>` URL, as the
 * invite web page builds it from the link the person clicked. Only the three
 * kinds of River link are accepted, and nothing happens without the person
 * confirming in the app ("Join this community?", "Add a friend?").
 */
export function parseDeepLink(raw: string): DeepLink | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  const link = url.searchParams.get('link')?.trim() ?? '';
  if (!link) return null;
  if (looksLikeInvite(link)) return { kind: 'invite', link };
  if (parseSignup(link)) return { kind: 'signup', link };
  const friend = parseFriend(link);
  if (friend?.serverUrl) return { kind: 'friend', link };
  return null;
}

/** The first River link among command-line arguments (Windows and Linux pass it that way). */
export function deepLinkInArgs(argv: readonly string[]): DeepLink | null {
  for (const arg of argv) {
    if (arg.startsWith(`${DEEP_LINK_SCHEME}:`)) {
      const parsed = parseDeepLink(arg);
      if (parsed) return parsed;
    }
  }
  return null;
}
