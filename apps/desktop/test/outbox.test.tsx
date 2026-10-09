// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOutbox } from '../src/renderer/src/community/outbox.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';

const action = vi.fn();
beforeEach(() => {
  action.mockReset();
  (window as unknown as { river: unknown }).river = { community: { action } };
  useOutbox.setState({ items: [] });
  useCommunity.setState({ connection: 'online', messages: {} });
});

const sent = (text: string) => ({
  ok: true,
  value: {
    id: 'm1',
    communityId: 'c',
    channelId: 'ch',
    sender: 'me',
    senderName: 'Me',
    text,
    sentAt: new Date().toISOString(),
    editedAt: null,
    pinned: false,
    reactions: [],
    replyTo: null,
    attachments: [],
    mentionsMe: false,
    mine: true,
  },
});

describe('outbox', () => {
  it('waits while offline and sends once the connection is back', async () => {
    useCommunity.setState({ connection: 'offline' });
    useOutbox.getState().send({ channelId: 'ch', text: 'hello' });
    expect(useOutbox.getState().items).toMatchObject([{ status: 'waiting', text: 'hello' }]);
    expect(action).not.toHaveBeenCalled();

    action.mockResolvedValue(sent('hello'));
    useCommunity.setState({ connection: 'online' });
    await vi.waitFor(() => expect(useOutbox.getState().items).toEqual([]));
    expect(action).toHaveBeenCalledWith({ a: 'send', channelId: 'ch', text: 'hello' });
  });

  it('keeps a failed message with its reason until you retry or delete it', async () => {
    action.mockResolvedValueOnce({ ok: false, message: 'You do not have permission to do that' });
    useOutbox.getState().send({ channelId: 'ch', text: 'nope' });
    await vi.waitFor(() =>
      expect(useOutbox.getState().items).toMatchObject([
        { status: 'failed', error: 'You do not have permission to do that' },
      ]),
    );
    action.mockResolvedValueOnce(sent('nope'));
    useOutbox.getState().retry(useOutbox.getState().items[0]!.localId);
    await vi.waitFor(() => expect(useOutbox.getState().items).toEqual([]));

    action.mockResolvedValueOnce({ ok: false, message: 'boom' });
    useOutbox.getState().send({ channelId: 'ch', text: 'bye' });
    await vi.waitFor(() => expect(useOutbox.getState().items[0]?.status).toBe('failed'));
    useOutbox.getState().discard(useOutbox.getState().items[0]!.localId);
    expect(useOutbox.getState().items).toEqual([]);
  });
});
