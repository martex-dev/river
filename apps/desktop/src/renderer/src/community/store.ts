import { create } from 'zustand';
import type { CommunityAction, CommunityActionResult } from '../../../shared/community-actions.ts';
import type { ChatMessage, CommunityEvent, CommunityView, Result } from '../../../shared/ipc.ts';
import { useRiver } from '../store.ts';
import { play } from './sound.ts';
import { VoiceCall } from './voice.ts';

export type Modal =
  | { kind: 'community-settings'; communityId: string; tab?: CommunityTab }
  | { kind: 'channel-settings'; channelId: string }
  | { kind: 'create-channel'; communityId: string; channelKind: 'text' | 'voice'; parentId?: string }
  | { kind: 'category'; communityId: string; categoryId?: string }
  | { kind: 'invite'; communityId: string }
  | { kind: 'join-invite'; link: string }
  | { kind: 'add-friend'; riverId: string; serverUrl: string }
  | { kind: 'user-settings'; tab?: UserTab }
  | { kind: 'confirm'; title: string; body: string; action: string; run: () => Promise<void> };

export type CommunityTab = 'overview' | 'roles' | 'members' | 'bans';
export type UserTab = 'profile' | 'voice' | 'notifications' | 'appearance';

const TYPING_MS = 7000;

interface CommunityState {
  loaded: boolean;
  error: string | null;
  connection: 'online' | 'offline' | 'connecting';
  communities: CommunityView[];
  selectedCommunity: string | null;
  selectedChannel: string | null;
  messages: Record<string, ChatMessage[]>;
  unread: Record<string, number>;
  mentions: Record<string, number>;
  /** Where the "New messages" divider goes in the open channel. */
  divider: { channelId: string; after: string } | null;
  /** When you last read each channel this session. */
  readAt: Record<string, string>;
  /** channel → River ID → time typing was last seen */
  typing: Record<string, Record<string, number>>;
  call: VoiceCall | null;
  /** Bumped whenever call state changes, to re-render. */
  callVersion: number;
  callError: string | null;
  selfMuted: boolean;
  selfDeafened: boolean;
  modal: Modal | null;
  toast: { text: string; tone: 'info' | 'error' } | null;
  replyTo: ChatMessage | null;
  editing: string | null;
  showMembers: boolean;
  showPins: boolean;
  showSearch: boolean;
  /** Channels whose older history is exhausted. */
  noMore: Record<string, boolean>;
  loadOlder(channelId: string): Promise<number>;

  load(): Promise<void>;
  handle(event: CommunityEvent): void;
  select(communityId: string, channelId?: string): void;
  selectChannel(channelId: string): void;
  loadMessages(channelId: string): Promise<void>;
  joinVoice(channelId: string, me: string): Promise<void>;
  leaveVoice(): Promise<void>;
  toggleMute(): void;
  toggleDeafen(): void;
  setModal(modal: Modal | null): void;
  notify(text: string, tone?: 'info' | 'error'): void;
  /** Runs a community action and shows its error, if any, as a toast. */
  run<A extends CommunityAction>(action: A): Promise<CommunityActionResult<A> | null>;
}

let toastTimer: number | undefined;

/** Remembers (on this device, encrypted) that a channel was read up to now. */
const markRead = (channelId: string): Promise<unknown> =>
  window.river.community.action({ a: 'markRead', channelId }).catch(() => undefined);

export const useCommunity = create<CommunityState>((set, get) => ({
  loaded: false,
  error: null,
  connection: 'offline',
  communities: [],
  selectedCommunity: null,
  selectedChannel: null,
  messages: {},
  unread: {},
  mentions: {},
  divider: null,
  readAt: {},
  typing: {},
  call: null,
  callVersion: 0,
  callError: null,
  selfMuted: false,
  selfDeafened: false,
  modal: null,
  toast: null,
  replyTo: null,
  editing: null,
  // On narrow windows the member list is an overlay, so start with it closed.
  showMembers: typeof window === 'undefined' || window.innerWidth >= 1100,
  showPins: false,
  showSearch: false,
  noMore: {},

  loadOlder: async (channelId) => {
    const list = get().messages[channelId];
    if (!list?.length || get().noMore[channelId]) return 0;
    const res = await window.river.community.action({ a: 'history', channelId, before: list[0]!.sentAt });
    if (!res.ok) return 0;
    const older = (res.value as ChatMessage[]).filter((m) => !list.some((x) => x.id === m.id));
    set({
      messages: { ...get().messages, [channelId]: [...older, ...(get().messages[channelId] ?? [])] },
      ...(older.length < 100 ? { noMore: { ...get().noMore, [channelId]: true } } : {}),
    });
    return older.length;
  },

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
    const settings = useRiver.getState().settings;
    switch (event.t) {
      case 'communities':
        applyCommunities(event.communities);
        return;
      case 'connection':
        set({ connection: event.state });
        return;
      case 'message': {
        const m = event.message;
        const list = get().messages[m.channelId];
        if (list) {
          const i = list.findIndex((x) => x.id === m.id);
          const next = i >= 0 ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
          set({ messages: { ...get().messages, [m.channelId]: next } });
        }
        if (!event.isNew || m.mine) return;
        // The sender stopped typing.
        const typing = { ...get().typing[m.channelId] };
        delete typing[m.sender];
        set({ typing: { ...get().typing, [m.channelId]: typing } });
        const viewing =
          get().selectedChannel === m.channelId &&
          useRiver.getState().section === 'communities' &&
          document.hasFocus();
        if (viewing) {
          void markRead(m.channelId);
          set({ readAt: { ...get().readAt, [m.channelId]: m.sentAt } });
        }
        if (!viewing) {
          set({ unread: { ...get().unread, [m.channelId]: (get().unread[m.channelId] ?? 0) + 1 } });
          if (m.mentionsMe) {
            set({ mentions: { ...get().mentions, [m.channelId]: (get().mentions[m.channelId] ?? 0) + 1 } });
          }
        }
        const mode = settings?.notifications.mode ?? 'all';
        if (m.mentionsMe) play('mention');
        else if (!viewing && mode === 'all') play('message');
        return;
      }
      case 'messageDelete': {
        const list = get().messages[event.channelId];
        if (list) {
          set({
            messages: { ...get().messages, [event.channelId]: list.filter((m) => m.id !== event.messageId) },
          });
        }
        return;
      }
      case 'typing': {
        set({
          typing: {
            ...get().typing,
            [event.channelId]: { ...get().typing[event.channelId], [event.riverId]: Date.now() },
          },
        });
        window.setTimeout(() => set({ typing: { ...get().typing } }), TYPING_MS + 50);
        return;
      }
      case 'voice': {
        const before =
          get().communities.find((c) => c.id === event.communityId)?.voice[event.channelId] ?? [];
        set({
          communities: get().communities.map((c) =>
            c.id === event.communityId
              ? {
                  ...c,
                  voice: { ...c.voice, [event.channelId]: event.participants },
                  voiceStates: { ...c.voiceStates, ...event.states },
                }
              : c,
          ),
        });
        const call = get().call;
        if (call && call.channelId === event.channelId) {
          const me = useRiver.getState().identity?.riverId ?? '';
          const joined = event.participants.filter((id) => !before.includes(id) && id !== me);
          const left = before.filter((id) => !event.participants.includes(id) && id !== me);
          if (joined.length) play('join');
          else if (left.length) play('leave');
          call.setServerMuted(event.states[me]?.serverMuted ?? false);
          call.updateParticipants(event.participants);
        }
        return;
      }
      case 'voiceDisconnect': {
        const call = get().call;
        if (!call) return;
        set({ call: null });
        void call.leave();
        play('disconnected');
        get().notify('You were disconnected from the voice channel.');
        return;
      }
      case 'removed': {
        const c = get().communities.find((x) => x.id === event.communityId);
        const name = c?.name ?? 'a community';
        if (event.reason === 'kicked') get().notify(`You were removed from ${name}.`, 'error');
        if (event.reason === 'banned') get().notify(`You were banned from ${name}.`, 'error');
        if (event.reason === 'deleted') get().notify(`${name} was deleted by its owner.`, 'error');
        const call = get().call;
        if (call && c?.channels.some((ch) => ch.id === call.channelId)) void get().leaveVoice();
        return;
      }
      case 'focusChannel':
        useRiver.getState().navigate('communities');
        get().select(event.communityId, event.channelId);
        return;
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
    set({ selectedCommunity: communityId, selectedChannel: channel, replyTo: null, editing: null });
    if (channel) get().selectChannel(channel);
  },

  selectChannel: (channelId) => {
    // Leaving a channel and opening one both count as reading them up to now.
    const previous = get().selectedChannel;
    const channel = get()
      .communities.flatMap((c) => c.channels)
      .find((c) => c.id === channelId);
    const after = get().readAt[channelId] ?? channel?.lastReadAt ?? null;
    const hasNew = (get().unread[channelId] ?? 0) > 0 || !!channel?.unread;
    const now = new Date().toISOString();
    set({
      divider: hasNew && after ? { channelId, after } : null,
      readAt: { ...get().readAt, [channelId]: now, ...(previous ? { [previous]: now } : {}) },
    });
    if (previous && previous !== channelId) void markRead(previous);
    void markRead(channelId);
    const { [channelId]: _u, ...unread } = get().unread;
    const { [channelId]: _m, ...mentions } = get().mentions;
    set({ selectedChannel: channelId, unread, mentions, replyTo: null, editing: null, showPins: false });
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
    const voice = useRiver.getState().settings?.voice;
    const iceServers = await window.river.voice.iceServers().catch(() => []);
    let streaming = false;
    const onChange = (): void => {
      set({ callVersion: get().callVersion + 1 });
      // Keep the server's LIVE badge right, including when the OS ends a share.
      const now = !!get().call?.localTrack('screen');
      if (now !== streaming) {
        streaming = now;
        sendVoiceState();
      }
    };
    const call = new VoiceCall(channelId, me, onChange, {
      iceServers,
      inputDeviceId: voice?.inputDeviceId ?? null,
      noiseSuppression: voice?.noiseSuppression ?? true,
      echoCancellation: voice?.echoCancellation ?? true,
      pushToTalk: voice?.inputMode === 'push-to-talk',
    });
    call.muted = get().selfMuted;
    call.deafened = get().selfDeafened;
    set({ call, callError: null });
    try {
      await call.start();
      play('selfJoin');
      sendVoiceState();
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
    if (call) play('selfLeave');
    await call?.leave();
  },

  toggleMute: () => {
    const { selfMuted, selfDeafened } = get();
    // Unmuting while deafened also undeafens, like most voice apps.
    if (selfMuted && selfDeafened) {
      set({ selfMuted: false, selfDeafened: false });
      get().call?.setDeafened(false);
    } else set({ selfMuted: !selfMuted });
    get().call?.setMuted(get().selfMuted);
    play(get().selfMuted ? 'mute' : 'unmute');
    sendVoiceState();
  },

  toggleDeafen: () => {
    const deafened = !get().selfDeafened;
    set({ selfDeafened: deafened, selfMuted: deafened ? true : false });
    get().call?.setDeafened(deafened);
    get().call?.setMuted(get().selfMuted);
    play(deafened ? 'deafen' : 'undeafen');
    sendVoiceState();
  },

  setModal: (modal) => set({ modal }),

  notify: (text, tone = 'info') => {
    if (tone === 'error') play('error');
    window.clearTimeout(toastTimer);
    set({ toast: { text, tone } });
    toastTimer = window.setTimeout(() => set({ toast: null }), 4500);
  },

  run: async (action) => {
    const res = (await window.river.community.action(action)) as Result<CommunityActionResult<typeof action>>;
    if (!res.ok) {
      get().notify(res.message, 'error');
      return null;
    }
    return res.value;
  },
}));

/** Tells the server our mute/deafen/streaming state so others see it. */
export function sendVoiceState(): void {
  const { call, selfMuted, selfDeafened } = useCommunity.getState();
  if (!call) return;
  void window.river.community.action({
    a: 'voiceState',
    muted: selfMuted || (call.pushToTalk && !call.pttActive),
    deafened: selfDeafened,
    streaming: !!call.localTrack('screen'),
  });
}

function applyCommunities(communities: CommunityView[]): void {
  const s = useCommunity.getState();
  useCommunity.setState({ communities });
  const current = communities.find((c) => c.id === s.selectedCommunity);
  if (!current) {
    if (communities[0]) useCommunity.getState().select(communities[0].id);
    else useCommunity.setState({ selectedCommunity: null, selectedChannel: null });
  } else if (s.selectedChannel && !current.channels.some((ch) => ch.id === s.selectedChannel)) {
    // The channel was deleted or hidden from us.
    useCommunity.getState().select(current.id);
  }
}

/** Names of people typing in a channel right now (excluding me). */
export function typingNames(channelId: string, community: CommunityView | undefined, me: string): string[] {
  const entries = useCommunity.getState().typing[channelId] ?? {};
  const now = Date.now();
  return Object.entries(entries)
    .filter(([id, at]) => id !== me && now - at < TYPING_MS)
    .map(([id]) => community?.members.find((m) => m.riverId === id)?.name ?? 'Someone');
}
