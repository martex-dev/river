/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOREVER } from '../src/shared/notify-rules.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';
import { channelBanner, dmBanner, type BannerContext } from '../src/renderer/src/notify/banner-rules.ts';
import { InAppBanner } from '../src/renderer/src/notify/InAppBanner.tsx';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';

/** In-app banners while River is open (2.17). */

const settings = (
  patch: Partial<Settings['notifications']> = {},
  presence: Settings['presence']['status'] = 'online',
): Settings => ({
  ...DEFAULT_SETTINGS,
  notifications: { ...DEFAULT_SETTINGS.notifications, preview: 'full', ...patch },
  presence: { ...DEFAULT_SETTINGS.presence, status: presence },
});

const ctx = (extra: Partial<BannerContext> = {}): BannerContext => ({
  settings: settings(),
  focused: true,
  viewingChat: null,
  viewingChannel: null,
  ...extra,
});

const dm = (text: string, extra: Record<string, unknown> = {}, peer = 'bob-id') =>
  ({
    t: 'message',
    isNew: true,
    senderName: 'Bob',
    message: { id: `m-${text}`, peer, sender: peer, senderName: 'Bob', mine: false, text, ...extra },
  }) as never;

const channel = (text: string, extra: Record<string, unknown> = {}) =>
  ({
    t: 'message',
    isNew: true,
    message: {
      id: `c-${text}`,
      communityId: 'C',
      channelId: 'ch',
      senderName: 'Ann',
      text,
      mine: false,
      mentionsMe: false,
      threadId: null,
      ...extra,
    },
  }) as never;

const place = { channelName: 'general', categoryId: null };

describe('which messages show a banner', () => {
  it('a message in another chat, with the sender and the text', () => {
    expect(dmBanner(dm('lunch?'), ctx())).toMatchObject({
      title: 'Bob',
      body: 'lunch?',
      open: { kind: 'chat', peer: 'bob-id' },
    });
    expect(channelBanner(channel('hello'), ctx(), place)).toMatchObject({
      title: 'Ann · #general',
      body: 'hello',
      open: { kind: 'channel', communityId: 'C', channelId: 'ch' },
    });
  });

  it('not for the chat or channel on screen, nor while River is in the background', () => {
    expect(dmBanner(dm('hi'), ctx({ viewingChat: 'bob-id' }))).toBeNull();
    expect(channelBanner(channel('hi'), ctx({ viewingChannel: 'ch' }), place)).toBeNull();
    expect(dmBanner(dm('hi'), ctx({ focused: false }))).toBeNull();
  });

  it('respects mutes, Nothing, silent messages, Do Not Disturb and the setting', () => {
    const muted = settings({ overrides: { 'bob-id': { level: 'default', muteUntil: FOREVER } } });
    expect(dmBanner(dm('hi'), ctx({ settings: muted }))).toBeNull();
    expect(dmBanner(dm('hi', { silent: true }), ctx())).toBeNull();
    expect(dmBanner(dm('hi'), ctx({ settings: settings({}, 'dnd') }))).toBeNull();
    expect(dmBanner(dm('hi'), ctx({ settings: settings({ banners: false }) }))).toBeNull();
    const nothing = settings({ overrides: { ch: { level: 'nothing', muteUntil: null } } });
    expect(channelBanner(channel('hi', { mentionsMe: true }), ctx({ settings: nothing }), place)).toBeNull();
    // Mentions still come through a muted channel.
    const mutedChannel = settings({ overrides: { ch: { level: 'default', muteUntil: FOREVER } } });
    expect(channelBanner(channel('hi'), ctx({ settings: mutedChannel }), place)).toBeNull();
    expect(
      channelBanner(
        channel('@me', { mentionsMe: true, mentionKind: 'direct' }),
        ctx({ settings: mutedChannel }),
        place,
      ),
    ).toMatchObject({ mention: true });
  });

  it('shows only what the preview setting allows', () => {
    expect(dmBanner(dm('secret'), ctx({ settings: settings({ preview: 'sender' }) }))).toMatchObject({
      title: 'Bob',
      body: 'New message',
    });
    const hidden = dmBanner(dm('secret'), ctx({ settings: settings({ preview: 'none' }) }));
    expect(hidden).toMatchObject({ title: 'River', body: 'New message' });
    expect(`${hidden!.title} ${hidden!.body}`).not.toMatch(/secret|Bob/);
  });
});

describe('the banner on screen', () => {
  let dmListener: (e: unknown) => void = () => undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    (window as unknown as { river: unknown }).river = {
      dm: {
        onEvent: (l: (e: unknown) => void) => {
          dmListener = l;
          return () => undefined;
        },
        action: vi.fn(async () => ({ ok: true, value: [] })),
      },
      community: { onEvent: () => () => undefined, action: vi.fn(async () => ({ ok: true, value: null })) },
    };
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opens the chat when tapped, and goes by itself after a few seconds', () => {
    const navigate = vi.fn();
    const select = vi.fn();
    useRiver.setState({ settings: settings(), section: 'home', navigate } as never);
    useDm.setState({ select } as never);
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    render(<InAppBanner />);
    act(() => dmListener(dm('lunch?')));
    expect(screen.getByText('lunch?')).toBeTruthy();
    fireEvent.click(screen.getByText('Bob'));
    expect(navigate).toHaveBeenCalledWith('messages');
    expect(select).toHaveBeenCalledWith('bob-id');
    expect(screen.queryByText('lunch?')).toBeNull();
    act(() => dmListener(dm('again')));
    expect(screen.getByText('again')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.queryByText('again')).toBeNull();
  });
});
