// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOutbox } from '../src/renderer/src/community/outbox.ts';
import { useCommunity } from '../src/renderer/src/community/store.ts';

const action = vi.fn();
/** Answers for the next sends, in order; everything else (saving, listing, deleting) succeeds. */
let sendReplies: unknown[] = [];
let saved: unknown[] = [];
const sends = (): unknown[][] => action.mock.calls.filter(([a]) => (a as { a: string }).a === 'send');

beforeEach(() => {
  action.mockReset();
  sendReplies = [];
  saved = [];
  action.mockImplementation(async (a: { a: string }) => {
    if (a.a === 'send') return sendReplies.shift();
    if (a.a === 'outboxList') return { ok: true, value: saved };
    return { ok: true, value: null };
  });
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
    threadId: null,
    thread: null,
  },
});

describe('outbox', () => {
  it('keeps the message on this device, waits while offline and sends once the connection is back', async () => {
    useCommunity.setState({ connection: 'offline' });
    useOutbox.getState().send({ channelId: 'ch', text: 'hello' });
    expect(useOutbox.getState().items).toMatchObject([{ status: 'waiting', text: 'hello' }]);
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ a: 'outboxSave', text: 'hello' }));
    expect(sends()).toHaveLength(0);

    sendReplies = [sent('hello')];
    useCommunity.setState({ connection: 'online' });
    await vi.waitFor(() => expect(useOutbox.getState().items).toEqual([]));
    expect(sends()[0]![0]).toEqual({ a: 'send', channelId: 'ch', text: 'hello' });
    // Delivered: the local copy goes away.
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ a: 'outboxDelete' }));
  });

  it('keeps a failed message with its reason until you retry or delete it', async () => {
    sendReplies = [{ ok: false, message: 'You do not have permission to do that' }];
    useOutbox.getState().send({ channelId: 'ch', text: 'nope' });
    await vi.waitFor(() =>
      expect(useOutbox.getState().items).toMatchObject([
        { status: 'failed', error: 'You do not have permission to do that' },
      ]),
    );
    sendReplies = [sent('nope')];
    useOutbox.getState().retry(useOutbox.getState().items[0]!.localId);
    await vi.waitFor(() => expect(useOutbox.getState().items).toEqual([]));

    sendReplies = [{ ok: false, message: 'boom' }];
    useOutbox.getState().send({ channelId: 'ch', text: 'bye' });
    await vi.waitFor(() => expect(useOutbox.getState().items[0]?.status).toBe('failed'));
    useOutbox.getState().discard(useOutbox.getState().items[0]!.localId);
    expect(useOutbox.getState().items).toEqual([]);
  });

  it('brings back messages that were unsent when River closed, and sends them', async () => {
    saved = [
      { localId: 'local-1-1', channelId: 'ch', text: 'from before', createdAt: new Date().toISOString() },
    ];
    sendReplies = [sent('from before')];
    await useOutbox.getState().restore();
    await vi.waitFor(() => expect(useOutbox.getState().items).toEqual([]));
    expect(sends()[0]![0]).toMatchObject({ a: 'send', text: 'from before' });
  });
});
