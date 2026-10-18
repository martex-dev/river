// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBack, OVERLAYS } from '../../mobile/ui/shell.ts';
import type { CallLinkView, CallView, ConversationView } from '../src/shared/dm.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { ForwardDialog } from '../src/renderer/src/community/ui/Forward.tsx';
import { MyStickersButton } from '../src/renderer/src/community/ui/Stickers.tsx';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useGroupCall } from '../src/renderer/src/dm/group-call.ts';
import { useCallHistory } from '../src/renderer/src/phone/calls.ts';
import { CallsTab } from '../src/renderer/src/phone/CallsTab.tsx';
import { setPhoneShellActive } from '../src/renderer/src/phone/mode.ts';
import { phoneBack, usePhoneNav } from '../src/renderer/src/phone/nav.ts';
import { PhoneShell } from '../src/renderer/src/phone/PhoneShell.tsx';
import { useSocial } from '../src/renderer/src/social/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';

/**
 * Bugs found by using the phone layout again at 360×800 and 390×844, light and dark, after group
 * calls, looks, notifications per chat and messaging part 2 (2.17–2.20), each pinned by a test
 * here (the stylesheet ones are in phone-audit-2-css.test.ts).
 */

const SAM = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
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

const link = (id: string, over: Partial<CallLinkView> = {}): CallLinkView => ({
  id: id.padEnd(22, 'l'),
  url: `https://river.test/call#h=${ME}&l=${id.padEnd(22, 'l')}`,
  callId: id.padEnd(22, 'c'),
  video: false,
  title: null,
  createdAt: '2026-10-18T09:00:00.000Z',
  expiresAt: '2026-10-25T09:00:00.000Z',
  admitted: [],
  ...over,
});

let calls: CallView[] = [];
let links: CallLinkView[] = [];
let actions: Array<{ a: string } & Record<string, unknown>> = [];

/** window.river: answers what the screens ask for, "ok" with an empty list otherwise. */
function fakeRiver(): unknown {
  const dm = (a: { a: string; link?: string }): unknown => {
    switch (a.a) {
      case 'calls':
        return calls;
      case 'callLinks':
        return links;
      case 'revokeCallLink':
        links = links.filter((l) => l.id !== a.link);
        return null;
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
        if (path.join('.') === 'social.action')
          return Promise.resolve({ ok: true, value: { posts: [], stories: [], friends: [] } });
        if (name === 'haptic' || name === 'send') return undefined;
        return Promise.resolve({ ok: true, value: [] });
      },
    });
  return leaf([]);
}

const platform = (p: string): void =>
  useRiver.setState({ info: { platform: p, version: '2.20.2' } as never });

beforeEach(() => {
  calls = [];
  links = [];
  actions = [];
  (window as unknown as { river: unknown }).river = fakeRiver();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  usePhoneNav.setState({ tab: 'chats', stack: [], leaving: null, motion: 'none' });
  useRiver.setState({
    section: 'messages',
    settingsTab: null,
    communityStart: false,
    settings: DEFAULT_SETTINGS,
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
  platform('android');
  useDm.setState({
    loaded: true,
    myId: ME,
    selected: null,
    editing: null,
    messages: {},
    historyFailed: {},
    conversations: [conv(SAM, 'Sam'), conv(ME, 'Note to self', { self: true, last: null })],
  });
  useCommunity.setState({ communities: [], loaded: true, selectedCommunity: null, selectedChannel: null });
  useCallHistory.setState({ calls: [], seenAt: '' });
  useGroupCall.setState({ madeLink: null });
  useSocial.setState({ feed: null });
  document.documentElement.dataset.motion = 'reduced';
});
afterEach(() => {
  cleanup();
  setPhoneShellActive(false);
  delete document.documentElement.dataset.motion;
  document.body.innerHTML = '';
});

describe("the phone's Back during a group call", () => {
  it('shrinks the full-screen group call into its conversation instead of closing the conversation', () => {
    // Back used to look only for the 1:1 call's screen: it closed the chat (and the call's screen with it).
    document.body.innerHTML = `
      <section><button data-phone-back="" id="inner">x</button></section>
      <div class="gcall gcall--full"><button class="dm-call__min" id="min">⌄</button></div>`;
    const clicked: string[] = [];
    for (const b of document.querySelectorAll('button'))
      b.addEventListener('click', () => clicked.push(b.id));
    const shell = vi.fn(() => true);
    expect(handleBack({ closeTopOverlay: () => false, doc: document, back: shell })).toBe(true);
    expect(clicked).toEqual(['min']);
    expect(shell).not.toHaveBeenCalled();
  });

  it('counts the full-screen group call as something open (an edge swipe does not go back under it)', () => {
    expect(OVERLAYS.split(', ')).toContain('.gcall--full');
  });

  it('lets Android have Back over a locked phone, group call or not', () => {
    document.documentElement.dataset.overLock = '';
    document.body.innerHTML = '<div class="gcall gcall--full"><button class="dm-call__min">⌄</button></div>';
    expect(handleBack({ closeTopOverlay: () => false, doc: document, back: phoneBack })).toBe(false);
    delete document.documentElement.dataset.overLock;
  });
});

describe('the Calls tab', () => {
  it('lists your call links, to copy again, start or stop (they were gone once their dialog closed)', async () => {
    links = [link('a1', { admitted: [SAM] }), link('a2', { video: true, title: 'Standup' })];
    render(<CallsTab />);
    const list = await screen.findByRole('list', { name: 'Call links' });
    expect(within(list).getByRole('button', { name: /Create call link/ })).toBeTruthy();
    expect(await within(list).findByText('Call link')).toBeTruthy();
    expect(within(list).getByText('Standup')).toBeTruthy();
    expect(within(list).getAllByRole('button', { name: 'Copy call link' })).toHaveLength(2);
    expect(within(list).getAllByRole('button', { name: 'Start the call of this link' })).toHaveLength(2);
    fireEvent.click(within(list).getAllByRole('button', { name: 'Stop this call link' })[0]!);
    await waitFor(() => expect(within(list).queryByText('Call link')).toBeNull());
    expect(actions).toContainEqual({ a: 'revokeCallLink', link: 'a1'.padEnd(22, 'l') });
    expect(within(list).getByText('Standup')).toBeTruthy();
  });

  it('a call through your call link opens no chat (it opened Note to self)', async () => {
    const base = {
      avatar: null,
      direction: 'out',
      video: false,
      answered: true,
      outcome: 'answered',
      durationSec: 60,
      startedAt: '2026-10-18T09:00:00.000Z',
    } as const;
    calls = [
      { ...base, id: 'k1', peer: ME, name: 'Your call link', kind: 'link', people: 3 },
      { ...base, id: 'k2', peer: SAM, name: 'Sam' },
    ];
    render(<CallsTab />);
    const history = await screen.findByRole('list', { name: 'Recent calls' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows[0]!.querySelector('.pcall__row')!.tagName).toBe('DIV');
    fireEvent.click(within(rows[0]!).getByText(/Your call link/));
    expect(usePhoneNav.getState().stack).toEqual([]);
    // A 1:1 call still opens its chat.
    fireEvent.click(rows[1]!.querySelector('button.pcall__row')!);
    expect(usePhoneNav.getState().stack).toEqual([{ kind: 'chat', peer: SAM }]);
  });
});

describe('call lines in a conversation', () => {
  const call = (id: string, peer: string, over: Partial<CallView> = {}): CallView => ({
    id,
    peer,
    name: 'x',
    avatar: null,
    direction: 'out',
    video: false,
    answered: true,
    outcome: 'answered',
    durationSec: 300,
    startedAt: '2026-10-18T09:00:00.000Z',
    ...over,
  });

  it("leave your call links' calls out of Note to self (their peer is you, the host)", async () => {
    calls = [call('k1', ME, { kind: 'link', people: 3 }), call('k2', SAM, { kind: 'link' }), call('k3', SAM)];
    render(<PhoneShell />);
    fireEvent.click(screen.getByText('Sam'));
    // The 1:1 call shows in Sam's chat; the call through Sam's link does not.
    await waitFor(() => expect(screen.getAllByText(/Call · 5 min/)).toHaveLength(1));
    usePhoneNav.setState({ stack: [], leaving: null });
    cleanup();
    render(<PhoneShell />);
    fireEvent.click(screen.getAllByText('Note to self')[0]!);
    await waitFor(() => expect(actions.filter((a) => a.a === 'calls').length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Call · 5 min/)).toBeNull();
  });
});

describe('forwarding on a phone', () => {
  const dialog = (): ReturnType<typeof render> =>
    render(<ForwardDialog text="hello" from={{ name: 'Sam', channel: '' }} onClose={() => undefined} />);

  it("does not open the keyboard over the list (the search isn't focused)", () => {
    dialog();
    expect(document.activeElement).not.toBe(screen.getByPlaceholderText('Search channels and people'));
  });

  it('still starts in the search on a computer', () => {
    platform('win32');
    dialog();
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search channels and people'));
  });
});

describe("the phone's message box", () => {
  it('draws saved replies and stickers as line icons like the buttons beside them (emoji looked greyed out)', async () => {
    render(<PhoneShell />);
    fireEvent.click(screen.getByText('Sam'));
    const replies = await screen.findByRole('button', { name: 'Saved replies' });
    expect(replies.querySelector('svg')).not.toBeNull();
    expect(replies.textContent).not.toContain('💬');
    const stickers = screen.getByRole('button', { name: 'Stickers' });
    expect(stickers.querySelector('svg')).not.toBeNull();
  });

  it('keeps the emoji on a computer', () => {
    render(<MyStickersButton onPick={() => undefined} />);
    const stickers = screen.getByRole('button', { name: 'Stickers' });
    expect(stickers.querySelector('svg')).toBeNull();
    expect(stickers.textContent).toContain('🗒️');
  });
});
