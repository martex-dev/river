import { describe, expect, it } from 'vitest';
import { badgeCount } from '../src/main/badge.ts';
import type { ConversationView } from '../src/shared/dm.ts';
import { countsOnBadge } from '../src/shared/notify-rules.ts';
import { DEFAULT_SETTINGS, settingsSchema, upgradeSettings } from '../src/shared/settings.ts';

/**
 * 2.19: archived chats and message requests stay off River's icon badge, as they do off the
 * Chats and Home badges (messaging-2.test.tsx) — unless "Count archived chats" is on.
 */

const chat = (riverId: string, unread: number, extra: Partial<ConversationView> = {}): ConversationView =>
  ({ riverId, kind: 'direct', state: 'accepted', unread, ...extra }) as ConversationView;

const chats = [
  chat('a', 2),
  chat('archived', 5, { archived: true }),
  chat('request', 7, { state: 'request' }),
  chat('group-request', 1, { kind: 'group', state: 'request' }),
  chat('blocked', 11, { state: 'blocked' }),
];
const prefs = (countArchived: boolean) => ({ ...DEFAULT_SETTINGS.notifications, countArchived });

describe('the badges (Telegram behaviour)', () => {
  it('leave out archived chats and message requests by default', () => {
    expect(DEFAULT_SETTINGS.notifications.countArchived).toBe(false);
    expect(badgeCount(prefs(false), chats, new Map())).toBe(2);
  });

  it('count archived chats with "Count archived chats" on — never requests or blocked people', () => {
    expect(badgeCount(prefs(true), chats, new Map([['ch', 1]]))).toBe(8);
    expect(countsOnBadge({ state: 'request' }, { countArchived: true })).toBe(false);
    expect(countsOnBadge({ state: 'accepted', archived: true }, undefined)).toBe(false);
  });

  it('settings from 2.18 get the new setting, off', () => {
    const { countArchived: _gone, ...old } = DEFAULT_SETTINGS.notifications;
    const upgraded = settingsSchema.parse(upgradeSettings({ ...DEFAULT_SETTINGS, notifications: old }));
    expect(upgraded.notifications.countArchived).toBe(false);
  });
});
