// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelView, ChatMessage, CommunityView } from '../src/shared/ipc.ts';
import {
  EMOJI_PICKER,
  insertAt,
  nearButton,
  stopEditing,
  useStickToBottom,
} from '../src/renderer/src/components/chat-ui.ts';
import { focusables, nextMenuItem, restoreFocus, trapTab } from '../src/renderer/src/components/focus.ts';
import { withLiveMessages } from '../src/renderer/src/components/unread.ts';
import { QuickSwitcher } from '../src/renderer/src/components/QuickSwitcher.tsx';
import { MenuItem, Modal, Popover } from '../src/renderer/src/community/ui/common.tsx';
import { TextChannel, typingText } from '../src/renderer/src/community/ui/Chat.tsx';
import { Toast } from '../src/renderer/src/pages/CommunitiesPage.tsx';
import { holdToast, useCommunity } from '../src/renderer/src/community/store.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';
import { dateLocale, dayLabel, messageWhen } from '../src/renderer/src/time.ts';

const msg = (id: string, minute: number, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id,
    communityId: 'c',
    channelId: 'ch',
    sender: 'x',
    senderName: 'X',
    text: id,
    sentAt: new Date(Date.UTC(2026, 9, 16, 10, minute)).toISOString(),
    reactions: [],
    attachments: [],
    mine: false,
    threadId: null,
    thread: null,
    ...extra,
  }) as unknown as ChatMessage;

const community = vi.fn();
const dm = vi.fn();
beforeEach(() => {
  community.mockReset();
  dm.mockReset();
  (window as unknown as { river: unknown }).river = {
    community: { action: community },
    dm: { action: dm },
    links: { preview: vi.fn() },
  };
  useCommunity.setState({
    communities: [{ id: 'c', channels: [{ id: 'ch', kind: 'text' }] }] as never,
    messages: {},
    noMore: {},
    historyFailed: {},
    toast: null,
    divider: null,
  });
  useDm.setState({ messages: {}, historyFailed: {}, selected: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useRiver.setState({ settings: null } as never);
});

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};

/** A button at a place on screen (jsdom has no layout). */
function buttonAt(rect: { left: number; top: number; width: number; height: number }): HTMLButtonElement {
  const b = document.createElement('button');
  b.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return b;
}

describe('pickers open next to their button', () => {
  it('opens above the button, right-aligned, wherever the pointer was (a key press clicks at 0,0)', () => {
    const b = buttonAt({ left: 900, top: 700, width: 32, height: 32 });
    expect(nearButton(b, EMOJI_PICKER)).toEqual({ x: 932 - 340, y: 700 - 360 - 8 });
  });

  it('opens below a button near the top of the window, and never off the left edge', () => {
    const b = buttonAt({ left: 20, top: 60, width: 32, height: 32 });
    expect(nearButton(b, EMOJI_PICKER)).toEqual({ x: 8, y: 100 });
  });
});

describe('emoji go where the caret is', () => {
  it('inserts at the caret, replaces a selection, and falls back to the end', () => {
    expect(insertAt('hello world', '🔥', 5)).toEqual({ text: 'hello🔥 world', caret: 7 });
    expect(insertAt('hello world', '👋', 6, 11)).toEqual({ text: 'hello 👋', caret: 8 });
    expect(insertAt('hi', '!', null)).toEqual({ text: 'hi!', caret: 3 });
    expect(insertAt('hi', '!', 99)).toEqual({ text: 'hi!', caret: 3 });
  });
});

/** A scrolling box with a controllable height and scroll position. */
function scrollable(el: HTMLElement, box: { height: number; client: number; top: number }): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => box.height });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => box.client });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => box.top,
    set: (v: number) => {
      box.top = Math.max(0, Math.min(v, box.height - box.client));
    },
  });
}

describe('the newest message stays in view', () => {
  function Log(props: { box: { height: number; client: number; top: number } }): ReactElement {
    const ref = useRef<HTMLDivElement | null>(null);
    useStickToBottom(ref);
    return (
      <div
        data-testid="log"
        ref={(el) => {
          // Attached before the hook's effect runs, so it measures this box.
          if (el) scrollable(el, props.box);
          ref.current = el;
        }}
      >
        <img alt="cat" />
      </div>
    );
  }

  it('follows a picture loading below the newest message, but leaves a reader who scrolled up alone', () => {
    const box = { height: 1000, client: 200, top: 800 };
    render(<Log box={box} />);
    const img = screen.getByAltText('cat');
    box.height = 1300;
    fireEvent.load(img);
    expect(box.top).toBe(1100);
    // Scrolled up to read: a picture loading does not pull them down.
    box.top = 100;
    fireEvent.scroll(screen.getByTestId('log'));
    box.height = 1600;
    fireEvent.load(img);
    expect(box.top).toBe(100);
  });
});

describe('history and live messages', () => {
  it('keeps a message that arrived while the newest page was on its way, without duplicates', () => {
    const page = [msg('a', 1), msg('b', 2)];
    expect(withLiveMessages(page, undefined)).toBe(page);
    expect(withLiveMessages(page, [msg('a', 1)])).toBe(page);
    expect(withLiveMessages(page, [msg('old', 0), msg('b', 2), msg('live', 3)]).map((m) => m.id)).toEqual([
      'a',
      'b',
      'live',
    ]);
  });

  it('a channel: asks once when opened twice at once, and keeps a live message the page lacks', async () => {
    let answer!: (v: unknown) => void;
    community.mockImplementation(() => new Promise((r) => (answer = r)));
    useCommunity.setState({ messages: { ch: [msg('a', 1)] } });
    const first = useCommunity.getState().loadMessages('ch');
    const second = useCommunity.getState().loadMessages('ch');
    expect(community).toHaveBeenCalledOnce();
    // A message arrives live before the page does.
    useCommunity.getState().handle({ t: 'message', message: msg('live', 9), isNew: false } as never);
    answer({ ok: true, value: { messages: [msg('a', 1), msg('b', 2)], hasMore: false, before: null } });
    await first;
    await second;
    expect(useCommunity.getState().messages.ch!.map((m) => m.id)).toEqual(['a', 'b', 'live']);
  });

  it('a channel that cannot be loaded says so instead of looking empty, and Retry loads it', async () => {
    community.mockResolvedValueOnce({ ok: false, message: 'offline' });
    await useCommunity.getState().loadMessages('ch');
    expect(useCommunity.getState().historyFailed.ch).toBe(true);
    expect(useCommunity.getState().messages.ch).toBeUndefined();
    community.mockResolvedValueOnce({
      ok: true,
      value: { messages: [msg('a', 1)], hasMore: false, before: null },
    });
    await useCommunity.getState().loadMessages('ch');
    expect(useCommunity.getState().historyFailed.ch).toBeUndefined();
    expect(useCommunity.getState().messages.ch).toHaveLength(1);
  });

  it('a direct conversation: the same, and a live message is kept', async () => {
    dm.mockResolvedValueOnce({ ok: false, message: 'offline' });
    await useDm.getState().reload('p');
    expect(useDm.getState().historyFailed.p).toBe(true);
    const live = { id: 'live', peer: 'p', sentAt: '2026-10-16T10:09:00.000Z' };
    useDm.setState({ messages: { p: [live] as never } });
    dm.mockResolvedValueOnce({
      ok: true,
      value: [{ id: 'a', peer: 'p', sentAt: '2026-10-16T10:01:00.000Z' }],
    });
    await useDm.getState().reload('p');
    expect(useDm.getState().historyFailed.p).toBeUndefined();
    expect(useDm.getState().messages.p!.map((m) => m.id)).toEqual(['a', 'live']);
  });
});

const channel = {
  id: 'ch',
  kind: 'text',
  name: 'general',
  topic: '',
  permissions: 0xffffffff,
  slowmode: 0,
  announcement: false,
  forum: false,
  media: false,
} as unknown as ChannelView;
const place = {
  id: 'c',
  name: 'Place',
  members: [{ riverId: 'me', name: 'Me', roles: [], avatar: null }],
  roles: [],
  channels: [channel],
  permissions: 0xffffffff,
} as unknown as CommunityView;

describe('opening a channel', () => {
  it('shows a skeleton while its history loads, not "the start of #channel" with a Wave button', async () => {
    let answer!: (v: unknown) => void;
    community.mockImplementation(() => new Promise((r) => (answer = r)));
    useCommunity.setState({ communities: [place], emojis: {}, typing: {} } as never);
    render(<TextChannel community={place} channel={channel} me="me" />);
    expect(screen.getByText('Loading messages…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Wave to say hi/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome to #general!', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Welcome to #general!' })).toBeNull();
    // Asked once, by the channel itself.
    expect(community).toHaveBeenCalledOnce();
    // Once it arrives (an empty channel): the welcome, with Wave.
    answer({ ok: true, value: { messages: [], hasMore: false, before: null } });
    await settle();
    expect(screen.queryByText('Loading messages…')).toBeNull();
    expect(screen.getByRole('button', { name: /Wave to say hi/ })).toBeTruthy();
  });

  it('offers Retry when the history could not be loaded', async () => {
    let history: unknown = { ok: false, message: 'offline' };
    community.mockImplementation((a: { a: string }) =>
      Promise.resolve(a.a === 'historyPage' ? history : { ok: true, value: null }),
    );
    useCommunity.setState({ communities: [place], emojis: {}, typing: {} } as never);
    render(<TextChannel community={place} channel={channel} me="me" />);
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/Could not load the messages/);
    history = { ok: true, value: { messages: [], hasMore: false, before: null } };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /Wave to say hi/ })).toBeTruthy();
  });

  it('Escape closes the @mention suggestions; typing on opens them again, from the first one', async () => {
    community.mockResolvedValue({ ok: true, value: { messages: [], hasMore: false, before: null } });
    const two = {
      ...place,
      members: [
        { riverId: 'me', name: 'Me', roles: [], avatar: null },
        { riverId: 'm1', name: 'Mara', roles: [], avatar: null },
        { riverId: 'm2', name: 'Milo', roles: [], avatar: null },
      ],
    } as unknown as CommunityView;
    useCommunity.setState({ communities: [two], emojis: {}, typing: {} } as never);
    render(<TextChannel community={two} channel={channel} me="me" />);
    await settle();
    const box = screen.getByPlaceholderText('Message #general');
    fireEvent.change(box, { target: { value: 'hi @M' } });
    expect(screen.getByRole('listbox', { name: 'Suggestions' })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(box, { target: { value: 'hi @Mi' } });
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('dates and times', () => {
  const at = (y: number, mo: number, d: number, h = 12, mi = 0): Date => new Date(y, mo, d, h, mi);

  it('says Today and Yesterday by the calendar, also just after a short DST day', () => {
    const now = at(2026, 2, 30, 0, 30);
    expect(dayLabel(at(2026, 2, 30, 0, 10), now)).toBe('Today');
    // 24 hours before 00:30 after a 23-hour day is two days back; the day before is still Yesterday.
    expect(dayLabel(at(2026, 2, 29, 0, 5), now)).toBe('Yesterday');
    expect(dayLabel(at(2026, 2, 27), now)).not.toMatch(/Today|Yesterday/);
    expect(messageWhen(at(2026, 2, 30, 0, 10), now)).toMatch(/^Today at /);
  });

  it('speaks Bulgarian when River is set to it, and writes dates in that language', () => {
    useRiver.setState({ settings: { appearance: { language: 'bg', clock: 'system' } } } as never);
    const now = at(2026, 9, 18, 15);
    expect(dayLabel(at(2026, 9, 18, 9), now)).toBe('Днес');
    expect(dayLabel(at(2026, 9, 17, 9), now)).toBe('Вчера');
    expect(messageWhen(at(2026, 9, 18, 9), now)).toMatch(/^Днес в /);
    expect(dateLocale('bg', 'en-US')).toEqual(['bg-BG']);
    expect(dateLocale('en', 'bg-BG')).toEqual(['en']);
    // Following the system, or matching it: the computer's own formats.
    expect(dateLocale('system', 'de-DE')).toEqual([]);
    expect(dateLocale('en', 'en-GB')).toEqual([]);
  });

  it('typing lines are translated too', () => {
    expect(typingText(['Ana'])).toBe('Ana is typing…');
    expect(typingText(['Ana', 'Bo'])).toBe('Ana, Bo are typing…');
    expect(typingText(['a', 'b', 'c', 'd'])).toBe('Several people are typing…');
    useRiver.setState({ settings: { appearance: { language: 'bg' } } } as never);
    expect(typingText(['Ана'])).toBe('Ана пише…');
  });
});

describe('dialogs and menus with the keyboard', () => {
  it('a dialog takes the focus, keeps Tab inside, and gives the focus back when it closes', async () => {
    function Host(): ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          <button>Behind</button>
          {open && (
            <Modal title="Rename" onClose={() => setOpen(false)}>
              <input aria-label="Name" />
              <button>Save</button>
            </Modal>
          )}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Rename' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Tab from the last control goes back to the first, not to the page behind.
    screen.getByRole('button', { name: 'Save' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('a menu focuses its first item, moves with the arrow keys and gives the focus back', async () => {
    function Host(): ReactElement {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>More</button>
          {open && (
            <Popover x={10} y={10} onClose={() => setOpen(false)} className="menu">
              <MenuItem onClick={() => undefined}>Reply</MenuItem>
              <MenuItem disabled onClick={() => undefined}>
                Pin
              </MenuItem>
              <MenuItem onClick={() => undefined}>Delete</MenuItem>
            </Popover>
          )}
        </>
      );
    }
    render(<Host />);
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    fireEvent.click(more);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reply' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    // The disabled item is skipped.
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reply' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('focus helpers: hidden controls are skipped; focus taken by something else is left alone', () => {
    document.body.innerHTML = `
      <div id="root"><button id="a">A</button><div hidden><button>Hidden</button></div><button id="b">B</button></div>
      <button id="prev">Prev</button><textarea id="box"></textarea>`;
    const root = document.getElementById('root')!;
    expect(focusables(root).map((el) => el.id)).toEqual(['a', 'b']);
    document.getElementById('box')!.focus();
    expect(trapTab(root, { key: 'Tab', shiftKey: false })).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    expect(trapTab(root, { key: 'Enter', shiftKey: false })).toBe(false);
    expect(nextMenuItem([], null, 'ArrowDown')).toBeNull();
    // The message box took the focus (Quote, Reply): it keeps it.
    document.getElementById('box')!.focus();
    restoreFocus(document.getElementById('prev'), root);
    expect(document.activeElement?.id).toBe('box');
    document.body.innerHTML = '';
  });

  it('ending an edit puts the keyboard back in the message box', async () => {
    document.body.innerHTML = '<form class="chat__composer"><textarea id="box"></textarea></form>';
    const close = vi.fn();
    stopEditing(close);
    // After the next frame (the edit box has gone by then).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement?.id).toBe('box');
    document.body.innerHTML = '';
  });

  it('letters typed while a dialog is open do not jump into the chat behind it', () => {
    document.body.innerHTML = `
      <div class="chat__composer"><textarea id="box"></textarea></div>
      <div class="modal" role="dialog"><div tabindex="-1" id="card"></div></div>`;
    const { unmount } = render(<QuickSwitcher />);
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(document.activeElement?.id).not.toBe('box');
    document.querySelector('.modal')!.remove();
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(document.activeElement?.id).toBe('box');
    unmount();
    document.body.innerHTML = '';
  });
});

describe('toasts', () => {
  it('errors are alerts, can be dismissed, and stay while the pointer is on them', () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useCommunity.getState().notify('Could not send.', 'error'));
    expect(screen.getByRole('alert').textContent).toMatch('Could not send.');
    act(() => holdToast(true));
    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => holdToast(false));
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => useCommunity.getState().notify('Saved.'));
    expect(screen.getByRole('status').textContent).toMatch('Saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
