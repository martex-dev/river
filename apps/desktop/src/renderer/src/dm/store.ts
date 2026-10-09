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
import { play } from '../community/sound.ts';
import { useRiver } from '../store.ts';

const TYPING_MS = 6000;

interface DmState {
  loaded: boolean;
  myId: string | null;
  conversations: ConversationView[];
  selected: string | null;
  messages: Record<string, DirectMessageView[]>;
  typing: Record<string, number>;
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
  selected: null,
  messages: {},
  typing: {},
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
      case 'conversations':
        set({ conversations: e.conversations });
        return;
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
          if (useRiver.getState().settings?.notifications.sounds ?? true)
            play(viewing ? 'message' : 'mention');
        }
        return;
      }
      case 'remove': {
        const list = get().messages[e.peer];
        if (list) set({ messages: { ...get().messages, [e.peer]: list.filter((m) => m.id !== e.id) } });
        return;
      }
      case 'typing':
        set({ typing: { ...get().typing, [e.peer]: Date.now() } });
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
