import { create } from 'zustand';
import type { ChatMessage, CommunityEvent, CommunityView } from '../../../shared/ipc.ts';
import { VoiceCall } from './voice.ts';

interface CommunityState {
  loaded: boolean;
  error: string | null;
  connection: 'online' | 'offline' | 'connecting';
  communities: CommunityView[];
  selectedCommunity: string | null;
  selectedChannel: string | null;
  messages: Record<string, ChatMessage[]>;
  call: VoiceCall | null;
  /** Bumped whenever call state changes, to re-render. */
  callVersion: number;
  callError: string | null;

  load(): Promise<void>;
  handle(event: CommunityEvent): void;
  select(communityId: string, channelId?: string): void;
  selectChannel(channelId: string): void;
  loadMessages(channelId: string): Promise<void>;
  joinVoice(channelId: string, me: string): Promise<void>;
  leaveVoice(): Promise<void>;
}

export const useCommunity = create<CommunityState>((set, get) => ({
  loaded: false,
  error: null,
  connection: 'offline',
  communities: [],
  selectedCommunity: null,
  selectedChannel: null,
  messages: {},
  call: null,
  callVersion: 0,
  callError: null,

  load: async () => {
    const [res, connection] = await Promise.all([
      window.river.community.list(),
      window.river.community.connection(),
    ]);
    set({ connection });
    if (res.ok) applyCommunities(res.value);
    set({ loaded: true, error: res.ok ? null : res.message });
  },

  handle: (event) => {
    switch (event.t) {
      case 'communities':
        applyCommunities(event.communities);
        return;
      case 'connection':
        set({ connection: event.state });
        return;
      case 'message': {
        const list = get().messages[event.message.channelId];
        if (!list || list.some((m) => m.id === event.message.id)) return;
        set({ messages: { ...get().messages, [event.message.channelId]: [...list, event.message] } });
        return;
      }
      case 'voice': {
        set({
          communities: get().communities.map((c) =>
            c.id === event.communityId
              ? { ...c, voice: { ...c.voice, [event.channelId]: event.participants } }
              : c,
          ),
        });
        const call = get().call;
        if (call && call.channelId === event.channelId) call.updateParticipants(event.participants);
        return;
      }
      case 'signal': {
        const call = get().call;
        if (call && call.channelId === event.channelId) void call.handleSignal(event.from, event.data);
        return;
      }
    }
  },

  select: (communityId, channelId) => {
    const c = get().communities.find((x) => x.id === communityId);
    const channel =
      channelId ?? c?.channels.find((ch) => ch.kind === 'text')?.id ?? c?.channels[0]?.id ?? null;
    set({ selectedCommunity: communityId, selectedChannel: channel });
    if (channel) void get().loadMessages(channel);
  },

  selectChannel: (channelId) => {
    set({ selectedChannel: channelId });
    void get().loadMessages(channelId);
  },

  loadMessages: async (channelId) => {
    const c = get().communities.find((x) => x.channels.some((ch) => ch.id === channelId));
    if (c?.channels.find((ch) => ch.id === channelId)?.kind !== 'text') return;
    const res = await window.river.community.messages(channelId);
    if (res.ok) set({ messages: { ...get().messages, [channelId]: res.value } });
  },

  joinVoice: async (channelId, me) => {
    await get().call?.leave();
    const call = new VoiceCall(channelId, me, () => set({ callVersion: get().callVersion + 1 }));
    set({ call, callError: null });
    try {
      await call.start();
    } catch (err) {
      set({
        call: null,
        callError:
          (err as Error).name === 'NotAllowedError'
            ? 'River could not use your microphone. Allow microphone access in your system settings.'
            : (err as Error).message || 'Could not join the voice channel.',
      });
    }
  },

  leaveVoice: async () => {
    const call = get().call;
    set({ call: null });
    await call?.leave();
  },
}));

function applyCommunities(communities: CommunityView[]): void {
  const s = useCommunity.getState();
  useCommunity.setState({ communities });
  if (!s.selectedCommunity || !communities.some((c) => c.id === s.selectedCommunity)) {
    if (communities[0]) useCommunity.getState().select(communities[0].id);
    else useCommunity.setState({ selectedCommunity: null, selectedChannel: null });
  }
}
