// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBack } from '../../mobile/ui/shell.ts';
import type { CallView, ConversationView, DirectMessageView } from '../src/shared/dm.ts';
import type { CommunityView } from '../src/shared/ipc.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { Popover } from '../src/renderer/src/community/ui/common.tsx';
import { MemberList } from '../src/renderer/src/community/ui/Members.tsx';
import { ChannelRow } from '../src/renderer/src/community/ui/Sidebar.tsx';
import { useGrowToFit } from '../src/renderer/src/components/chat-ui.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useCallHistory } from '../src/renderer/src/phone/calls.ts';
import { setPhoneShellActive } from '../src/renderer/src/phone/mode.ts';
import { phoneBack, usePhoneNav } from '../src/renderer/src/phone/nav.ts';
import { PhoneShell } from '../src/renderer/src/phone/PhoneShell.tsx';
import { ProfileTab } from '../src/renderer/src/phone/ProfileTab.tsx';
import { useSocial } from '../src/renderer/src/social/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';
import { dayLabel } from '../src/renderer/src/time.ts';
import { useRef, useState, type ReactElement } from 'react';

/**
 * Bugs found by using River's phone layout screen by screen at 360×800 and 390×844 (2.16.1),
 * each pinned by a test here.
 */

const SAM = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const OLD = '1a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5e';
const STRANGER = '3a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c50';
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

const msg = (id: string, sentAt: string, over: Partial<DirectMessageView> = {}): DirectMessageView => ({
  id: id.padEnd(22, 'x'),
  peer: SAM,
  sender: SAM,
  senderName: 'Sam',
  mine: false,
  text: `message ${id}`,
  replyTo: null,
  attachments: [],
  sentAt,
  editedAt: null,
  deleted: false,
  status: 'received',
  reactions: [],
  ...over,
});

let messages: DirectMessageView[] = [];
let calls: CallView[] = [];
let feed: unknown = { posts: [], stories: [], friends: [] };
let actions: Array<{ a: string } & Record<string, unknown>> = [];

/** window.river: answers what the screens ask for, "ok" with an empty list otherwise. */
function fakeRiver(): unknown {
  const dm = (a: { a: string; peer?: string }): unknown => {
    switch (a.a) {
      case 'calls':
        return calls;
      case 'messages':
        return a.peer === SAM ? messages : [];
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
        if (path.join('.') === 'dm.action') {
          actions.push(args[0] as { a: string });
          return Promise.resolve({ ok: true, value: dm(args[0] as { a: string }) });
        }
        if (path.join('.') === 'social.action') return Promise.resolve({ ok: true, value: feed });
        if (name === 'haptic' || name === 'send') return undefined;
        return Promise.resolve({ ok: true, value: [] });
      },
    });
  return leaf([]);
}

/** Android's Back button, as MainActivity asks for it. */
const back = (): boolean => handleBack({ closeTopOverlay: () => false, doc: document, back: phoneBack });

beforeEach(() => {
  messages = [];
  calls = [];
  actions = [];
  feed = { posts: [], stories: [], friends: [] };
  (window as unknown as { river: unknown }).river = fakeRiver();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  usePhoneNav.setState({ tab: 'chats', stack: [], leaving: null, motion: 'none' });
  useRiver.setState({
    section: 'messages',
    settingsTab: null,
    communityStart: false,
    settings: DEFAULT_SETTINGS,
    info: { platform: 'android', version: '2.16.0' } as never,
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
    editing: null,
    messages: {},
    historyFailed: {},
    conversations: [conv(SAM, 'Sam', { unread: 1 })],
  });
  useCommunity.setState({ communities: [], loaded: true, selectedCommunity: null, selectedChannel: null });
  useCallHistory.setState({ calls: [], seenAt: '' });
  useSocial.setState({ feed: null });
  document.documentElement.dataset.motion = 'reduced';
});
afterEach(() => {
  cleanup();
  setPhoneShellActive(false);
  delete document.documentElement.dataset.motion;
  document.body.innerHTML = '';
});

describe("the phone's Back inside a screen", () => {
  it('closes what is open inside the screen (its close button) before the screen itself', () => {
    document.body.innerHTML = `
      <section inert><button data-phone-back="" id="covered">x</button></section>
      <section><button data-phone-back="" id="search">x</button><button data-phone-back="" id="edit">x</button></section>`;
    const clicked: string[] = [];
    for (const b of document.querySelectorAll('button'))
      b.addEventListener('click', () => clicked.push(b.id));
    const shell = vi.fn(() => true);
    expect(handleBack({ closeTopOverlay: () => false, doc: document, back: shell })).toBe(true);
    // The last one opened (later on the page), never one on a covered screen.
    expect(clicked).toEqual(['edit']);
    expect(shell).not.toHaveBeenCalled();
  });

  it('closes a dialog or menu over it first', () => {
    document.body.innerHTML = '<button data-phone-back="">x</button>';
    const close = vi.fn(() => true);
    const clicked = vi.fn();
    document.querySelector('button')!.addEventListener('click', clicked);
    expect(handleBack({ closeTopOverlay: close, doc: document, back: () => false })).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
  });
});

describe('Chats on a phone', () => {
  beforeEach(() => {
    useDm.setState({
      conversations: [
        conv(SAM, 'Sam', { unread: 1 }),
        conv(OLD, 'Old project', { archived: true, unread: 3 }),
        conv(STRANGER, 'Stranger', { state: 'request', unread: 1 }),
      ],
    });
    feed = {
      posts: [],
      friends: [],
      stories: [
        {
          riverId: SAM,
          name: 'Sam',
          avatar: null,
          mine: false,
          unseen: true,
          stories: [
            {
              id: 's1',
              author: SAM,
              authorName: 'Sam',
              authorAvatar: null,
              mine: false,
              kind: 'story',
              text: 'Sunset',
              attachments: [],
              createdAt: '2026-10-18T08:00:00.000Z',
              expiresAt: '2099-10-18T08:00:00.000Z',
              reactions: [],
              comments: [],
              audience: 0,
              viewers: [],
              seen: false,
            },
          ],
        },
      ],
    };
  });

  it('Back leaves the archived chats for the chat list instead of leaving River', async () => {
    render(<PhoneShell />);
    fireEvent.click(await screen.findByRole('button', { name: /Archived chats/ }));
    expect(screen.getByRole('list', { name: 'Archived chats' })).toBeTruthy();
    expect(
      within(screen.getByRole('list', { name: 'Archived chats' })).getByText('Old project'),
    ).toBeTruthy();
    act(() => {
      expect(back()).toBe(true);
    });
    expect(screen.getByRole('list', { name: 'Chats' })).toBeTruthy();
    // On the chat list itself Back lets the phone leave River.
    expect(back()).toBe(false);
  });

  it('shows no message requests or stories over the archive', async () => {
    render(<PhoneShell />);
    expect(await screen.findByRole('list', { name: 'Message requests' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.stories, .story-bubble')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Archived chats/ }));
    expect(screen.queryByRole('list', { name: 'Message requests' })).toBeNull();
    expect(document.querySelector('.story-bubble')).toBeNull();
  });

  it('clears the search with its button or with Back', () => {
    render(<PhoneShell />);
    const box = screen.getByRole('searchbox', { name: 'Search chats and messages' });
    fireEvent.change(box, { target: { value: 'sa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((box as HTMLInputElement).value).toBe('');
    fireEvent.change(box, { target: { value: 'sa' } });
    act(() => {
      expect(back()).toBe(true);
    });
    expect((box as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});

describe('a conversation on a phone', () => {
  const yesterday = new Date(2026, 9, 17, 18, 0).toISOString();
  const today = new Date(2026, 9, 18, 9, 0).toISOString();
  const later = new Date(2026, 9, 18, 10, 0).toISOString();

  it("puts a call under its own day, after the last message's day", async () => {
    messages = [msg('a1', yesterday), msg('a2', later)];
    calls = [
      {
        id: 'k1',
        peer: SAM,
        name: 'Sam',
        avatar: null,
        direction: 'in',
        video: false,
        answered: false,
        outcome: 'missed',
        durationSec: 0,
        startedAt: today,
      },
    ];
    render(<PhoneShell />);
    fireEvent.click(screen.getByText('Sam'));
    await screen.findByText('message a2');
    await screen.findByText(/Missed call/);
    const order = [
      ...document.querySelectorAll('.chat__messages .chat__day, .chat__messages .call-note'),
    ].map((e) => (e.classList.contains('call-note') ? 'call' : e.textContent));
    // Before 2.16.1 the call came first and its day's divider after it (or not at all).
    expect(order).toEqual([dayLabel(yesterday), dayLabel(today), 'call']);
  });

  it('a missed call after the last message gets its day too', async () => {
    messages = [msg('a1', yesterday)];
    calls = [
      {
        id: 'k1',
        peer: SAM,
        name: 'Sam',
        avatar: null,
        direction: 'in',
        video: false,
        answered: false,
        outcome: 'missed',
        durationSec: 0,
        startedAt: today,
      },
    ];
    render(<PhoneShell />);
    fireEvent.click(screen.getByText('Sam'));
    await screen.findByText(/Missed call/);
    const order = [
      ...document.querySelectorAll('.chat__messages .chat__day, .chat__messages .call-note'),
    ].map((e) => (e.classList.contains('call-note') ? 'call' : e.textContent));
    expect(order).toEqual([dayLabel(yesterday), dayLabel(today), 'call']);
  });

  it('edits with Cancel and Save buttons: Enter is a new line, Back cancels', async () => {
    messages = [
      msg('m1', later, { mine: true, sender: ME, senderName: 'Me', status: 'read', text: 'hello' }),
    ];
    render(<PhoneShell />);
    fireEvent.click(screen.getByText('Sam'));
    await screen.findByText('hello');
    act(() => useDm.setState({ editing: messages[0]!.id }));
    const box = await screen.findByRole('textbox', { name: 'Edit message' });
    expect(screen.queryByText(/escape to cancel/)).toBeNull();
    fireEvent.change(box, { target: { value: 'hello again' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(actions.some((a) => a.a === 'edit')).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    // Back cancels the edit; the conversation stays open.
    act(() => {
      expect(back()).toBe(true);
    });
    expect(useDm.getState().editing).toBeNull();
    expect(usePhoneNav.getState().stack).toEqual([{ kind: 'chat', peer: SAM }]);
    // Save saves.
    act(() => useDm.setState({ editing: messages[0]!.id }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Edit message' }), {
      target: { value: 'hello there' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(actions.find((a) => a.a === 'edit')).toMatchObject({ a: 'edit', text: 'hello there' }),
    );
  });

  it('Back closes the search in a conversation, then the conversation', async () => {
    render(<PhoneShell />);
    fireEvent.click(screen.getByText('Sam'));
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Search in this conversation/ }));
    expect(screen.getByRole('textbox', { name: 'Search in this conversation' })).toBeTruthy();
    act(() => {
      expect(back()).toBe(true);
    });
    expect(screen.queryByRole('textbox', { name: 'Search in this conversation' })).toBeNull();
    expect(usePhoneNav.getState().stack).toHaveLength(1);
    act(() => {
      expect(back()).toBe(true);
    });
    expect(usePhoneNav.getState().stack).toEqual([]);
  });

  it('says to long-press, not hover, when nothing is pinned', async () => {
    render(<PhoneShell />);
    fireEvent.click(screen.getByText('Sam'));
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Pinned messages/ }));
    expect(screen.getByText(/Long-press a message and choose Pin/)).toBeTruthy();
    act(() => {
      expect(back()).toBe(true);
    });
    expect(screen.queryByText(/Long-press a message and choose Pin/)).toBeNull();
    expect(usePhoneNav.getState().stack).toHaveLength(1);
  });
});

describe('the message box on a phone', () => {
  function Box({ on }: { on: boolean }): ReactElement {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [text, setText] = useState('');
    useGrowToFit(ref, text, on);
    return <textarea aria-label="box" ref={ref} value={text} onChange={(e) => setText(e.target.value)} />;
  }

  it('grows with lines that wrap, not only with new lines', () => {
    const tall = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(96);
    try {
      render(<Box on />);
      const box = screen.getByRole('textbox', { name: 'box' }) as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: 'a long line that wraps on a narrow phone screen' } });
      expect(box.style.height).toBe('96px');
    } finally {
      tall.mockRestore();
    }
  });

  it('is left alone on a computer', () => {
    render(<Box on={false} />);
    const box = screen.getByRole('textbox', { name: 'box' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'text' } });
    expect(box.style.height).toBe('');
  });
});

describe('menus that grow', () => {
  it('move back onto the screen when an inner section opens', () => {
    let height = 100;
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const h = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('popover') ? height : 0;
    });
    const w = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('popover') ? 220 : 0;
    });
    try {
      render(
        <Popover x={100} y={600} onClose={() => undefined}>
          <button>Mute ▸</button>
        </Popover>,
      );
      const menu = screen.getByRole('menu');
      expect(menu.style.top).toBe('600px');
      // "Mute ▸" opened its choices: the menu is taller now and would run off the screen.
      height = 300;
      act(() => observers.forEach((o) => o()));
      expect(menu.style.top).toBe(`${window.innerHeight - 8 - 300}px`);
    } finally {
      h.mockRestore();
      w.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('communities on a phone', () => {
  const community = {
    id: 'c1',
    name: 'Club',
    permissions: 0x7fffffff,
    members: [
      { riverId: ME, name: 'Me', avatar: null, roles: [], color: null, online: true, owner: true, rank: 0 },
      {
        riverId: SAM,
        name: 'Sam',
        avatar: null,
        roles: [],
        color: null,
        online: true,
        owner: false,
        rank: 0,
      },
    ],
    roles: [],
    voice: {},
    voiceStates: {},
    channels: [],
  } as unknown as CommunityView;

  it('opens a voice channel on its lobby without joining it (and turning the microphone on)', () => {
    setPhoneShellActive(true);
    const joinVoice = vi.fn(async () => undefined);
    const selectChannel = vi.fn();
    useCommunity.setState({ joinVoice, selectChannel, call: null } as never);
    const lounge = {
      id: 'v1',
      kind: 'voice',
      name: 'Lounge',
      permissions: 0x7fffffff,
      parentId: null,
      unread: false,
    } as never;
    render(<ChannelRow community={community} channel={lounge} me={ME} />);
    fireEvent.click(screen.getByRole('button', { name: 'Voice channel Lounge' }));
    expect(selectChannel).toHaveBeenCalledWith('v1');
    expect(joinVoice).not.toHaveBeenCalled();
  });

  it('gives the member list a way back to the channel, and Back closes it', () => {
    setPhoneShellActive(true);
    useCommunity.setState({ showMembers: true });
    render(<MemberList community={community} me={ME} />);
    expect(screen.getByText('Members · 2')).toBeTruthy();
    act(() => {
      expect(handleBack({ closeTopOverlay: () => false, doc: document, back: () => false })).toBe(true);
    });
    expect(useCommunity.getState().showMembers).toBe(false);
  });
});

describe('Settings on a phone', () => {
  it('"Phone and battery" opens the System part of the page, not its privacy toggles', async () => {
    const target = document.createElement('h2');
    target.id = 'settings-system';
    const scrolled = vi.fn();
    target.scrollIntoView = scrolled;
    document.body.append(target);
    render(<ProfileTab />);
    fireEvent.click(screen.getByRole('button', { name: /Phone and battery/ }));
    expect(useRiver.getState().settingsTab).toBe('system');
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
  });
});
