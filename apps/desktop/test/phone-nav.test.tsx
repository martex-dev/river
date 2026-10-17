// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallView, ConversationView } from '../src/shared/dm.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { chatsBadge, missedSince, useCallHistory } from '../src/renderer/src/phone/calls.ts';
import {
  phoneBack,
  phonePop,
  phonePush,
  phoneTab,
  startPhoneSync,
  usePhoneNav,
} from '../src/renderer/src/phone/nav.ts';
import { PhoneShell } from '../src/renderer/src/phone/PhoneShell.tsx';
import { settle, follow } from '../src/renderer/src/phone/SwipeRow.tsx';
import { useRiver } from '../src/renderer/src/store.ts';

const SAM = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const ALEX = '1a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5e';
const ME = '2a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5f';

const conv = (riverId: string, name: string, over: Partial<ConversationView> = {}): ConversationView => ({
  riverId,
  kind: 'direct',
  members: [],
  isAdmin: false,
  name,
  avatar: null,
  state: 'accepted',
  awaitingReply: false,
  last: { text: `hi from ${name}`, sentAt: '2026-10-18T09:00:00.000Z', mine: false },
  unread: 0,
  verified: false,
  keyChanged: false,
  ...over,
});

const missedCall = (id: string, startedAt: string): CallView => ({
  id,
  peer: SAM,
  name: 'Sam',
  avatar: null,
  direction: 'in',
  video: false,
  answered: false,
  outcome: 'missed',
  durationSec: 0,
  startedAt,
});

let calls: CallView[] = [];

/** window.river: every call answers "ok" with an empty list unless a test says otherwise. */
function fakeRiver(): unknown {
  const dm = (a: { a: string }): unknown => {
    switch (a.a) {
      case 'calls':
        return calls;
      case 'conversations':
        return useDm.getState().conversations;
      case 'myId':
        return ME;
      default:
        return [];
    }
  };
  const leaf = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, key: string) => leaf([...path, key]),
      apply: (_t, _this, args: unknown[]) => {
        const name = path.at(-1) ?? '';
        if (/^on[A-Z]/.test(name)) return () => undefined;
        if (path.join('.') === 'dm.action')
          return Promise.resolve({ ok: true, value: dm(args[0] as { a: string }) });
        if (path.join('.') === 'social.action')
          return Promise.resolve({ ok: true, value: { posts: [], stories: [], friends: [] } });
        if (name === 'haptic' || name === 'send') return undefined;
        return Promise.resolve({ ok: true, value: [] });
      },
    });
  return leaf([]);
}

beforeEach(() => {
  calls = [];
  (window as unknown as { river: unknown }).river = fakeRiver();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  usePhoneNav.setState({ tab: 'chats', stack: [], leaving: null, motion: 'none' });
  useRiver.setState({
    section: 'messages',
    settingsTab: null,
    communityStart: false,
    settings: DEFAULT_SETTINGS,
    info: { platform: 'android', version: '2.12.0' } as never,
    identity: { riverId: ME, displayName: 'Me', fingerprint: '', words: [], createdAt: '' },
    account: {
      state: 'registered',
      server: 'river.test',
      serverUrl: 'https://river.test',
      shareUrl: 'https://river.test',
      riverId: ME,
      deviceId: 1,
      devices: 1,
      listVersion: 1,
      connection: 'online',
      username: 'me',
    } as never,
  });
  useDm.setState({
    loaded: true,
    myId: ME,
    selected: null,
    messages: {},
    conversations: [conv(SAM, 'Sam', { unread: 3 }), conv(ALEX, 'Alex', { unread: 2 })],
  });
  useCommunity.setState({ communities: [], loaded: true, selectedCommunity: null, selectedChannel: null });
  useCallHistory.setState({ calls: [], seenAt: '' });
  document.documentElement.dataset.motion = 'reduced';
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
});

describe('phone navigation', () => {
  it('pushes and pops screens, and Back goes to Chats before leaving River', () => {
    phoneTab('calls');
    expect(usePhoneNav.getState().tab).toBe('calls');
    expect(useRiver.getState().section).toBe('calls');
    phonePush({ kind: 'friends' });
    phonePush({ kind: 'files' });
    expect(usePhoneNav.getState().stack.map((s) => s.kind)).toEqual(['friends', 'files']);
    // Pushing a screen that is already open goes back to it.
    phonePush({ kind: 'friends' });
    expect(usePhoneNav.getState().stack.map((s) => s.kind)).toEqual(['friends']);
    expect(phoneBack()).toBe(true);
    expect(usePhoneNav.getState().stack).toEqual([]);
    expect(phoneBack()).toBe(true);
    expect(usePhoneNav.getState().tab).toBe('chats');
    expect(phoneBack()).toBe(false);
    expect(phonePop()).toBe(false);
  });

  it('opens what River selects by itself, and leaving a conversation selects nothing', () => {
    const stop = startPhoneSync();
    try {
      // A notification tap: River selects the conversation.
      act(() => useDm.getState().select(SAM));
      expect(usePhoneNav.getState().stack).toEqual([{ kind: 'chat', peer: SAM }]);
      // Another conversation replaces it instead of piling up.
      act(() => useDm.getState().select(ALEX));
      expect(usePhoneNav.getState().stack).toEqual([{ kind: 'chat', peer: ALEX }]);
      expect(phoneBack()).toBe(true);
      expect(useDm.getState().selected).toBeNull();
      // River going to Calls by itself shows the Calls tab.
      act(() => useRiver.getState().navigate('calls'));
      expect(usePhoneNav.getState().tab).toBe('calls');
      // "Create or join a community" opens its screen on Communities; Back closes it.
      act(() => useRiver.getState().setCommunityStart(true));
      expect(usePhoneNav.getState().tab).toBe('communities');
      expect(usePhoneNav.getState().stack).toEqual([{ kind: 'start' }]);
      phoneBack();
      expect(useRiver.getState().communityStart).toBe(false);
    } finally {
      stop();
    }
  });

  it("keeps River's section on what is shown, so only the open chat counts as read", () => {
    phoneTab('calls');
    phonePush({ kind: 'chat', peer: SAM });
    expect(useRiver.getState().section).toBe('messages');
    phonePop();
    expect(useRiver.getState().section).toBe('calls');
    phoneTab('communities');
    phonePush({ kind: 'community', id: 'c1' });
    phonePush({ kind: 'chat', peer: SAM });
    phonePush({ kind: 'channel', communityId: 'c1', channelId: 'ch1' });
    expect(useRiver.getState().section).toBe('communities');
  });

  it('counts badges: unread chats that are not muted, calls missed since you looked', () => {
    const muted = {
      ...DEFAULT_SETTINGS.notifications,
      overrides: { [ALEX]: { level: 'default' as const, muteUntil: '9999-12-31T00:00:00.000Z' } },
    };
    const list = [conv(SAM, 'Sam', { unread: 3 }), conv(ALEX, 'Alex', { unread: 2 })];
    expect(chatsBadge(list, DEFAULT_SETTINGS.notifications)).toBe(5);
    expect(chatsBadge(list, muted)).toBe(3);
    const history = [
      missedCall('a', '2026-10-18T08:00:00.000Z'),
      missedCall('b', '2026-10-18T10:00:00.000Z'),
    ];
    expect(missedSince(history, '')).toBe(2);
    expect(missedSince(history, '2026-10-18T09:00:00.000Z')).toBe(1);
  });

  it('settles a swiped row open or closed', () => {
    expect(settle(90, 148, 222)).toBe(148);
    expect(settle(40, 148, 222)).toBe(0);
    expect(settle(-150, 148, 222)).toBe(-222);
    expect(follow(200, 148, 222)).toBe(161);
  });
});

describe('the phone shell', () => {
  it('switches tabs from the tab bar, with badges on Chats and Calls', async () => {
    useCallHistory.setState({ calls: [missedCall('a', '2026-10-18T08:00:00.000Z')], seenAt: '' });
    calls = [missedCall('a', '2026-10-18T08:00:00.000Z')];
    render(<PhoneShell />);
    const tabs = screen.getByRole('navigation', { name: 'River' });
    expect(within(tabs).getByRole('button', { name: 'Chats, 5 unread' })).toBeTruthy();
    expect(within(tabs).getByRole('button', { name: 'Calls, 1 missed' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeTruthy();
    fireEvent.click(within(tabs).getByRole('button', { name: /^Communities/ }));
    expect(await screen.findByRole('heading', { name: 'Communities' })).toBeTruthy();
    expect(
      within(tabs)
        .getByRole('button', { name: /^Communities/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(within(tabs).getByRole('button', { name: /^Calls/ }));
    expect(await screen.findByRole('heading', { name: 'Calls' })).toBeTruthy();
    // Looking at Calls clears its badge.
    expect(within(tabs).getByRole('button', { name: 'Calls' })).toBeTruthy();
    fireEvent.click(within(tabs).getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('button', { name: /Privacy and security/ })).toBeTruthy();
  });

  it('opens a conversation full screen over Chats and goes back with Back', async () => {
    render(<PhoneShell />);
    fireEvent.click(screen.getByText('Sam'));
    expect(useDm.getState().selected).toBe(SAM);
    // The conversation's header: Back (with what waits in other chats), the name, calls.
    const back = await screen.findByRole('button', { name: 'Back, 2 unread' });
    expect(screen.getByRole('button', { name: 'Profile of Sam' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start voice call' })).toBeTruthy();
    // The tab bar hides inside a conversation.
    expect(screen.queryByRole('navigation', { name: 'River' })).toBeNull();
    fireEvent.click(back);
    expect(usePhoneNav.getState().stack).toEqual([]);
    expect(useDm.getState().selected).toBeNull();
    expect(screen.getByRole('navigation', { name: 'River' })).toBeTruthy();
  });

  it('opens Friends from the Chats header', async () => {
    render(<PhoneShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Friends' }));
    expect(usePhoneNav.getState().stack).toEqual([{ kind: 'friends' }]);
    expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy();
  });
});
