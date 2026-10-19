import {
  conversationNotify,
  countsOnBadge,
  isMuted,
  mentionsYou,
  shouldAlert,
} from '../../../shared/notify-rules.ts';
import { create } from 'zustand';
import type {
  ConversationView,
  DirectMessageView,
  DmAction,
  DmActionResult,
  DmEvent,
} from '../../../shared/dm.ts';
import type { Result } from '../../../shared/ipc.ts';
import { useCommunity } from '../community/store.ts';
import { shareByKey } from '../structural.ts';
import { uiStartup } from '../startup.ts';
import { celebrate } from '../community/fx.tsx';
import { play, playNotifySound } from '../community/sound.ts';
import { useRiver } from '../store.ts';
import { tr } from '../i18n.ts';
import { withLiveMessages } from '../components/unread.ts';

const TYPING_MS = 6000;

interface DmState {
  loaded: boolean;
  myId: string | null;
  conversations: ConversationView[];
  /** The conversation list has arrived at least once (so later changes are news). */
  loadedOnce: boolean;
  selected: string | null;
  messages: Record<string, DirectMessageView[]>;
  typing: Record<string, number>;
  /** In groups: who typed last. */
  typingWho: Record<string, string>;
  replyTo: DirectMessageView | null;
  editing: string | null;
  load(): Promise<void>;
  handle(e: DmEvent): void;
  select(peer: string | null): void;
  /** Conversations whose messages could not be loaded (2.13.1): the conversation offers Retry. */
  historyFailed: Record<string, boolean>;
  /** Loads a conversation's messages (again). */
  reload(peer: string): Promise<void>;
  /** Loads the conversation back to `since` (ISO time), for jumping to older messages (2.10.7). */
  loadSince(peer: string, since: string): Promise<void>;
  /** Runs an action; shows the error as a toast and returns null on failure. */
  run<A extends DmAction>(action: A): Promise<DmActionResult<A> | null>;
  /**
   * Runs an action that has no result (rename, verify, add members…): true when it worked, else
   * the error is shown as a toast. (run() returns null for these whether or not they worked.)
   */
  attempt(action: DmAction): Promise<boolean>;
  open(peer: string, name?: string): Promise<boolean>;
}

export const useDm = create<DmState>((set, get) => ({
  loaded: false,
  myId: null,
  conversations: [],
  loadedOnce: false,
  selected: null,
  messages: {},
  typing: {},
  typingWho: {},
  replyTo: null,
  editing: null,

  load: async () => {
    const [conversations, myId] = await Promise.all([
      window.river.dm.action({ a: 'conversations' }),
      window.river.dm.action({ a: 'myId' }),
    ]);
    set({
      loaded: true,
      conversations: conversations.ok ? conversations.value : [],
      myId: myId.ok ? myId.value : null,
    });
    uiStartup.mark('chats');
  },

  handle: (e) => {
    switch (e.t) {
      case 'conversations': {
        // A new message request, or someone becoming your contact, gets its own sound.
        // "Friend" = accepted and they have answered; anything else before counts as not yet friends.
        const isFriend = (c: ConversationView): boolean => c.state === 'accepted' && !c.awaitingReply;
        const before = new Map(get().conversations.map((c) => [c.riverId, c]));
        const loaded = get().conversations.length > 0 || get().loadedOnce;
        // Unchanged chats keep their objects, so only the rows that changed draw again.
        set({
          conversations: shareByKey(get().conversations, e.conversations, (c) => c.riverId),
          loadedOnce: true,
        });
        if (!loaded) return;
        if (
          e.conversations.some((c) => c.kind === 'direct' && c.state === 'request' && !before.has(c.riverId))
        )
          play('friendRequest');
        else {
          const friend = e.conversations.find((c) => {
            const was = before.get(c.riverId);
            return c.kind === 'direct' && isFriend(c) && was !== undefined && !isFriend(was);
          });
          if (friend) {
            play('friendAdded');
            celebrate(tr('You and {name} are now friends', { name: friend.name }));
          }
        }
        return;
      }
      case 'message': {
        const m = e.message;
        const list = get().messages[m.peer];
        if (list) {
          const i = list.findIndex((x) => x.id === m.id);
          const next = i >= 0 ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
          next.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
          set({ messages: { ...get().messages, [m.peer]: next } });
        }
        if (e.isNew && !m.mine) {
          const { [m.peer]: _t, ...typing } = get().typing;
          set({ typing });
          const viewing =
            get().selected === m.peer && useRiver.getState().section === 'messages' && document.hasFocus();
          if (viewing) void window.river.dm.action({ a: 'read', peer: m.peer });
          // A muted conversation stays quiet (1.0.26), as does one set to Nothing, a message sent
          // without sound, and a group set to Only @mentions unless it mentions you (2.17). The
          // chat's own sound plays, if it has one.
          const prefs = useRiver.getState().settings?.notifications;
          const chat = prefs ? conversationNotify(prefs, m.peer) : null;
          if (!m.silent && (!chat || shouldAlert(chat, mentionsYou(chat, m)))) {
            playNotifySound(chat?.sound, viewing ? 'message' : 'dm');
          }
        }
        return;
      }
      case 'remove': {
        const list = get().messages[e.peer];
        if (list) set({ messages: { ...get().messages, [e.peer]: list.filter((m) => m.id !== e.id) } });
        return;
      }
      case 'typing':
        set({
          typing: { ...get().typing, [e.peer]: Date.now() },
          ...(e.who ? { typingWho: { ...get().typingWho, [e.peer]: e.who } } : {}),
        });
        window.setTimeout(() => set({ typing: { ...get().typing } }), TYPING_MS + 50);
        return;
      case 'focus':
        useRiver.getState().navigate('messages');
        get().select(e.peer);
        return;
    }
  },

  loadSince: async (peer, since) => {
    const res = await window.river.dm.action({ a: 'messages', peer, since });
    if (res.ok) set({ messages: { ...get().messages, [peer]: res.value } });
  },

  select: (peer) => {
    // Already open: keep the reply being written and the history loaded (a jump back in time).
    if (peer === get().selected) return;
    set({ selected: peer, replyTo: null, editing: null });
    if (!peer) return;
    void get().reload(peer);
    void window.river.dm.action({ a: 'read', peer });
  },

  historyFailed: {},
  reload: async (peer) => {
    const { [peer]: _failed, ...historyFailed } = get().historyFailed;
    set({ historyFailed });
    const res = await window.river.dm.action({ a: 'messages', peer });
    if (res.ok) {
      // Messages that arrived while this answer was on its way stay (2.13.1).
      set({ messages: { ...get().messages, [peer]: withLiveMessages(res.value, get().messages[peer]) } });
    } else if (!get().messages[peer]) {
      // Shown in the conversation with Retry, instead of a skeleton forever.
      set({ historyFailed: { ...get().historyFailed, [peer]: true } });
    }
  },

  run: async (action) => {
    const res = (await window.river.dm.action(action)) as Result<DmActionResult<typeof action>>;
    if (!res.ok) {
      useCommunity.getState().notify(res.message, 'error');
      return null;
    }
    return res.value;
  },

  attempt: async (action) => {
    const res = await window.river.dm.action(action);
    if (!res.ok) useCommunity.getState().notify(res.message, 'error');
    return res.ok;
  },

  open: async (peer, name) => {
    const conv = await get().run({ a: 'open', peer, ...(name ? { name } : {}) });
    if (!conv) return false;
    useRiver.getState().navigate('messages');
    get().select(peer);
    return true;
  },
}));

export function isTyping(peer: string): boolean {
  const at = useDm.getState().typing[peer];
  return at !== undefined && Date.now() - at < TYPING_MS;
}

/**
 * Unread messages for the Home badge: not blocked people, and (2.13.1) not muted conversations,
 * which counted on computers although they stay quiet (the phone's Chats badge already skipped them).
 */
export function totalUnread(
  conversations: ConversationView[],
  notifications?: Parameters<typeof isMuted>[0],
): number {
  return conversations
    .filter(
      (c) =>
        // Not message requests, nor archived chats unless you count them (2.19).
        countsOnBadge(c, notifications) &&
        !(notifications && isMuted(notifications, c.riverId)) &&
        // Set to Nothing (2.17): no count either.
        notifications?.overrides[c.riverId]?.level !== 'nothing',
    )
    .reduce((n, c) => n + c.unread, 0);
}

/** The window's title: "(3) River" while direct messages or mentions wait, like other messengers. */
export function windowTitle(unread: number, mentions: number): string {
  const n = unread + mentions;
  return n > 0 ? `(${n > 99 ? '99+' : n}) River` : 'River';
}
