import { create } from 'zustand';
import type { AttachmentPointer } from '../../../shared/community-actions.ts';
import type { ChatMessage, Result } from '../../../shared/ipc.ts';
import { play } from './sound.ts';
import { useCommunity } from './store.ts';

/**
 * Messages on their way out. A message waits here while you are offline,
 * shows "Sending…" while it goes, and stays (with Retry) if it fails, so
 * nothing you typed is ever lost or silently dropped.
 */
export interface Outgoing {
  localId: string;
  channelId: string;
  text: string;
  replyTo?: string;
  attachments?: AttachmentPointer[];
  /** A reply inside this thread. */
  threadId?: string;
  status: 'waiting' | 'sending' | 'failed';
  error?: string;
  createdAt: string;
}

interface OutboxState {
  items: Outgoing[];
  send(item: Omit<Outgoing, 'localId' | 'status' | 'createdAt'>): void;
  retry(localId: string): void;
  discard(localId: string): void;
  /** Sends everything that was waiting or failed (after reconnecting). */
  flush(): void;
}

let counter = 0;

export const useOutbox = create<OutboxState>((set, get) => {
  const patch = (localId: string, change: Partial<Outgoing>): void =>
    set({ items: get().items.map((i) => (i.localId === localId ? { ...i, ...change } : i)) });

  const attempt = async (localId: string): Promise<void> => {
    const item = get().items.find((i) => i.localId === localId);
    if (!item || item.status === 'sending') return;
    if (useCommunity.getState().connection !== 'online') {
      patch(localId, { status: 'waiting', error: undefined });
      return;
    }
    patch(localId, { status: 'sending', error: undefined });
    const res = (await window.river.community.action({
      a: 'send',
      channelId: item.channelId,
      text: item.text,
      ...(item.replyTo ? { replyTo: item.replyTo } : {}),
      ...(item.attachments ? { attachments: item.attachments } : {}),
      ...(item.threadId ? { threadId: item.threadId } : {}),
    })) as Result<ChatMessage>;
    if (res.ok) {
      set({ items: get().items.filter((i) => i.localId !== localId) });
      play('send');
      useCommunity.getState().handle({ t: 'message', message: res.value, isNew: false });
      return;
    }
    // Lost the connection on the way: wait for it rather than call it a failure.
    if (useCommunity.getState().connection !== 'online') patch(localId, { status: 'waiting' });
    else {
      play('error');
      patch(localId, { status: 'failed', error: res.message });
    }
  };

  return {
    items: [],
    send: (item) => {
      const localId = `local-${Date.now()}-${++counter}`;
      set({
        items: [...get().items, { ...item, localId, status: 'waiting', createdAt: new Date().toISOString() }],
      });
      void attempt(localId);
    },
    retry: (localId) => void attempt(localId),
    discard: (localId) => set({ items: get().items.filter((i) => i.localId !== localId) }),
    flush: () => {
      for (const i of get().items) if (i.status !== 'sending') void attempt(i.localId);
    },
  };
});

// Back online: send what was waiting.
useCommunity.subscribe((state, prev) => {
  if (state.connection === 'online' && prev.connection !== 'online') useOutbox.getState().flush();
});
