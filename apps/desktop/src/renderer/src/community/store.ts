import { create } from 'zustand';
import { Permission } from '@river/protocol/permissions';
import type {
  CommunityAction,
  CommunityActionResult,
  HistoryPage,
} from '../../../shared/community-actions.ts';
import type { ChatMessage, CommunityEvent, CommunityView, Result } from '../../../shared/ipc.ts';
import { useRiver } from '../store.ts';
import { setMessageLinkOpener } from './message-link.ts';
import type {
  EmojiView,
  EventView,
  ReportView,
  SavedMessageView,
  SoundView,
  StickerView,
} from '../../../shared/community-actions.ts';
import { playLocally } from './soundboard-player.ts';
import { alertForReply, setFollowing } from './thread-follow.ts';
import {
  countsMention,
  effectiveNotify,
  newReactions,
  shouldAlert,
  silenced,
} from '../../../shared/notify-rules.ts';
import { play } from './sound.ts';
import { VoiceCall } from './voice.ts';
import { WebCodecsRelay } from './relay-audio.ts';
import { forgetCall, rememberCall } from './rejoin.ts';
import { resumeAudio } from './peer-audio.ts';
import { phoneShellActive } from '../phone/mode.ts';
import { withLiveMessages } from '../components/unread.ts';

export type Modal =
  | { kind: 'community-settings'; communityId: string; tab?: CommunityTab }
  | { kind: 'channel-settings'; channelId: string }
  | { kind: 'create-channel'; communityId: string; channelKind: 'text' | 'voice'; parentId?: string }
  | { kind: 'category'; communityId: string; categoryId?: string }
  | { kind: 'invite'; communityId: string }
  | { kind: 'join-invite'; link: string }
  | { kind: 'signup'; link: string }
  | { kind: 'nickname'; communityId: string }
  | { kind: 'add-friend'; riverId: string; serverUrl: string }
  | { kind: 'events'; communityId: string }
  | { kind: 'report'; communityId: string; message: ChatMessage }
  | { kind: 'pick-roles'; communityId: string }
  | { kind: 'ban'; communityId: string; riverId: string; name: string; then?: Modal }
  | { kind: 'confirm'; title: string; body: string; action: string; run: () => Promise<void> };

export type CommunityTab =
  | 'overview'
  | 'onboarding'
  | 'invites'
  | 'webhooks'
  | 'roles'
  | 'members'
  | 'emoji'
  | 'stickers'
  | 'sounds'
  | 'bans'
  | 'reports'
  | 'insights'
  | 'audit';

const TYPING_MS = 7000;

interface CommunityState {
  loaded: boolean;
  error: string | null;
  connection: 'online' | 'offline' | 'connecting';
  /** When the connection state last changed, and when the next reconnection attempt is. */
  connectionSince: number;
  retryAt: number | null;
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
  /** On a stage: asking to speak (1.0.22). */
  handRaised: boolean;
  modal: Modal | null;
  toast: { text: string; tone: 'info' | 'error' } | null;
  replyTo: ChatMessage | null;
  editing: string | null;
  showMembers: boolean;
  showPins: boolean;
  showSearch: boolean;
  /** The thread open in the side panel. */
  openThread: { channelId: string; rootId: string } | null;
  /** Loaded thread replies, by starting message. */
  threads: Record<string, ChatMessage[]>;
  showThread(channelId: string, rootId: string): Promise<void>;
  /** Clears unread and mention counts for these channels and remembers them as read. */
  markChannelsRead(channelIds: string[]): void;
  /** Makes a message and everything after it count as new again. */
  markUnreadFrom(message: ChatMessage): void;
  /** Channels whose older history is exhausted. */
  noMore: Record<string, boolean>;
  /** Channels whose newest messages could not be loaded (2.13.1): the chat offers Retry. */
  historyFailed: Record<string, boolean>;
  /** A message to scroll to and flash once its channel shows it (message links, search). */
  pendingJump: { channelId: string; messageId: string } | null;
  /** Opens a message: its community and channel, then scrolls to it. False if you cannot see it. */
  openMessage(communityId: string, channelId: string, messageId: string): boolean;
  /** Text to put in front of the composer's draft (Quote). */
  draftInsert: string | null;
  /** Scheduled events per community, once loaded (1.0.18). */
  events: Record<string, EventView[]>;
  loadEvents(communityId: string): Promise<void>;
  /** Custom emoji per community, once loaded (1.0.19). */
  emojis: Record<string, EmojiView[]>;
  loadEmojis(communityId: string): Promise<void>;
  /** Saved messages (1.0.19); null until loaded. */
  saved: SavedMessageView[] | null;
  showSaved: boolean;
  loadSaved(): Promise<void>;
  toggleSaved(channelId: string, messageId: string, on: boolean): Promise<void>;
  loadOlder(channelId: string): Promise<number>;
  /** Stickers per community (1.0.24), loaded on first use. */
  stickers: Record<string, StickerView[]>;
  loadStickers(communityId: string): Promise<void>;
  /** Moderators picking messages to delete together (1.0.24). */
  selecting: { channelId: string; ids: string[] } | null;
  /** Reports per community (1.0.21), loaded when a moderator opens them. */
  reports: Record<string, ReportView[]>;
  loadReports(communityId: string): Promise<void>;
  /** Soundboard sounds per community (1.0.22), loaded on first use. */
  sounds: Record<string, SoundView[]>;
  loadSounds(communityId: string): Promise<SoundView[] | null>;

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

/**
 * Keeps the toast on screen while the pointer is on it (it is being read, or its text selected)
 * and gives it a little longer once the pointer leaves (2.13.1).
 */
export function holdToast(hold: boolean): void {
  window.clearTimeout(toastTimer);
  if (!hold) toastTimer = window.setTimeout(() => useCommunity.setState({ toast: null }), 2500);
}

/**
 * The voice join underway, if any. Set synchronously when Join is pressed, so a
 * second click while the first is still opening the microphone does nothing.
 * Disconnect while joining marks it cancelled; it stays set until that join has
 * finished unwinding, so a newer join never overlaps it.
 */
let joining: { cancelled: boolean } | null = null;
/** Whether you were muted before deafening, so undeafening puts that back. */
let mutedBeforeDeafen = false;

/** Requests for a channel's newest page on their way (opening it twice at once asks once). */
const newestInFlight = new Map<string, Promise<void>>();

/** "Load older" requests on their way, per channel. */
const olderInFlight = new Map<string, Promise<number>>();

/**
 * Where the next older page of a channel starts, as main reported it (2.12): the oldest message
 * the server sent, opened or not. Valid while the oldest message shown is still `anchor`; when
 * the list changed at its start (reloaded), the oldest message shown is the cursor again.
 */
const olderCursor = new Map<string, { before: string; beforeId?: string; anchor: string | null }>();
/** Pages one "Load older" may walk through when none of them brings a message this device can open. */
const OLDER_PAGES_PER_LOAD = 10;

/**
 * Whether to offer older messages. From main's answer once known (it counts what the server sent,
 * so a page of messages from before you joined does not hide the rest); until then the guess.
 */
export function canLoadOlder(noMore: Record<string, boolean>, channelId: string, shown: number): boolean {
  const known = noMore[channelId];
  return known === undefined ? shown >= 100 : !known;
}

/** The last text channel opened in each community, on this device (a convenience; may be unavailable). */
function lastChannel(communityId: string): string | null {
  try {
    return localStorage.getItem(`river.lastChannel.${communityId}`);
  } catch {
    return null;
  }
}
function rememberChannel(communityId: string, channelId: string): void {
  try {
    localStorage.setItem(`river.lastChannel.${communityId}`, channelId);
  } catch {
    // private storage unavailable
  }
}

/** Remembers (on this device, encrypted) that a channel was read up to now. */
const markRead = (channelId: string): Promise<unknown> =>
  window.river.community.action({ a: 'markRead', channelId }).catch(() => undefined);

/** A person's name from any shared community (for the "can see your screen" bar). */
function nameOfPerson(communities: CommunityView[], id: string): string {
  for (const c of communities) {
    const m = c.members.find((x) => x.riverId === id);
    if (m) return m.name;
  }
  return 'Someone';
}

export const useCommunity = create<CommunityState>((set, get) => ({
  loaded: false,
  error: null,
  connection: 'offline',
  connectionSince: Date.now(),
  retryAt: null,
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
  handRaised: false,
  modal: null,
  toast: null,
  replyTo: null,
  editing: null,
  // On narrow windows the member list is an overlay, so start with it closed.
  showMembers: typeof window === 'undefined' || window.innerWidth >= 1100,
  showPins: false,
  showSearch: false,
  openThread: null,
  threads: {},
  markChannelsRead: (channelIds) => {
    const unread = { ...get().unread };
    const mentions = { ...get().mentions };
    const now = new Date().toISOString();
    const readAt = { ...get().readAt };
    for (const id of channelIds) {
      delete unread[id];
      delete mentions[id];
      readAt[id] = now;
      void markRead(id);
    }
    set({ unread, mentions, readAt });
  },
  markUnreadFrom: (m) => {
    const before = new Date(Date.parse(m.sentAt) - 1).toISOString();
    set({
      divider: { channelId: m.channelId, after: before },
      readAt: { ...get().readAt, [m.channelId]: before },
    });
    void window.river.community.action({ a: 'markUnread', channelId: m.channelId, from: m.sentAt });
  },
  showThread: async (channelId, rootId) => {
    set({ openThread: { channelId, rootId }, showMembers: false, showPins: false, showSearch: false });
    const res = await window.river.community.action({ a: 'threadMessages', channelId, messageId: rootId });
    if (res.ok) set({ threads: { ...get().threads, [rootId]: res.value as ChatMessage[] } });
  },
  noMore: {},
  historyFailed: {},

  selecting: null,
  stickers: {},
  loadStickers: async (communityId) => {
    const res = await window.river.community.action({ a: 'stickers', communityId });
    if (res.ok) set({ stickers: { ...get().stickers, [communityId]: res.value } });
  },
  sounds: {},
  loadSounds: async (communityId) => {
    const res = await window.river.community.action({ a: 'sounds', communityId });
    if (!res.ok) return null;
    set({ sounds: { ...get().sounds, [communityId]: res.value } });
    return res.value;
  },
  reports: {},
  loadReports: async (communityId) => {
    const res = await window.river.community.action({ a: 'reports', communityId });
    if (res.ok) set({ reports: { ...get().reports, [communityId]: res.value } });
  },
  loadOlder: (channelId) => {
    // One page at a time per channel: a second request (a quick double press, a jump looking
    // further back) waits for the one on its way instead of adding the same page twice.
    const pending = olderInFlight.get(channelId);
    if (pending) return pending;
    const run = async (): Promise<number> => {
      for (let i = 0; i < OLDER_PAGES_PER_LOAD; i++) {
        const list = get().messages[channelId];
        if (!list || get().noMore[channelId]) return 0;
        const anchor = list[0]?.id ?? null;
        const saved = olderCursor.get(channelId);
        const cursor =
          saved && saved.anchor === anchor
            ? saved
            : list[0]
              ? { before: list[0].sentAt, beforeId: list[0].id }
              : null;
        if (!cursor) return 0;
        const res = await window.river.community.action({
          a: 'historyPage',
          channelId,
          before: cursor.before,
          ...(cursor.beforeId ? { beforeId: cursor.beforeId } : {}),
        });
        const page = res.ok ? (res.value as HistoryPage | null) : null;
        // An answer without a page (an older main, a failure) ends this load, nothing more.
        if (!page || !Array.isArray(page.messages)) return 0;
        // Against the list as it is now (it may have changed while this page was decrypted).
        const now = get().messages[channelId] ?? [];
        const known = new Set(now.map((m) => m.id));
        const older = page.messages.filter((m) => !known.has(m.id));
        const next = [...older, ...now];
        if (page.before)
          olderCursor.set(channelId, {
            before: page.before,
            ...(page.beforeId ? { beforeId: page.beforeId } : {}),
            anchor: next[0]?.id ?? null,
          });
        // The end of the history is what main says: messages this device cannot open (sent
        // before you joined) are left out of a page, so an empty page alone does not mean it.
        const noMore = !page.hasMore || !page.before;
        set({
          messages: { ...get().messages, [channelId]: next },
          ...(noMore ? { noMore: { ...get().noMore, [channelId]: true } } : {}),
        });
        if (older.length || noMore) return older.length;
      }
      return 0;
    };
    const promise = run().finally(() => olderInFlight.delete(channelId));
    olderInFlight.set(channelId, promise);
    return promise;
  },

  load: async () => {
    const [res, connection] = await Promise.all([
      window.river.community.list(),
      window.river.community.connection(),
    ]);
    set({ connection });
    if (res.ok) applyCommunities(res.value);
    set({ loaded: true, error: res.ok ? null : res.message });
    // Messages that were still on their way when River closed.
    if (res.ok) void import('./outbox.ts').then((m) => m.useOutbox.getState().restore());
  },

  handle: (event) => {
    const settings = useRiver.getState().settings;
    switch (event.t) {
      case 'communities':
        applyCommunities(event.communities);
        return;
      case 'connection': {
        const was = get().connection;
        const away = Date.now() - get().connectionSince;
        // Back online: participant lists refill as people reconnect; keep working calls meanwhile.
        if (event.state === 'online' && was !== 'online') get().call?.resumed();
        set({
          connection: event.state,
          retryAt: event.retryAt ?? null,
          ...(event.state !== was ? { connectionSince: Date.now() } : {}),
        });
        // Only celebrate a comeback the user could have noticed.
        if (event.state === 'online' && was !== 'online' && away > 3000 && get().loaded) {
          play('success');
          get().notify('Back online');
        }
        return;
      }
      case 'catchUp': {
        // Counts from catching up never lower what this session already counted.
        const merge = (
          now: Record<string, number>,
          found: Record<string, number>,
        ): Record<string, number> => {
          const out = { ...now };
          for (const [id, n] of Object.entries(found)) {
            if (id === get().selectedChannel || n <= 0) continue;
            out[id] = Math.max(out[id] ?? 0, n);
          }
          return out;
        };
        set({ unread: merge(get().unread, event.unread), mentions: merge(get().mentions, event.mentions) });
        return;
      }
      case 'message': {
        const m = event.message;
        // The channel's notification level and mute (its own, its category's, its community's).
        const category =
          get()
            .communities.find((c) => c.id === m.communityId)
            ?.channels.find((ch) => ch.id === m.channelId)?.parentId ?? null;
        const notify = settings
          ? effectiveNotify(settings.notifications, m.communityId, m.channelId, Date.now(), category)
          : null;
        if (m.threadId) {
          // A reply inside a thread: it belongs to the thread, not the channel.
          const replies = get().threads[m.threadId];
          if (replies) {
            const i = replies.findIndex((x) => x.id === m.id);
            const next = i >= 0 ? replies.map((x) => (x.id === m.id ? m : x)) : [...replies, m];
            set({ threads: { ...get().threads, [m.threadId]: next } });
          }
          if (event.isNew && m.mine) setFollowing(m.threadId, true);
          // A mention in a thread follows the channel's level like any mention (not under Nothing).
          if (event.isNew && !m.mine && m.mentionsMe) {
            if (!notify || shouldAlert(notify, true)) play('mention');
          } else if (event.isNew) {
            const viewing = get().openThread?.rootId === m.threadId && document.hasFocus();
            const quiet = settings ? silenced(settings) : false;
            // Followed threads speak up unless the channel is muted or set to Nothing.
            const allowed = !notify || (!notify.muted && notify.level !== 'nothing');
            if (!quiet && allowed && alertForReply(m.threadId, m.mine, viewing)) {
              play('message');
              get().notify(`${m.senderName} replied in a thread you follow.`);
            }
          }
          return;
        }
        const list = get().messages[m.channelId];
        // Someone reacted to your message (if you asked to be told).
        const before = list?.find((x) => x.id === m.id);
        if (before && m.mine && !event.isNew && settings?.notifications.reactions && !silenced(settings)) {
          const added = newReactions(
            before.reactions,
            m.reactions,
            useRiver.getState().identity?.riverId ?? '',
          );
          if (added.length) {
            const community = get().communities.find((c) => c.id === m.communityId);
            const who = community?.members.find((x) => x.riverId === added[0]!.user)?.name ?? 'Someone';
            const emoji = added[0]!.emoji.startsWith('<') ? 'an emoji' : added[0]!.emoji;
            play('reaction');
            get().notify(`${who} reacted ${emoji} to your message.`);
          }
        }
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
          // No mention badge where you asked for Nothing.
          if (m.mentionsMe && (!notify || countsMention(notify))) {
            set({ mentions: { ...get().mentions, [m.channelId]: (get().mentions[m.channelId] ?? 0) + 1 } });
          }
        }
        // Muted channels and communities stay quiet; @mentions still come through (unless set to Nothing).
        const alert = notify ? shouldAlert(notify, m.mentionsMe) : true;
        if (!alert) return;
        if (m.mentionsMe) play('mention');
        else if (!viewing) play('message');
        return;
      }
      case 'messageDelete': {
        const list = get().messages[event.channelId];
        if (list) {
          set({
            messages: { ...get().messages, [event.channelId]: list.filter((m) => m.id !== event.messageId) },
          });
        }
        // A reply inside a thread goes from that thread's loaded replies too.
        const threads = get().threads;
        let changed = false;
        const next: Record<string, ChatMessage[]> = {};
        for (const [root, replies] of Object.entries(threads)) {
          const kept = replies.filter((m) => m.id !== event.messageId);
          if (kept.length !== replies.length) changed = true;
          next[root] = kept;
        }
        if (changed) set({ threads: next });
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
          const wasMuted = call.serverMuted;
          call.setServerMuted(event.states[me]?.serverMuted ?? false);
          // Invited onto a stage (or moved back): the raised hand is done.
          if (wasMuted !== call.serverMuted && get().handRaised) set({ handRaised: false });
          if (
            wasMuted &&
            !call.serverMuted &&
            get().communities.some((c) => c.channels.some((ch) => ch.id === event.channelId && ch.stage))
          )
            get().notify('You can speak now.');
          const deafenedNow = event.states[me]?.serverDeafened ?? false;
          if (deafenedNow !== call.serverDeafened)
            get().notify(deafenedNow ? 'A moderator deafened you.' : 'A moderator undeafened you.');
          call.setServerDeafened(deafenedNow);
          call.updateParticipants(event.participants);
        }
        return;
      }
      case 'serverMoved':
        get().notify('Your server moved to a new address. River followed it automatically.');
        return;
      case 'voiceRefused': {
        const call = get().call;
        if (call && !call.channelId.startsWith('dm:')) {
          set({ call: null });
          forgetCall();
          void call.leave();
        }
        play('error');
        get().notify(
          event.reason === 'full' ? 'That voice channel is full.' : "You can't join that voice channel.",
          'error',
        );
        return;
      }
      case 'hangUp': {
        const call = get().call;
        if (!call) return;
        if (call.channelId.startsWith('dm:')) void import('../dm/call.ts').then((m) => m.endDmCall());
        else void get().leaveVoice();
        return;
      }
      case 'stopScreenShare': {
        // The Stop button on the "can see your screen" bar, outside River's window.
        void get().call?.setScreen(false);
        return;
      }
      case 'voiceDisconnect': {
        const call = get().call;
        // About a voice channel only: a 1:1 call is not in one, and ends only by its own signals.
        if (!call || call.channelId.startsWith('dm:')) return;
        set({ call: null });
        // A moderator ended it: do not offer to rejoin.
        forgetCall();
        void call.leave();
        if (event.moveTo) {
          // Moved by a moderator (1.0.39): follow into the other channel.
          const dest = get()
            .communities.flatMap((c) => c.channels)
            .find((ch) => ch.id === event.moveTo);
          get().notify(`A moderator moved you to ${dest ? dest.name : 'another voice channel'}.`);
          void get().joinVoice(event.moveTo, call.me);
          return;
        }
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
        get().select(event.communityId, event.channelId || undefined);
        return;
      case 'events':
        // Only refresh lists someone has looked at.
        if (get().events[event.communityId]) void get().loadEvents(event.communityId);
        return;
      case 'emojis':
        if (get().emojis[event.communityId]) void get().loadEmojis(event.communityId);
        return;
      case 'reports':
        if (get().reports[event.communityId]) void get().loadReports(event.communityId);
        return;
      case 'sounds':
        if (get().sounds[event.communityId]) void get().loadSounds(event.communityId);
        return;
      case 'stickers':
        if (get().stickers[event.communityId]) void get().loadStickers(event.communityId);
        return;
      case 'voiceSound': {
        const call = get().call;
        if (!call || call.hearingOff) return;
        const volume = useRiver.getState().settings?.voice.soundboardVolume ?? 0.6;
        // Muting someone for yourself (volume 0) silences their sounds too.
        const personal = useRiver.getState().settings?.voice.userVolumes[event.from] ?? 1;
        if (volume <= 0 || personal <= 0) return;
        const known = get().sounds[event.communityId]?.find((x) => x.id === event.soundId);
        const go = (list: SoundView[] | null | undefined): void => {
          const sound = list?.find((x) => x.id === event.soundId);
          if (sound) playLocally(sound, volume * Math.min(1, personal));
        };
        if (known) go([known]);
        else void get().loadSounds(event.communityId).then(go);
        return;
      }
      case 'refused':
        get().notify(
          event.reason === 'slow_down' ? 'Slow down a little.' : "You don't have permission to do that.",
          'error',
        );
        return;
      case 'eventStarting':
        play('success');
        get().notify(`${event.name} is starting now.`);
        return;
      case 'signal': {
        const call = get().call;
        if (call && call.channelId === event.channelId) void call.handleSignal(event.from, event.data);
        return;
      }
    }
  },

  pendingJump: null,
  draftInsert: null,
  saved: null,
  showSaved: false,
  loadSaved: async () => {
    const res = await window.river.community.action({ a: 'savedMessages' });
    if (res.ok) set({ saved: res.value });
  },
  toggleSaved: async (channelId, messageId, on) => {
    const res = await window.river.community.action({ a: 'saveMessage', channelId, messageId, on });
    if (!res.ok) return get().notify(res.message, 'error');
    await get().loadSaved();
    if (on) get().notify('Saved. Find it under 🔖 Saved messages.');
  },
  emojis: {},
  loadEmojis: async (communityId) => {
    const res = await window.river.community.action({ a: 'emojis', communityId });
    if (res.ok) set({ emojis: { ...get().emojis, [communityId]: res.value } });
  },
  events: {},
  loadEvents: async (communityId) => {
    const res = await window.river.community.action({ a: 'events', communityId });
    if (res.ok) set({ events: { ...get().events, [communityId]: res.value } });
  },
  openMessage: (communityId, channelId, messageId) => {
    const c = get().communities.find((x) => x.id === communityId);
    if (!c || !c.channels.some((ch) => ch.id === channelId)) {
      get().notify("You can't see that message: it's in a community or channel you're not in.", 'error');
      return false;
    }
    useRiver.getState().navigate('communities');
    if (get().selectedCommunity !== communityId) get().select(communityId, channelId);
    else if (get().selectedChannel !== channelId) get().selectChannel(channelId);
    set({ pendingJump: { channelId, messageId } });
    return true;
  },

  select: (communityId, channelId) => {
    const c = get().communities.find((x) => x.id === communityId);
    // Back where you were in this community (remembered on this device), else its first text channel.
    const remembered = lastChannel(communityId);
    const channel =
      channelId ??
      (remembered && c?.channels.some((ch) => ch.id === remembered && ch.kind === 'text')
        ? remembered
        : null) ??
      c?.channels.find((ch) => ch.kind === 'text')?.id ??
      c?.channels[0]?.id ??
      null;
    // selectChannel switches the channel itself, so it still knows the one you are leaving
    // (in the other community) and marks it read.
    set({
      selectedCommunity: communityId,
      ...(channel ? {} : { selectedChannel: null }),
      replyTo: null,
      editing: null,
    });
    if (!get().emojis[communityId]) void get().loadEmojis(communityId);
    if (!get().stickers[communityId]) void get().loadStickers(communityId);
    if (get().saved === null) void get().loadSaved();
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
    set({
      selectedChannel: channelId,
      unread,
      mentions,
      replyTo: null,
      editing: null,
      showPins: false,
      selecting: null,
    });
    if (channel?.kind === 'text') {
      const owner = get().communities.find((c) => c.channels.some((ch) => ch.id === channelId));
      if (owner) rememberChannel(owner.id, channelId);
    }
    void get().loadMessages(channelId);
  },

  loadMessages: (channelId) => {
    const pending = newestInFlight.get(channelId);
    if (pending) return pending;
    const promise = loadNewest(channelId).finally(() => newestInFlight.delete(channelId));
    newestInFlight.set(channelId, promise);
    return promise;
  },

  joinVoice: async (channelId, me) => {
    if (joining) return;
    // Still inside the click: wake the audio engine now (phones only allow it from a gesture).
    resumeAudio();
    // Don't even try a full channel unless you may move members (the server checks too).
    const community = get().communities.find((c) => c.channels.some((ch) => ch.id === channelId));
    const target = community?.channels.find((ch) => ch.id === channelId);
    const inside = community?.voice[channelId] ?? [];
    if (
      target &&
      target.userLimit > 0 &&
      inside.length >= target.userLimit &&
      !inside.includes(me) &&
      (target.permissions & Permission.MOVE_MEMBERS) === 0
    ) {
      play('error');
      get().notify('That voice channel is full.', 'error');
      return;
    }
    const token = { cancelled: false };
    joining = token;
    try {
      await joinVoiceNow(channelId, me, token);
    } finally {
      if (joining === token) joining = null;
    }
  },

  leaveVoice: async () => {
    if (joining) joining.cancelled = true;
    const call = get().call;
    set({ call: null, handRaised: false });
    forgetCall();
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
    // Deafening also mutes; undeafening unmutes only if you were not muted before.
    if (deafened) mutedBeforeDeafen = get().selfMuted;
    set({ selfDeafened: deafened, selfMuted: deafened ? true : mutedBeforeDeafen });
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
    // Errors stay longer: they usually say what to do.
    toastTimer = window.setTimeout(() => set({ toast: null }), tone === 'error' ? 7000 : 4500);
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

/** The body of loadMessages: the channel's newest page from main. */
async function loadNewest(channelId: string): Promise<void> {
  const get = useCommunity.getState;
  const set = useCommunity.setState;
  const c = get().communities.find((x) => x.channels.some((ch) => ch.id === channelId));
  if (c?.channels.find((ch) => ch.id === channelId)?.kind !== 'text') return;
  const res = await window.river.community.action({ a: 'historyPage', channelId });
  const page = res.ok ? (res.value as HistoryPage | null) : null;
  if (!page || !Array.isArray(page.messages)) {
    // Shown in the channel with Retry, instead of an empty channel or a skeleton forever.
    if (!get().messages[channelId]) set({ historyFailed: { ...get().historyFailed, [channelId]: true } });
    return;
  }
  const { [channelId]: _failed, ...historyFailed } = get().historyFailed;
  const messages = withLiveMessages(page.messages, get().messages[channelId]);
  // The newest page replaces what was loaded, so older history can be loaded again; whether
  // there is any is main's answer, not a guess from how many messages could be opened.
  olderCursor.delete(channelId);
  if (page.before)
    olderCursor.set(channelId, {
      before: page.before,
      ...(page.beforeId ? { beforeId: page.beforeId } : {}),
      anchor: messages[0]?.id ?? null,
    });
  set({
    messages: { ...get().messages, [channelId]: messages },
    noMore: { ...get().noMore, [channelId]: !page.hasMore },
    historyFailed,
  });
}

/** The body of joinVoice, once the join is under way (see `joining`). */
async function joinVoiceNow(channelId: string, me: string, token: { cancelled: boolean }): Promise<void> {
  const get = useCommunity.getState;
  const set = useCommunity.setState;
  // Joining voice ends a 1:1 call properly (also one still starting): its panel, pill and "busy" go too.
  const dm = await import('../dm/call.ts');
  if (dm.useDmCall.getState().active || get().call?.channelId.startsWith('dm:')) await dm.endDmCall();
  await get().call?.leave();
  if (token.cancelled) return;
  const voice = useRiver.getState().settings?.voice;
  const iceServers = await window.river.voice.iceServers().catch(() => []);
  if (token.cancelled) return;
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
  // People who cannot connect directly hear each other through the server (encrypted end to end).
  const relay = new WebCodecsRelay(me, (to, payload) => window.river.voice.relay(to, payload));
  const call = new VoiceCall(
    channelId,
    me,
    onChange,
    {
      iceServers,
      inputDeviceId: voice?.inputDeviceId ?? null,
      noiseSuppression: voice?.noiseSuppression ?? true,
      echoCancellation: voice?.echoCancellation ?? true,
      pushToTalk: voice?.inputMode === 'push-to-talk',
      sensitivity: voice?.sensitivity ?? null,
    },
    undefined,
    relay,
  );
  call.muted = get().selfMuted;
  call.deafened = get().selfDeafened;
  call.nameOf = (id) => nameOfPerson(get().communities, id);
  set({ call, callError: null });
  try {
    await call.start();
  } catch (err) {
    // Only this call's failure, and only while it is still the one shown.
    if (get().call === call)
      set({
        call: null,
        callError:
          (err as Error).name === 'NotAllowedError'
            ? 'River could not use your microphone. Allow microphone access in your system settings.'
            : (err as Error).message || 'Could not join the voice channel.',
      });
    return;
  }
  // Disconnected (or replaced) while joining: start() released the microphone and did not join.
  if (call.closed || get().call !== call) return;
  if (!channelId.startsWith('dm:')) rememberCall(channelId);
  play('selfJoin');
  sendVoiceState();
  // Your entrance sound for this community, if you picked one (1.0.26).
  const community = get().communities.find((c) => c.channels.some((ch) => ch.id === channelId));
  const entrance = community ? voice?.entranceSounds[community.id] : undefined;
  if (entrance)
    window.setTimeout(() => void window.river.community.action({ a: 'playSound', soundId: entrance }), 1200);
}

/** Tells the server our mute/deafen/streaming state so others see it. */
export function sendVoiceState(): void {
  const { call, selfMuted, selfDeafened, handRaised } = useCommunity.getState();
  if (!call) return;
  void window.river.community.action({
    a: 'voiceState',
    muted: selfMuted || (call.pushToTalk && !call.pttActive),
    deafened: selfDeafened,
    streaming: !!call.localTrack('screen'),
    handRaised,
  });
}

function applyCommunities(communities: CommunityView[]): void {
  const s = useCommunity.getState();
  useCommunity.setState({ communities });
  const current = communities.find((c) => c.id === s.selectedCommunity);
  // On a phone (2.12) a community opens on its channel list: nothing is opened (or read) for you.
  const phone = phoneShellActive();
  if (!current) {
    if (communities[0] && !phone) useCommunity.getState().select(communities[0].id);
    else useCommunity.setState({ selectedCommunity: null, selectedChannel: null });
  } else if (s.selectedChannel && !current.channels.some((ch) => ch.id === s.selectedChannel)) {
    // The channel was deleted or hidden from us.
    if (phone) useCommunity.setState({ selectedChannel: null });
    else useCommunity.getState().select(current.id);
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

// Message links (in any message, DM or post) open the message here.
setMessageLinkOpener((l) => useCommunity.getState().openMessage(l.communityId, l.channelId, l.messageId));

/**
 * Leave a voice channel after being alone in it for a while (1.0.26), if the
 * person chose a time in Settings → Voice.
 */
let aloneSince: number | null = null;
setInterval(() => {
  const s = useCommunity.getState();
  const call = s.call;
  const minutes = useRiver.getState().settings?.voice.leaveAloneMinutes ?? 0;
  if (!call || call.channelId.startsWith('dm:') || minutes <= 0) {
    aloneSince = null;
    return;
  }
  const community = s.communities.find((c) => c.channels.some((ch) => ch.id === call.channelId));
  const others = (community?.voice[call.channelId] ?? []).filter(
    (id) => id !== useRiver.getState().identity?.riverId,
  );
  if (others.length > 0) {
    aloneSince = null;
    return;
  }
  aloneSince ??= Date.now();
  if (Date.now() - aloneSince >= minutes * 60_000) {
    aloneSince = null;
    void s.leaveVoice();
    s.notify(`You left voice after ${minutes} minutes alone.`);
  }
}, 15_000);
