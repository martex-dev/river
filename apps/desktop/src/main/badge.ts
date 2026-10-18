import type { ConversationView, DmEvent } from '../shared/dm.ts';
import type { CommunityEvent } from '../shared/ipc.ts';
import { conversationNotify, countsMention, effectiveNotify, mentionsYou } from '../shared/notify-rules.ts';
import type { Settings } from '../shared/settings.ts';

/**
 * The unread count on River's icon (2.17): the taskbar's overlay on Windows, the dock on macOS,
 * the launcher on Linux, the app icon on the iPhone. Like River's window title: unread direct
 * messages and groups plus @mentions in communities — never muted chats, chats or channels set
 * to Nothing, or blocked people. Android's launcher counts River's notifications by itself.
 */
export function badgeCount(
  prefs: Settings['notifications'],
  conversations: ConversationView[],
  mentions: ReadonlyMap<string, number>,
  now = Date.now(),
): number {
  if (!prefs.badge) return 0;
  let n = 0;
  for (const c of conversations) {
    if (c.state === 'blocked' || c.unread <= 0) continue;
    const e = conversationNotify(prefs, c.riverId, now);
    if (e.muted || e.level === 'nothing') continue;
    n += c.unread;
  }
  for (const count of mentions.values()) n += count;
  return n;
}

/** What the badge needs to know about a channel: its community and category (for its settings). */
export interface ChannelPlace {
  communityId: string;
  categoryId: string | null;
}

/**
 * Keeps the badge up to date: `set` gets the count whenever it changes. Mentions are counted as
 * they arrive (and from catching up), and forgotten when their channel is read on this device.
 */
export function startBadge(deps: {
  dm: { onEvent(listener: (e: DmEvent) => void): () => void };
  community: {
    onEvent(listener: (e: CommunityEvent) => void): () => void;
    channelParent?(channelId: string): string | null;
  };
  settings: () => Pick<Settings, 'notifications'>;
  /** Settings changed (a chat muted, the badge turned off): counted again. */
  onSettingsChange?: (listener: () => void) => unknown;
  set: (count: number) => void;
  /** The chats as they are now, when the badge starts. */
  conversations?: () => ConversationView[];
}): () => void {
  let conversations: ConversationView[] = [];
  const mentions = new Map<string, number>();
  /** Which community each channel with mentions is in (catching up reports channels only). */
  const places = new Map<string, ChannelPlace>();
  let last = -1;
  const update = (): void => {
    const prefs = deps.settings().notifications;
    // A channel set to Nothing (now) no longer counts.
    for (const [channel, place] of places) {
      const e = effectiveNotify(prefs, place.communityId, channel, Date.now(), place.categoryId);
      if (!countsMention(e)) mentions.delete(channel);
    }
    const n = badgeCount(prefs, conversations, mentions);
    if (n === last) return;
    last = n;
    deps.set(n);
  };
  const offDm = deps.dm.onEvent((e) => {
    if (e.t !== 'conversations') return;
    conversations = e.conversations;
    update();
  });
  const offCommunity = deps.community.onEvent((e) => {
    switch (e.t) {
      case 'message': {
        const m = e.message;
        if (!e.isNew || m.mine || m.threadId) return;
        const prefs = deps.settings().notifications;
        const categoryId = deps.community.channelParent?.(m.channelId) ?? null;
        const notify = effectiveNotify(prefs, m.communityId, m.channelId, Date.now(), categoryId);
        if (!mentionsYou(notify, m) || !countsMention(notify)) return;
        places.set(m.channelId, { communityId: m.communityId, categoryId });
        mentions.set(m.channelId, (mentions.get(m.channelId) ?? 0) + 1);
        update();
        return;
      }
      case 'catchUp':
        for (const [channel, n] of Object.entries(e.mentions)) {
          if (n > (mentions.get(channel) ?? 0)) mentions.set(channel, n);
        }
        update();
        return;
      case 'channelRead':
        if (mentions.delete(e.channelId)) update();
        return;
      default:
        return;
    }
  });
  deps.onSettingsChange?.(update);
  try {
    conversations = deps.conversations?.() ?? [];
  } catch {
    // no account or storage yet: the first list arrives as an event
  }
  update();
  return () => {
    offDm();
    offCommunity();
  };
}

/**
 * A round red badge with the count in white ("9+" above nine), as raw BGRA pixels for
 * Electron's nativeImage.createFromBitmap (Windows' taskbar overlay icon). Premultiplied alpha.
 */
export function badgeBitmap(count: number, size = 32): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const r = size / 2;
  // River's mention red.
  const [red, green, blue] = [0xe5, 0x48, 0x4d];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const alpha = Math.max(0, Math.min(1, r - d));
      const i = (y * size + x) * 4;
      out[i] = Math.round(blue * alpha);
      out[i + 1] = Math.round(green * alpha);
      out[i + 2] = Math.round(red * alpha);
      out[i + 3] = Math.round(255 * alpha);
    }
  }
  const text = count > 9 ? '9+' : String(Math.max(0, count));
  const scale = Math.max(1, Math.floor(size / 10));
  const width = text.length * 3 * scale + (text.length - 1) * scale;
  const left = Math.round((size - width) / 2);
  const top = Math.round((size - 5 * scale) / 2);
  [...text].forEach((ch, k) => {
    const glyph = GLYPHS[ch] ?? GLYPHS['0']!;
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy]![gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = left + k * 4 * scale + gx * scale + sx;
            const y = top + gy * scale + sy;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const i = (y * size + x) * 4;
            out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 255;
          }
        }
      }
    }
  });
  return out;
}

/** A 3×5 pixel font for the badge's digits. */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};
