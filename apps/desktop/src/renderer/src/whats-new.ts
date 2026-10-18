/**
 * "What's new" after an update (1.0.40): a short list for the version you just
 * got, shown once. Fresh installs see nothing; full notes are in the release.
 */
export const HIGHLIGHTS: Record<string, string[]> = {
  '2.13.0': [
    'On phones, River now looks like a phone app: tabs at the bottom, a chat list, full-screen chats with bubbles',
    'Swipe a chat for quick actions; hold a message to react, reply or forward',
    'Computers keep their layout',
  ],
  '1.1.0': [
    'River for Android: the same River on your phone — download River-android.apk from the release page',
    'Phones join your communities and talk to computers directly, with the same encryption',
  ],
  '1.0.46': [
    'Specter’s skins: Neon, Aurora, Terminal, Paper, Synthwave, Blueprint, Brutal, Retro, Holo, Glitch and more',
    'Choose your look first — every skin has its own palettes',
  ],
  '1.0.45': [
    '14 skins and 107 themes — Cyberpunk, Glass, Luxury, Terminal, Corporate and more',
    'Settings → Appearance: try any theme on the whole app, then Apply or Cancel',
    'Change every colour, font, message style and layout, and save looks as profiles',
  ],
  '1.0.44': [
    'Group calls stay clear: tested with 16 people for an hour between Bulgaria and the USA',
    'Fixed: after a short reconnect, someone could stay in the call but go silent for others',
  ],
  '1.0.43': [
    'Hosting: a permanent, free address through Tailscale — calls and invites stop dropping',
    'Settings → Hosting shows the three steps; River switches over by itself',
  ],
  '1.0.42': [
    'A Discord-style layout: Home and your communities in one rail on the left',
    'Home has your friends, direct messages, Social, Calls and Files in one sidebar',
    'Settings opens over what you are doing, with everything in one list — Esc closes it',
  ],
  '1.0.41': [
    'Voice calls keep everyone in when the connection blips — tested with 10 people',
    'Invite links never go stale, and clicking one opens River ("Open in River")',
    'Opening an invite in a browser shows how to install River on any computer',
    'If your account is removed from the server, River offers to set it up again',
  ],
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
