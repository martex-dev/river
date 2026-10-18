import { create } from 'zustand';
import { useCommunity } from '../community/store.ts';
import { useDm } from '../dm/store.ts';
import { useRiver, type Section } from '../store.ts';

/**
 * Where the phone shell is (2.12): a tab at the bottom, and a stack of screens pushed over it
 * (a conversation, a community's channels, a channel, Friends…), like Telegram. Back pops the
 * stack; River opening something by itself (a notification, an accepted call, the share sheet,
 * the quick switcher) pushes the screen for it.
 *
 * The screens show what River's own stores hold: opening a conversation selects it in the DM
 * store, leaving it selects nothing again (so new messages count as unread while you are not
 * looking), and the same for a community channel.
 */

export type PhoneTab = 'chats' | 'communities' | 'calls' | 'feed' | 'profile';
export const PHONE_TABS: readonly PhoneTab[] = ['chats', 'communities', 'calls', 'feed', 'profile'];

export type PhoneScreen =
  | { kind: 'chat'; peer: string }
  | { kind: 'community'; id: string }
  | { kind: 'channel'; communityId: string; channelId: string }
  | { kind: 'friends' }
  | { kind: 'files' }
  /** Create or join a community. */
  | { kind: 'start' };

interface PhoneNavState {
  tab: PhoneTab;
  stack: PhoneScreen[];
  /** The screen sliding away after Back, shown until its animation ends. */
  leaving: PhoneScreen | null;
  /** How the last change happened, for the animation: a push slides in, a tab fades. */
  motion: 'push' | 'pop' | 'tab' | 'none';
}

export const usePhoneNav = create<PhoneNavState>(() => ({
  tab: 'chats',
  stack: [],
  leaving: null,
  motion: 'none',
}));

/** The River section each tab stands for (messages read while open, the call pill…). */
const SECTION_OF: Record<PhoneTab, Section> = {
  chats: 'messages',
  communities: 'communities',
  calls: 'calls',
  feed: 'social',
  profile: 'home',
};

export function screenKey(s: PhoneScreen): string {
  switch (s.kind) {
    case 'chat':
      return `chat:${s.peer}`;
    case 'community':
      return `community:${s.id}`;
    case 'channel':
      return `channel:${s.channelId}`;
    default:
      return s.kind;
  }
}

/** The screen on top, or null on a tab's own page. */
export function topScreen(): PhoneScreen | null {
  return usePhoneNav.getState().stack.at(-1) ?? null;
}

const LEAVE_MS = 260;
let leaveTimer: ReturnType<typeof setTimeout> | undefined;

function reducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';
}

/** What leaving a screen means for River's stores: nothing is open there any more. */
function leave(s: PhoneScreen): void {
  // Opened again meanwhile (River opened it by itself): it stays open.
  if (usePhoneNav.getState().stack.some((x) => screenKey(x) === screenKey(s))) return;
  switch (s.kind) {
    case 'chat':
      if (useDm.getState().selected === s.peer) useDm.getState().select(null);
      return;
    case 'channel': {
      const c = useCommunity.getState();
      if (c.selectedChannel !== s.channelId) return;
      // Leaving a channel counts as reading it up to now, as switching channels does.
      void window.river.community.action({ a: 'markRead', channelId: s.channelId });
      useCommunity.setState({
        selectedChannel: null,
        readAt: { ...c.readAt, [s.channelId]: new Date().toISOString() },
        openThread: null,
        showMembers: false,
        showSearch: false,
        showPins: false,
        showSaved: false,
        replyTo: null,
        editing: null,
        selecting: null,
      });
      return;
    }
    case 'start':
      if (useRiver.getState().communityStart) useRiver.getState().setCommunityStart(false);
      return;
    default:
      return;
  }
}

function setStack(next: PhoneScreen[], motion: PhoneNavState['motion'], tab?: PhoneTab): void {
  const before = usePhoneNav.getState().stack;
  const keys = new Set(next.map(screenKey));
  const removed = before.filter((s) => !keys.has(screenKey(s)));
  const popped = motion === 'pop' && !reducedMotion() ? (before.at(-1) ?? null) : null;
  clearTimeout(leaveTimer);
  usePhoneNav.setState({ stack: next, motion, leaving: popped, ...(tab ? { tab } : {}) });
  if (popped) leaveTimer = setTimeout(() => usePhoneNav.setState({ leaving: null }), LEAVE_MS);
  for (const s of removed) leave(s);
  followTop();
}

/**
 * River's section follows what is on screen, so messages in the open conversation or channel
 * count as read (and the call pill hides there), and nowhere else.
 */
function followTop(): void {
  const { stack, tab } = usePhoneNav.getState();
  const top = stack.at(-1);
  const want: Section | null = !top
    ? SECTION_OF[tab]
    : top.kind === 'chat'
      ? 'messages'
      : top.kind === 'channel' || top.kind === 'community'
        ? 'communities'
        : null;
  if (want && useRiver.getState().section !== want) useRiver.setState({ section: want });
}

/** Opens a screen on top (or goes back to it, if it is already in the stack). */
export function phonePush(screen: PhoneScreen): void {
  const { stack } = usePhoneNav.getState();
  const key = screenKey(screen);
  const at = stack.findIndex((s) => screenKey(s) === key);
  if (at === stack.length - 1 && at >= 0) return;
  if (at >= 0) setStack(stack.slice(0, at + 1), 'pop');
  else setStack([...stack, screen], 'push');
}

/** Back from the screen on top. False when a tab's own page is showing. */
export function phonePop(): boolean {
  const { stack } = usePhoneNav.getState();
  if (stack.length === 0) return false;
  setStack(stack.slice(0, -1), 'pop');
  return true;
}

/** Shows a tab's own page (choosing the tab you are on goes back to its page). */
export function phoneTab(tab: PhoneTab): void {
  const s = usePhoneNav.getState();
  if (s.tab === tab && s.stack.length === 0) return;
  setStack([], s.tab === tab ? 'pop' : 'tab', tab);
  const section = SECTION_OF[tab];
  const river = useRiver.getState();
  if (river.section !== section) river.navigate(section);
}

/**
 * The phone's Back (Android's button, an iPhone's swipe from the left edge): the screen on top
 * closes; on a tab's own page, Back goes to Chats; on Chats, River lets the phone leave the app.
 */
export function phoneBack(): boolean {
  if (phonePop()) return true;
  if (usePhoneNav.getState().tab !== 'chats') {
    phoneTab('chats');
    return true;
  }
  return false;
}

/**
 * The community you just joined from the first screen (2.14): the Communities tab with it open,
 * set up before the phone shell is on screen (it follows later changes by itself).
 */
export function phoneShowCommunity(id: string): void {
  setStack([{ kind: 'community', id }], 'tab', 'communities');
}

/** Opens a conversation (selecting it in River's store). */
export function openPhoneChat(peer: string): void {
  useDm.getState().select(peer);
  if (useRiver.getState().section !== 'messages') useRiver.getState().navigate('messages');
  showChat(peer);
}

function showChat(peer: string): void {
  const { stack } = usePhoneNav.getState();
  if (stack.at(-1)?.kind === 'chat' && screenKey(stack.at(-1)!) === `chat:${peer}`) return;
  // One conversation at a time: another one replaces it.
  setStack([...stack.filter((s) => s.kind !== 'chat'), { kind: 'chat', peer }], 'push');
}

function showChannel(communityId: string, channelId: string): void {
  const s = usePhoneNav.getState();
  const top = s.stack.at(-1);
  if (top?.kind === 'channel' && top.channelId === channelId) return;
  setStack(
    [
      { kind: 'community', id: communityId },
      { kind: 'channel', communityId, channelId },
    ],
    'push',
    'communities',
  );
}

/** River changed section by itself: show the tab (or screen) for it. */
function followSection(section: Section): void {
  const nav = usePhoneNav.getState();
  switch (section) {
    case 'calls':
      if (nav.tab !== 'calls') phoneTab('calls');
      return;
    case 'social':
      if (nav.tab !== 'feed') phoneTab('feed');
      return;
    case 'contacts':
      phonePush({ kind: 'friends' });
      return;
    case 'files':
      phonePush({ kind: 'files' });
      return;
    case 'communities':
      if (
        nav.tab !== 'communities' &&
        !nav.stack.some((s) => s.kind === 'community' || s.kind === 'channel' || s.kind === 'start')
      )
        phoneTab('communities');
      return;
    default:
      return;
  }
}

/**
 * Follows River's own navigation (notifications, calls, links, the switcher, the share sheet):
 * a conversation or channel that gets selected opens on top. Returns the unsubscribe function.
 */
export function startPhoneSync(): () => void {
  const offDm = useDm.subscribe((s, prev) => {
    if (s.selected && s.selected !== prev.selected) showChat(s.selected);
  });
  const offCommunity = useCommunity.subscribe((s, prev) => {
    if (s.selectedChannel && s.selectedChannel !== prev.selectedChannel) {
      const id = s.selectedChannel;
      const community = s.communities.find((c) => c.channels.some((ch) => ch.id === id));
      if (community) showChannel(community.id, id);
    }
    if (s.communities !== prev.communities) {
      // A community you left (or that was deleted), or a channel that is gone, closes.
      const { stack } = usePhoneNav.getState();
      const kept = stack.filter((x) => {
        if (x.kind === 'community') return s.communities.some((c) => c.id === x.id);
        if (x.kind === 'channel')
          return s.communities.some(
            (c) => c.id === x.communityId && c.channels.some((ch) => ch.id === x.channelId),
          );
        return true;
      });
      if (kept.length !== stack.length) setStack(kept, 'pop');
    }
  });
  const offRiver = useRiver.subscribe((s, prev) => {
    if (s.section !== prev.section) followSection(s.section);
    if (s.communityStart && !prev.communityStart) {
      if (usePhoneNav.getState().tab !== 'communities') setStack([], 'tab', 'communities');
      phonePush({ kind: 'start' });
    }
    if (!s.communityStart && prev.communityStart && topScreen()?.kind === 'start') phonePop();
  });
  // Tapping the channel that is already selected (the one you were last in) changes nothing in
  // the store, so nothing above opens it: open it here, after the row's own click handler ran.
  const onClick = (e: MouseEvent): void => {
    const row = (e.target as Element | null)?.closest?.('.channel__open');
    if (!row) return;
    const id = useCommunity.getState().selectedChannel;
    const top = topScreen();
    if (!id || (top?.kind === 'channel' && top.channelId === id)) return;
    const community = useCommunity.getState().communities.find((c) => c.channels.some((ch) => ch.id === id));
    if (community) showChannel(community.id, id);
  };
  if (typeof document !== 'undefined') document.addEventListener('click', onClick);
  return () => {
    offDm();
    offCommunity();
    offRiver();
    if (typeof document !== 'undefined') document.removeEventListener('click', onClick);
  };
}
