// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(import('../src/renderer/src/community/sound.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  play: vi.fn(),
}));

import { AddFriendDialog, PasteToJoin } from '../src/renderer/src/community/ui/PasteToJoin.tsx';
import { useCommunity } from '../src/renderer/src/community/store.ts';
import { addFriend, addFriendMessage } from '../src/renderer/src/dm/friends.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';

const ME = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71';
const THEM = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const dm = vi.fn(async (..._args: unknown[]) => ({ ok: true, value: null as unknown }));
const actions = () => dm.mock.calls.map(([a]) => (a as { a: string }).a);
const as = (state: 'accepted' | 'request' | 'blocked', awaitingReply = false) =>
  useDm.setState({
    selected: null,
    conversations: [{ kind: 'direct', riverId: THEM, name: 'Sam', state, awaitingReply }] as never,
  });

beforeEach(() => {
  dm.mockClear();
  (window as unknown as { river: unknown }).river = {
    dm: { action: dm },
    app: { takeDeepLink: async () => null, onDeepLink: () => () => undefined },
  };
  useRiver.setState({
    navigate: vi.fn(),
    account: { state: 'registered', riverId: ME, connection: 'online' } as never,
  } as never);
  useCommunity.setState({ modal: null, toast: null });
  useDm.setState({ conversations: [], selected: null });
});
afterEach(cleanup);

describe('adding a friend', () => {
  it('a request you already sent is not sent again', async () => {
    as('accepted', true);
    expect(await addFriend(THEM)).toBe('already-sent');
    expect(actions()).toEqual([]);
    expect(addFriendMessage('already-sent', 'Sam')).toMatch(/already sent Sam a friend request/);
  });

  it('their request to you is accepted: you are friends, and nothing claims a request was sent', async () => {
    as('request');
    expect(await addFriend(THEM)).toBe('accepted');
    expect(actions()).toEqual(['accept', 'messages', 'read']);
    expect(useDm.getState().selected).toBe(THEM);
    expect(addFriendMessage('accepted', 'Sam')).toBe('You are now friends with Sam');
  });

  it('someone you blocked is refused with a reason', async () => {
    as('blocked');
    expect(await addFriend(THEM)).toBe('blocked');
    expect(actions()).toEqual([]);
    render(<AddFriendDialog riverId={THEM} serverUrl="https://river.example" />);
    fireEvent.click(screen.getByText('Send friend request'));
    expect(await screen.findByText(/Unblock them in Messages first/)).toBeTruthy();
  });

  it('the dialog says "You are now friends" when it accepted their request', async () => {
    as('request');
    useCommunity.setState({
      modal: { kind: 'add-friend', riverId: THEM, serverUrl: 'https://river.example' },
    });
    render(<AddFriendDialog riverId={THEM} serverUrl="https://river.example" />);
    fireEvent.click(screen.getByText('Send friend request'));
    await waitFor(() => expect(useCommunity.getState().toast?.text).toBe('You are now friends'));
    expect(actions()).not.toContain('send');
  });

  it('pasting a bare River ID (a link without its server) asks to add them', async () => {
    render(<PasteToJoin />);
    await act(async () => undefined);
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => THEM } });
    document.body.dispatchEvent(paste);
    expect(useCommunity.getState().modal).toEqual({ kind: 'add-friend', riverId: THEM, serverUrl: '' });
    cleanup();
    render(<AddFriendDialog riverId={THEM} serverUrl="" />);
    expect(screen.getByText(/You pasted a River ID/)).toBeTruthy();
  });
});
