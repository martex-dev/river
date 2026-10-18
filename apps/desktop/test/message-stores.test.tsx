// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../src/shared/ipc.ts';
import { canLoadOlder, useCommunity } from '../src/renderer/src/community/store.ts';
import { usePendingFiles } from '../src/renderer/src/community/ui/Attachments.tsx';
import { addFriend } from '../src/renderer/src/dm/friends.ts';
import { useDm } from '../src/renderer/src/dm/store.ts';
import { useRiver } from '../src/renderer/src/store.ts';

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
    community: { action: community, messages: vi.fn() },
    dm: { action: dm },
  };
  useCommunity.setState({ messages: {}, noMore: {}, threads: {}, toast: null });
});

/** A history page as main answers it (2.12). */
const page = (messages: ChatMessage[], hasMore: boolean, before = messages[0]?.sentAt ?? null) => ({
  ok: true,
  value: { messages, hasMore, before, beforeId: before ? 'x'.repeat(22) : null },
});

describe('older channel history', () => {
  it('loads one page at a time, even when asked twice at once', async () => {
    useCommunity.setState({ messages: { ch: [msg('m5', 5)] } });
    let answer!: (v: unknown) => void;
    community.mockImplementation(() => new Promise((r) => (answer = r)));
    const a = useCommunity.getState().loadOlder('ch');
    const b = useCommunity.getState().loadOlder('ch');
    expect(community).toHaveBeenCalledOnce();
    answer(page([msg('m1', 1), msg('m2', 2)], true));
    expect(await a).toBe(2);
    expect(await b).toBe(2);
    expect(useCommunity.getState().messages.ch!.map((m) => m.id)).toEqual(['m1', 'm2', 'm5']);
  });

  it('ends where main says, not at a short page (undecryptable messages are left out)', async () => {
    useCommunity.setState({ messages: { ch: [msg('m5', 5)] } });
    community.mockResolvedValueOnce(page([msg('m4', 4)], true));
    await useCommunity.getState().loadOlder('ch');
    expect(useCommunity.getState().noMore.ch).toBeUndefined();
    community.mockResolvedValueOnce(page([msg('m3', 3)], false));
    expect(await useCommunity.getState().loadOlder('ch')).toBe(1);
    expect(useCommunity.getState().noMore.ch).toBe(true);
  });

  it('walks past pages of messages it cannot open, from where the server stopped', async () => {
    useCommunity.setState({ messages: { ch: [msg('m50', 50)] } });
    const far = new Date(Date.UTC(2026, 9, 16, 9, 0)).toISOString();
    const further = new Date(Date.UTC(2026, 9, 16, 8, 0)).toISOString();
    // Two full pages from before you joined (nothing opens), then one you can read.
    community
      .mockResolvedValueOnce(page([], true, far))
      .mockResolvedValueOnce(page([], true, further))
      .mockResolvedValueOnce(page([msg('m1', 1)], true));
    expect(await useCommunity.getState().loadOlder('ch')).toBe(1);
    const asked = community.mock.calls.map((c) => (c[0] as { before?: string }).before);
    // Each request starts where the server's last page ended, never at the same place again.
    expect(asked).toEqual([msg('m50', 50).sentAt, far, further]);
    expect(useCommunity.getState().noMore.ch).toBeUndefined();
  });

  it('offers older messages from what main says when the newest page opens only partly', async () => {
    useCommunity.setState({
      communities: [{ id: 'c', channels: [{ id: 'ch', kind: 'text' }] }] as never,
      noMore: { ch: true },
    });
    community.mockResolvedValueOnce(page([msg('m9', 9)], true));
    await useCommunity.getState().loadMessages('ch');
    expect(useCommunity.getState().noMore.ch).toBe(false);
    expect(canLoadOlder(useCommunity.getState().noMore, 'ch', 1)).toBe(true);
    community.mockResolvedValueOnce(page([msg('m9', 9)], false));
    await useCommunity.getState().loadMessages('ch');
    expect(canLoadOlder(useCommunity.getState().noMore, 'ch', 1)).toBe(false);
    // Not known yet (another way of filling the list): the old guess.
    expect(canLoadOlder({}, 'ch', 100)).toBe(true);
    expect(canLoadOlder({}, 'ch', 3)).toBe(false);
  });

  it('removes a deleted thread reply from its thread', () => {
    useCommunity.setState({ threads: { root: [msg('r1', 1), msg('r2', 2)] } });
    useCommunity.getState().handle({ t: 'messageDelete', channelId: 'ch', messageId: 'r1' } as never);
    expect(useCommunity.getState().threads.root!.map((m) => m.id)).toEqual(['r2']);
  });
});

describe('direct messages', () => {
  it('opening the chat that is already open keeps the reply and the history loaded', () => {
    dm.mockResolvedValue({ ok: true, value: [] });
    const reply = { id: 'm', peer: 'p' } as never;
    useDm.setState({ selected: 'p', replyTo: reply });
    useDm.getState().select('p');
    expect(useDm.getState().replyTo).toBe(reply);
    expect(dm).not.toHaveBeenCalled();
  });

  it('tells actions without a result apart when they fail', async () => {
    dm.mockResolvedValueOnce({ ok: true, value: null });
    expect(await useDm.getState().attempt({ a: 'setVerified', peer: 'p', verified: true } as never)).toBe(
      true,
    );
    dm.mockResolvedValueOnce({ ok: false, message: 'nope' });
    expect(await useDm.getState().attempt({ a: 'setVerified', peer: 'p', verified: true } as never)).toBe(
      false,
    );
    expect(useCommunity.getState().toast).toMatchObject({ text: 'nope' });
  });

  it('adding someone who already is a friend opens your chat and sends nothing', async () => {
    dm.mockResolvedValue({ ok: true, value: [] });
    const navigate = vi.fn();
    useRiver.setState({ navigate } as never);
    useDm.setState({
      selected: null,
      conversations: [{ kind: 'direct', riverId: 'f', state: 'accepted', awaitingReply: false }] as never,
    });
    expect(await addFriend('f')).toBe('friend');
    expect(navigate).toHaveBeenCalledWith('messages');
    expect(useDm.getState().selected).toBe('f');
    expect(dm.mock.calls.some(([a]) => (a as { a: string }).a === 'send')).toBe(false);
  });
});

describe('files waiting to be sent', () => {
  it('stay with their chat, and free the previews of files removed or over the limit', () => {
    const revoke = vi.fn();
    let n = 0;
    Object.assign(URL, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: revoke });
    const png = (i: number) => new File(['x'], `p${i}.png`, { type: 'image/png' });
    const first = renderHook(() => usePendingFiles('c:one'));
    let over = 0;
    act(() => {
      over = first.result.current.add(Array.from({ length: 12 }, (_, i) => png(i)));
    });
    expect(over).toBe(2);
    expect(first.result.current.pending).toHaveLength(10);
    expect(revoke).toHaveBeenCalledTimes(2);
    const keep = first.result.current.pending.slice(1);
    act(() => first.result.current.setPending(keep));
    expect(revoke).toHaveBeenCalledTimes(3);
    first.unmount();
    // Back in the same channel: still there.
    const again = renderHook(() => usePendingFiles('c:one'));
    expect(again.result.current.pending).toHaveLength(9);
    expect(renderHook(() => usePendingFiles('c:two')).result.current.pending).toHaveLength(0);
  });
});
