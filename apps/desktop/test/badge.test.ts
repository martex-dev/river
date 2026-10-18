import { describe, expect, it, vi } from 'vitest';
import { badgeBitmap, badgeCount, startBadge } from '../src/main/badge.ts';
import type { ConversationView } from '../src/shared/dm.ts';
import { FOREVER } from '../src/shared/notify-rules.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';

/** The unread count on River's icon (2.17). */

const chat = (riverId: string, unread: number, extra: Partial<ConversationView> = {}): ConversationView =>
  ({ riverId, kind: 'direct', state: 'accepted', unread, ...extra }) as ConversationView;

const prefs = (overrides: Settings['notifications']['overrides'] = {}, badge = true) => ({
  ...DEFAULT_SETTINGS.notifications,
  overrides,
  badge,
});

describe('the badge count', () => {
  it('adds up unread chats and mentions, leaving out muted, Nothing and blocked chats', () => {
    const chats = [
      chat('a', 2),
      chat('b', 3),
      chat('muted', 5),
      chat('nothing', 7),
      chat('blocked', 11, { state: 'blocked' }),
    ];
    const p = prefs({
      muted: { level: 'default', muteUntil: FOREVER },
      nothing: { level: 'nothing', muteUntil: null },
    });
    expect(badgeCount(p, chats, new Map([['ch', 4]]))).toBe(9);
  });

  it('is 0 when the badge is turned off', () => {
    expect(badgeCount(prefs({}, false), [chat('a', 2)], new Map([['ch', 1]]))).toBe(0);
  });
});

describe('keeping the badge up to date', () => {
  function setup(overrides: Settings['notifications']['overrides'] = {}) {
    let dmListener: (e: unknown) => void = () => undefined;
    let communityListener: (e: unknown) => void = () => undefined;
    let settingsListener: () => void = () => undefined;
    const settings = { notifications: prefs(overrides) };
    const set = vi.fn();
    startBadge({
      dm: { onEvent: (l) => ((dmListener = l as never), () => undefined) },
      community: {
        onEvent: (l) => ((communityListener = l as never), () => undefined),
        channelParent: () => null,
      },
      settings: () => settings,
      onSettingsChange: (l) => (settingsListener = l),
      conversations: () => [chat('a', 1)],
      set,
    });
    const mention = (channelId: string, kind: 'direct' | 'everyone' = 'direct') =>
      communityListener({
        t: 'message',
        isNew: true,
        message: {
          communityId: 'C',
          channelId,
          mine: false,
          mentionsMe: true,
          mentionKind: kind,
          threadId: null,
        },
      });
    return {
      set,
      settings,
      mention,
      dm: (e: unknown) => dmListener(e),
      community: (e: unknown) => communityListener(e),
      settingsChanged: () => settingsListener(),
    };
  }

  it('starts from the chats as they are, and follows them', () => {
    const t = setup();
    expect(t.set).toHaveBeenLastCalledWith(1);
    t.dm({ t: 'conversations', conversations: [chat('a', 2), chat('b', 1)] });
    expect(t.set).toHaveBeenLastCalledWith(3);
    // Read on another device: the count drops.
    t.dm({ t: 'conversations', conversations: [chat('a', 0), chat('b', 0)] });
    expect(t.set).toHaveBeenLastCalledWith(0);
  });

  it('counts mentions until their channel is read', () => {
    const t = setup();
    t.mention('ch');
    t.mention('ch');
    expect(t.set).toHaveBeenLastCalledWith(3);
    t.community({ t: 'channelRead', channelId: 'ch' });
    expect(t.set).toHaveBeenLastCalledWith(1);
    t.community({ t: 'catchUp', unread: {}, mentions: { other: 2 } });
    expect(t.set).toHaveBeenLastCalledWith(3);
  });

  it('leaves out @everyone where the community ignores it, and channels set to Nothing', () => {
    const t = setup({
      C: { level: 'default', muteUntil: null, suppressEveryone: true },
      quiet: { level: 'nothing', muteUntil: null },
    });
    t.mention('ch', 'everyone');
    t.mention('quiet');
    expect(t.set).toHaveBeenLastCalledWith(1);
    t.mention('ch', 'direct');
    expect(t.set).toHaveBeenLastCalledWith(2);
  });

  it('counts again when settings change (the badge turned off)', () => {
    const t = setup();
    t.settings.notifications = prefs({}, false);
    t.settingsChanged();
    expect(t.set).toHaveBeenLastCalledWith(0);
  });
});

describe('the taskbar badge picture', () => {
  it('is a red disc with the count in white', () => {
    const size = 32;
    const px = badgeBitmap(3, size);
    expect(px.length).toBe(size * size * 4);
    const at = (x: number, y: number) => [...px.slice((y * size + x) * 4, (y * size + x) * 4 + 4)];
    // Corners are transparent.
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
    // Somewhere inside the "3" is white, and the disc's edge is River red (BGRA).
    const pixels = Array.from({ length: size * size }, (_, i) => [...px.slice(i * 4, i * 4 + 4)]);
    expect(pixels.some((p) => p.join() === '255,255,255,255')).toBe(true);
    expect(at(3, 16)).toEqual([0x4d, 0x48, 0xe5, 255]);
  });

  it('shows "9+" above nine', () => {
    expect(badgeBitmap(12)).toEqual(badgeBitmap(99));
    expect(badgeBitmap(12)).not.toEqual(badgeBitmap(9));
  });
});
