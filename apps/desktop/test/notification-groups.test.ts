import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FOREVER } from '../src/shared/notify-rules.ts';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings.ts';

/** One notification per conversation, read sync, Mark as read and per-chat rules (2.17). */

const shown: FakeNotification[] = [];

class FakeNotification {
  readonly options: Record<string, unknown>;
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  closed = false;
  phoneHints?: Record<string, unknown>;
  constructor(options: Record<string, unknown>) {
    this.options = options;
  }
  static isSupported(): boolean {
    return true;
  }
  on(event: string, fn: (...args: unknown[]) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
  show(): void {
    shown.push(this);
  }
  close(): void {
    this.closed = true;
    this.emit('close');
  }
}

vi.mock('electron', () => ({ Notification: FakeNotification }));

const { startMessageNotifications, summaryText } = await import('../src/main/notifications.ts');

type Listener = (e: unknown) => void;

function setup(
  options: {
    preview?: Settings['notifications']['preview'];
    overrides?: Settings['notifications']['overrides'];
    nativeGrouping?: boolean;
  } = {},
) {
  let dmListener: Listener = () => undefined;
  const communityListeners: Listener[] = [];
  const dmAction = vi.fn(async () => null);
  const communityAction = vi.fn(async () => null);
  const cleared: string[] = [];
  const dm = {
    onEvent: (l: Listener) => {
      dmListener = l;
      return () => undefined;
    },
    onRingEnd: () => () => undefined,
    ringingCall: () => null,
    focus: vi.fn(),
    nameOf: () => 'Bob',
    contactState: () => 'accepted',
    action: dmAction,
  };
  const community = {
    onEvent: (l: Listener) => {
      communityListeners.push(l);
      return () => undefined;
    },
    channelName: () => 'general',
    channelParent: () => null,
    focusChannel: vi.fn(),
    action: communityAction,
  };
  const window = {
    isDestroyed: () => false,
    isFocused: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn(),
  };
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      desktop: true,
      preview: options.preview ?? 'full',
      overrides: options.overrides ?? {},
    },
  };
  startMessageNotifications({
    community: community as never,
    dm: dm as never,
    settings: () => settings,
    window: window as never,
    ...(options.nativeGrouping
      ? { nativeGrouping: true, clearConversation: (c: string) => void cleared.push(c) }
      : {}),
  });
  const dmMessage = (
    text: string,
    extra: Record<string, unknown> = {},
    peer = 'bob-id',
    senderName = 'Bob',
  ) =>
    dmListener({
      t: 'message',
      isNew: true,
      senderName,
      message: { id: `m-${text}`, mine: false, peer, senderName: 'Bob', text, ...extra },
    });
  const channelMessage = (text: string, extra: Record<string, unknown> = {}) => {
    for (const l of communityListeners)
      l({
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
      });
  };
  return {
    dmMessage,
    channelMessage,
    dmEvent: (e: unknown) => dmListener(e),
    communityEvent: (e: unknown) => {
      for (const l of communityListeners) l(e);
    },
    dmAction,
    communityAction,
    cleared,
  };
}

beforeEach(() => {
  shown.length = 0;
});

describe('one notification per conversation (2.17)', () => {
  it('replaces a chat’s notification with a summary of its latest messages', () => {
    const t = setup();
    t.dmMessage('hi');
    t.dmMessage('are you there?');
    t.dmMessage('lunch?');
    expect(shown).toHaveLength(3);
    expect(shown[0]!.closed).toBe(true);
    expect(shown[1]!.closed).toBe(true);
    expect(shown[2]!.closed).toBe(false);
    expect(shown[2]!.options).toMatchObject({ title: 'Bob (3)', body: 'hi\nare you there?\nlunch?' });
  });

  it('says only how many when previews hide the messages, and never a name when they hide names', () => {
    const sender = setup({ preview: 'sender' });
    sender.dmMessage('secret one');
    sender.dmMessage('secret two');
    expect(shown.at(-1)!.options).toMatchObject({ title: 'Bob (2)', body: '2 new messages' });
    shown.length = 0;
    const hidden = setup({ preview: 'none' });
    hidden.dmMessage('secret one');
    hidden.dmMessage('secret two');
    expect(shown.at(-1)!.options).toMatchObject({ title: 'River (2)', body: '2 new direct messages' });
    expect(JSON.stringify(shown.map((n) => n.options))).not.toMatch(/secret|Bob/);
  });

  it('keeps conversations apart, and a group’s summary is headed by the group', () => {
    const t = setup();
    t.dmMessage('one', {}, 'bob-id');
    t.dmMessage('two', {}, 'G'.repeat(22), 'Bob · Hikers');
    t.dmMessage('three', {}, 'G'.repeat(22), 'Bob · Hikers');
    expect(shown[0]!.closed).toBe(false);
    expect(shown[2]!.options).toMatchObject({ title: 'Hikers (2)', body: 'Bob: two\nBob: three' });
  });

  it('summaries stop at a few lines and say how many more wait', () => {
    expect(summaryText('full', 7, ['a', 'b', 'c', 'd'], 'dm')).toBe('a\nb\nc\nd\n+3 more');
    expect(summaryText('sender', 7, [], 'channel')).toBe('7 new messages');
  });

  it('goes away when the chat is read — here or on another device (read sync)', () => {
    const t = setup();
    t.dmMessage('hi');
    t.dmEvent({ t: 'conversations', conversations: [{ riverId: 'bob-id', unread: 1 }] });
    expect(shown[0]!.closed).toBe(false);
    t.dmEvent({ t: 'conversations', conversations: [{ riverId: 'bob-id', unread: 0 }] });
    expect(shown[0]!.closed).toBe(true);
    // The next message starts again from one.
    t.dmMessage('again');
    expect(shown.at(-1)!.options).toMatchObject({ title: 'Bob', body: 'again' });
  });

  it('a channel’s goes away when the channel is read', () => {
    const t = setup();
    t.channelMessage('hello');
    t.channelMessage('anyone?');
    expect(shown.at(-1)!.options).toMatchObject({ title: '#general (2)', body: 'Ann: hello\nAnn: anyone?' });
    t.communityEvent({ t: 'channelRead', channelId: 'ch' });
    expect(shown.at(-1)!.closed).toBe(true);
  });

  it('Mark as read marks the chat or channel read and takes the notification away', () => {
    const t = setup();
    t.dmMessage('hi');
    expect(shown[0]!.options.actions).toEqual([{ type: 'button', text: 'Mark as read' }]);
    shown[0]!.emit('action', {}, 0);
    expect(t.dmAction).toHaveBeenCalledWith({ a: 'read', peer: 'bob-id' });
    expect(shown[0]!.closed).toBe(true);
    t.channelMessage('hello');
    shown.at(-1)!.emit('action', {}, 0);
    expect(t.communityAction).toHaveBeenCalledWith({ a: 'markRead', channelId: 'ch' });
  });

  it('on a phone: each message is posted as it is, with its count, and read chats are cleared there', () => {
    const t = setup({
      nativeGrouping: true,
      overrides: { 'bob-id': { level: 'default', muteUntil: null, sound: 'chime' } },
    });
    t.dmMessage('hi');
    t.dmMessage('lunch?');
    expect(shown[0]!.closed).toBe(false);
    expect(shown[1]!.options).toMatchObject({ title: 'Bob', body: 'lunch?' });
    expect(shown[1]!.phoneHints).toMatchObject({ conversation: 'dm:bob-id', count: 2, sound: 'chime' });
    t.dmEvent({ t: 'conversations', conversations: [] });
    expect(t.cleared).toEqual(['dm:bob-id']);
  });

  it('swiped away: the next message starts a new notification', () => {
    const t = setup();
    t.dmMessage('hi');
    shown[0]!.emit('close');
    t.dmMessage('again');
    expect(shown[1]!.options).toMatchObject({ title: 'Bob', body: 'again' });
  });
});

describe('per-chat and per-community rules (2.17)', () => {
  const group = 'G'.repeat(22);

  it('a group set to Only @mentions notifies only when you are mentioned or replied to', () => {
    const t = setup({ overrides: { [group]: { level: 'mentions', muteUntil: null } } });
    t.dmMessage('chatter', {}, group, 'Bob · Hikers');
    expect(shown).toHaveLength(0);
    t.dmMessage('@me look', { mentionsMe: true, mentionKind: 'direct' }, group, 'Bob · Hikers');
    expect(shown).toHaveLength(1);
  });

  it('a muted group still tells you about mentions; Nothing never', () => {
    const muted = setup({ overrides: { [group]: { level: 'default', muteUntil: FOREVER } } });
    muted.dmMessage('chatter', {}, group, 'Bob · Hikers');
    muted.dmMessage('reply to you', { mentionsMe: true, mentionKind: 'direct' }, group, 'Bob · Hikers');
    expect(shown).toHaveLength(1);
    shown.length = 0;
    const nothing = setup({ overrides: { [group]: { level: 'nothing', muteUntil: null } } });
    nothing.dmMessage('reply to you', { mentionsMe: true, mentionKind: 'direct' }, group, 'Bob · Hikers');
    expect(shown).toHaveLength(0);
  });

  it('a person you muted stays quiet', () => {
    const t = setup({ overrides: { 'bob-id': { level: 'default', muteUntil: FOREVER } } });
    t.dmMessage('hi');
    expect(shown).toHaveLength(0);
  });

  it('@everyone in a community that ignores it does not notify; your name does', () => {
    const t = setup({ overrides: { C: { level: 'mentions', muteUntil: null, suppressEveryone: true } } });
    t.channelMessage('@everyone hi', { mentionsMe: true, mentionKind: 'everyone' });
    expect(shown).toHaveLength(0);
    t.channelMessage('@me hi', { mentionsMe: true, mentionKind: 'direct' });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.options.title).toBe('Ann · #general');
  });

  it('a muted channel still notifies a reply to you', () => {
    const t = setup({ overrides: { ch: { level: 'default', muteUntil: FOREVER } } });
    t.channelMessage('chatter');
    expect(shown).toHaveLength(0);
    t.channelMessage('replying to you', { mentionsMe: true, mentionKind: 'direct' });
    expect(shown).toHaveLength(1);
  });
});
