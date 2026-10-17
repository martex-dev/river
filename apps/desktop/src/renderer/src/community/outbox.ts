import { create } from 'zustand';
import type { AttachmentPointer, SavedOutgoing } from '../../../shared/community-actions.ts';
import type { ChatMessage, LinkEmbed, Result } from '../../../shared/ipc.ts';
import { play } from './sound.ts';
import { useCommunity } from './store.ts';

/**
 * Messages on their way out. A message waits here while you are offline,
 * shows "Sending…" while it goes, and stays (with Retry) if it fails, so
 * nothing you typed is ever lost or silently dropped.
 */
export interface Outgoing {
  localId: string;
  /** The message's ID on the server, the same for every attempt (a retry never posts it twice). */
  messageId: string;
  channelId: string;
  text: string;
  replyTo?: string;
  /** Reply without notifying the person replied to. */
  noPing?: boolean;
  attachments?: AttachmentPointer[];
  /** Picture descriptions by attachment ID (not kept if River closes before the message is sent). */
  alts?: Record<string, string>;
  /** A link preview (not kept if River closes before the message is sent). */
  embed?: LinkEmbed;
  /** A reply inside this thread. */
  threadId?: string;
  status: 'waiting' | 'sending' | 'failed';
  error?: string;
  createdAt: string;
}

interface OutboxState {
  items: Outgoing[];
  send(item: Omit<Outgoing, 'localId' | 'messageId' | 'status' | 'createdAt'>): void;
  retry(localId: string): void;
  discard(localId: string): void;
  /** Sends everything that was waiting or failed (after reconnecting). */
  flush(): void;
  /** Brings back messages that were still unsent when River last closed. */
  restore(): Promise<void>;
}

/** Keeps a copy on this device (encrypted database) until the server has it. */
const save = (item: Outgoing): void =>
  void window.river.community
    .action({
      a: 'outboxSave',
      localId: item.localId,
      messageId: item.messageId,
      channelId: item.channelId,
      text: item.text,
      ...(item.replyTo ? { replyTo: item.replyTo } : {}),
      ...(item.threadId ? { threadId: item.threadId } : {}),
      ...(item.attachments ? { attachments: item.attachments } : {}),
      ...(item.replyTo && item.noPing ? { noPing: true } : {}),
      createdAt: item.createdAt,
    })
    .catch(() => undefined);
const forget = (localId: string): void =>
  void window.river.community.action({ a: 'outboxDelete', localId }).catch(() => undefined);

let counter = 0;

/** A new message ID (16 random bytes, base64url), the form River's server expects. */
export function newMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

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
    let res: Result<ChatMessage>;
    try {
      res = (await window.river.community.action({
        a: 'send',
        channelId: item.channelId,
        messageId: item.messageId,
        text: item.text,
        ...(item.replyTo ? { replyTo: item.replyTo } : {}),
        ...(item.replyTo && item.noPing ? { noPing: true } : {}),
        ...(item.attachments ? { attachments: item.attachments } : {}),
        ...(item.alts && Object.keys(item.alts).length ? { alts: item.alts } : {}),
        ...(item.embed ? { embed: item.embed } : {}),
        ...(item.threadId ? { threadId: item.threadId } : {}),
      })) as Result<ChatMessage>;
    } catch (err) {
      // The request itself broke (River's own channel to its core): never leave it "Sending…".
      res = { ok: false, message: (err as Error)?.message || 'River could not send this message.' };
    }
    if (res.ok) {
      set({ items: get().items.filter((i) => i.localId !== localId) });
      forget(localId);
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
      const full: Outgoing = {
        ...item,
        localId,
        messageId: newMessageId(),
        status: 'waiting',
        createdAt: new Date().toISOString(),
      };
      set({ items: [...get().items, full] });
      save(full);
      void attempt(localId);
    },
    retry: (localId) => void attempt(localId),
    discard: (localId) => {
      set({ items: get().items.filter((i) => i.localId !== localId) });
      forget(localId);
    },
    restore: async () => {
      const res = (await window.river.community.action({ a: 'outboxList' })) as Result<SavedOutgoing[]>;
      if (!res.ok || res.value.length === 0) return;
      const known = new Set(get().items.map((i) => i.localId));
      const back: Outgoing[] = res.value
        .filter((i) => !known.has(i.localId))
        .map((i) => ({ ...i, messageId: i.messageId ?? newMessageId(), status: 'waiting' }));
      set({ items: [...get().items, ...back] });
      // Saved by an older River without an ID: keep the one just chosen for the next restart too.
      for (const i of back) if (!res.value.find((r) => r.localId === i.localId)?.messageId) save(i);
      get().flush();
    },
    flush: () => {
      for (const i of get().items) if (i.status !== 'sending') void attempt(i.localId);
    },
  };
});

// Back online: send what was waiting.
useCommunity.subscribe((state, prev) => {
  if (state.connection === 'online' && prev.connection !== 'online') useOutbox.getState().flush();
});
