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
import { celebrate } from '../community/fx.tsx';
import { play } from '../community/sound.ts';
import { useRiver } from '../store.ts';

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
  /** Runs an action; shows the error as a toast and returns null on failure. */
  run<A extends DmAction>(action: A): Promise<DmActionResult<A> | null>;
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
  },

  handle: (e) => {
    switch (e.t) {
      case 'conversations': {
        // A new message request, or someone becoming your contact, gets its own sound.
        // "Friend" = accepted and they have answered; anything else before counts as not yet friends.
        const isFriend = (c: ConversationView): boolean => c.state === 'accepted' && !c.awaitingReply;
        const before = new Map(get().conversations.map((c) => [c.riverId, c]));
        const loaded = get().conversations.length > 0 || get().loadedOnce;
        set({ conversations: e.conversations, loadedOnce: true });
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
            celebrate(`You and ${friend.name} are now friends`);
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
          play(viewing ? 'message' : 'dm');
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

  select: (peer) => {
    set({ selected: peer, replyTo: null, editing: null });
    if (!peer) return;
    void window.river.dm.action({ a: 'messages', peer }).then((res) => {
      if (res.ok) set({ messages: { ...get().messages, [peer]: res.value } });
    });
    void window.river.dm.action({ a: 'read', peer });
  },

  run: async (action) => {
    const res = (await window.river.dm.action(action)) as Result<DmActionResult<typeof action>>;
    if (!res.ok) {
      useCommunity.getState().notify(res.message, 'error');
      return null;
    }
    return res.value;
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

export function totalUnread(conversations: ConversationView[]): number {
  return conversations.filter((c) => c.state !== 'blocked').reduce((n, c) => n + c.unread, 0);
}
