import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const shown: FakeNotification[] = [];

class FakeNotification {
  readonly options: Record<string, unknown>;
  readonly listeners = new Map<string, (...args: unknown[]) => void>();
  closed = false;
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
  close(): void {
    this.closed = true;
  }
}

vi.mock('electron', () => ({ Notification: FakeNotification }));

const { startMessageNotifications } = await import('../src/main/notifications.ts');

type Listener = (e: unknown) => void;

function setup(
  preview: 'full' | 'sender' | 'none' = 'full',
  focused = false,
  contact: string | null = 'accepted',
) {
  let dmListener: Listener = () => undefined;
  let ringEnd: Listener = () => undefined;
  let ringing: { callId: string } | null = null;
  const action = vi.fn(async () => null);
  const dm = {
    onEvent: (l: Listener) => {
      dmListener = l;
      return () => undefined;
    },
    onRingEnd: (l: Listener) => {
      ringEnd = l;
      return () => undefined;
    },
    ringingCall: () => ringing,
    focus: vi.fn(),
    nameOf: () => 'Bob',
    contactState: () => contact,
    action,
  };
  const community = { onEvent: () => () => undefined };
  const window = { isDestroyed: () => false, isFocused: () => focused, flashFrame: vi.fn() };
  const settings = {
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications, desktop: true, preview },
  };
  startMessageNotifications({
    community: community as never,
    dm: dm as never,
    settings: () => settings,
    window: window as never,
  });
  return {
    emit: (e: unknown) => {
      // dm-service keeps the ringing invite: as it would, for these tests.
      const ev = e as { t: string; kind?: string; callId?: string };
      if (ev.t === 'call' && ev.kind === 'invite') ringing = { callId: ev.callId! };
      dmListener(e);
    },
    /** dm-service says how the call stopped ringing. */
    ended: (callId: string, how: string, video = false, answeredOnPhone = false) => {
      if (ringing?.callId === callId) ringing = null;
      ringEnd({ event: { t: 'call', kind: 'invite', peer: 'bob-id', callId, video }, how, answeredOnPhone });
    },
    action,
  };
}

beforeEach(() => {
  shown.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
    vi.advanceTimersByTime(500);
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

describe('incoming call notifications (2.11.3)', () => {
  const callId = 'C'.repeat(22);

  it('goes away when the call is answered, declined, handled elsewhere or ends', () => {
    for (const kind of ['accept', 'decline', 'elsewhere', 'end', 'busy']) {
      shown.length = 0;
      const { emit } = setup();
      emit({ t: 'call', kind: 'invite', peer: 'bob-id', callId, video: false });
      vi.advanceTimersByTime(500);
      expect(shown).toHaveLength(1);
      emit({ t: 'call', kind, peer: 'bob-id', callId, video: false });
      expect(shown[0]!.closed).toBe(true);
    }
  });

  it('goes away when the call stops ringing here, and a call answered "busy" never shows one', () => {
    const { emit, ended } = setup();
    emit({ t: 'call', kind: 'invite', peer: 'bob-id', callId, video: false });
    vi.advanceTimersByTime(500);
    ended(callId, 'answered');
    expect(shown[0]!.closed).toBe(true);
    shown.length = 0;
    // In another call here: answered busy at once, before anything showed.
    emit({ t: 'call', kind: 'invite', peer: 'bob-id', callId: 'D'.repeat(22), video: false });
    ended('D'.repeat(22), 'busy');
    vi.advanceTimersByTime(500);
    expect(shown).toHaveLength(0);
  });

  it('a call nobody answered says "Missed call from …" (only "Missed call" with previews hidden)', () => {
    const named = setup('full');
    named.ended(callId, 'missed', true);
    expect(shown.at(-1)!.options).toMatchObject({ title: 'Missed call from Bob', silent: true });
    const hidden = setup('none');
    hidden.ended(callId, 'missed');
    expect(shown.at(-1)!.options).toMatchObject({ title: 'Missed call' });
    expect(JSON.stringify(shown.at(-1)!.options)).not.toContain('Bob');
  });

  it('no missed-call notice for a call answered or declined, nor while River is in front', () => {
    const { ended } = setup();
    ended(callId, 'declined');
    ended(callId, 'elsewhere');
    ended(callId, 'missed', false, true);
    expect(shown).toHaveLength(0);
    const front = setup('full', true);
    front.ended(callId, 'missed');
    expect(shown).toHaveLength(0);
  });
});

describe('friend requests (2.14)', () => {
  const request = {
    t: 'message',
    isNew: true,
    senderName: 'Bob',
    message: { mine: false, peer: 'bob-id', text: "Hi! Let's be friends" },
  };

  it('says it is a friend request, opens the request on click, and offers no reply', () => {
    const { emit } = setup('full', false, 'request');
    emit(request);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.options).toMatchObject({
      title: 'Bob',
      body: "Wants to be your friend: Hi! Let's be friends",
    });
    expect(shown[0]!.options.hasReply).toBeUndefined();
  });

  it('follows the preview setting: no name and no text when previews are off', () => {
    const { emit } = setup('none', false, 'request');
    emit(request);
    expect(shown[0]!.options).toMatchObject({ title: 'River', body: 'New friend request' });
    shown.length = 0;
    const named = setup('sender', false, 'request');
    named.emit(request);
    expect(shown[0]!.options).toMatchObject({ title: 'Bob', body: 'Wants to be your friend' });
  });
});
