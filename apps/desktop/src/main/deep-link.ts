import { looksLikeInvite, parseCallLink, parseFriend, parseSignup } from '../shared/invite-link.ts';
import type { DeepLink } from '../shared/ipc.ts';

/** The scheme River registers with the operating system ("Open in River" on invite pages). */
export const DEEP_LINK_SCHEME = 'river';

/**
 * Reads a `river://open?link=<invite, friend or sign-up link>` URL, as the
 * invite web page builds it from the link the person clicked. Only the three
 * kinds of River link (and call links) are accepted, and nothing happens without the person
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
  // A device link code (QR code or "copy link" in Settings → Devices). It only fills in the
  // code on the "link this device" screen; the person still confirms on both devices.
  if (url.hostname === 'link') {
    const server = url.searchParams.get('s') ?? '';
    const code = url.searchParams.get('c') ?? '';
    if (!/^https?:\/\//.test(server) || !/^[0-9A-Za-z-]{16,24}$/.test(code)) return null;
    return { kind: 'device', link: raw.trim() };
  }
  const link = url.searchParams.get('link')?.trim() ?? '';
  if (!link) return null;
  if (looksLikeInvite(link)) return { kind: 'invite', link };
  if (parseSignup(link)) return { kind: 'signup', link };
  // A call link (2.18): opens "Ask to join"; nothing is sent until the person asks.
  if (parseCallLink(link)) return { kind: 'call', link };
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
