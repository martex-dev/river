import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const shown: FakeNotification[] = [];

class FakeNotification {
  readonly options: Record<string, unknown>;
  readonly listeners = new Map<string, (...args: unknown[]) => void>();
  constructor(options: Record<string, unknown>) {
    this.options = options;
  }
  static isSupported(): boolean {
    return true;
  }
  on(event: string, fn: (...args: unknown[]) => void): this {
    this.listeners.set(event, fn);
    return this;
  }
  show(): void {
    shown.push(this);
  }
}

vi.mock('electron', () => ({ Notification: FakeNotification }));

const { startMessageNotifications } = await import('../src/main/notifications.ts');

type Listener = (e: unknown) => void;

function setup() {
  let dmListener: Listener = () => undefined;
  const action = vi.fn(async () => null);
  const dm = {
    onEvent: (l: Listener) => {
      dmListener = l;
      return () => undefined;
    },
    focus: vi.fn(),
    nameOf: () => 'Bob',
    action,
  };
  const community = { onEvent: () => () => undefined };
  const window = { isDestroyed: () => false, isFocused: () => false, flashFrame: vi.fn() };
  const settings = {
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications, desktop: true, preview: 'full' as const },
  };
  startMessageNotifications({
    community: community as never,
    dm: dm as never,
    settings: () => settings,
    window: window as never,
  });
  return { emit: (e: unknown) => dmListener(e), action };
}

beforeEach(() => {
  shown.length = 0;
});

describe('replying from a notification', () => {
  it('offers a reply on direct messages and sends what was typed to that conversation', async () => {
    const { emit, action } = setup();
    emit({
      t: 'message',
      isNew: true,
      senderName: 'Bob',
      message: { mine: false, peer: 'bob-id', text: 'lunch?' },
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.options).toMatchObject({ title: 'Bob', body: 'lunch?', hasReply: true });
    shown[0]!.listeners.get('reply')!({}, '  sure, 12:30  ');
    expect(action).toHaveBeenCalledWith({ a: 'send', peer: 'bob-id', text: 'sure, 12:30' });
  });

  it('sends nothing for an empty reply', () => {
    const { emit, action } = setup();
    emit({
      t: 'message',
      isNew: true,
      senderName: 'Bob',
      message: { mine: false, peer: 'bob-id', text: 'hi' },
    });
    shown[0]!.listeners.get('reply')!({}, '   ');
    expect(action).not.toHaveBeenCalled();
  });

  it('an incoming call rings: a critical, not silent, notification that stays', () => {
    const { emit } = setup();
    emit({ t: 'call', kind: 'invite', peer: 'bob-id', callId: 'C'.repeat(22), video: true });
    expect(shown).toHaveLength(1);
    expect(shown[0]!.options).toMatchObject({
      title: 'Incoming video call',
      body: 'Bob is calling you',
      silent: false,
      urgency: 'critical',
      timeoutType: 'never',
    });
  });
});
