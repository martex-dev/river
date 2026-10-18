import './phone.css';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import { useCommunity } from '../community/store.ts';
import { VoicePanel } from '../community/ui/Sidebar.tsx';
import { useDm } from '../dm/store.ts';
import { FilesPage } from '../pages/FilesPage.tsx';
import { FriendsPage } from '../pages/FriendsPage.tsx';
import { Conversation, SafetyNumber } from '../pages/MessagesPage.tsx';
import { SocialPage } from '../pages/SocialPage.tsx';
import { useRiver } from '../store.ts';
import { chatsBadge, missedSince, useCallHistory } from './calls.ts';
import { CallsTab } from './CallsTab.tsx';
import { ChatsTab } from './ChatsTab.tsx';
import { ChannelScreen, CommunitiesTab, CommunityScreen, StartCommunityScreen } from './CommunitiesTab.tsx';
import { ChatsIcon, FeedIcon, GroupsIcon, PhoneCallIcon, ProfileIcon } from './icons.tsx';
import {
  phonePop,
  phoneTab,
  screenKey,
  startPhoneSync,
  topScreen,
  usePhoneNav,
  type PhoneScreen,
  type PhoneTab,
} from './nav.ts';
import { setPhoneShellActive } from './mode.ts';
import { ProfileTab } from './ProfileTab.tsx';
import { countLabel, TabPage, TitledScreen } from './ui.tsx';

const TABS: Array<{ id: PhoneTab; label: string; Icon: (p: { size?: number }) => ReactElement }> = [
  { id: 'chats', label: 'Chats', Icon: ChatsIcon },
  { id: 'communities', label: 'Communities', Icon: GroupsIcon },
  { id: 'calls', label: 'Calls', Icon: PhoneCallIcon },
  { id: 'feed', label: 'Feed', Icon: FeedIcon },
  { id: 'profile', label: 'Settings', Icon: ProfileIcon },
];

/** Screens that take the whole screen: the tab bar hides, as in Telegram. */
const IMMERSIVE = new Set<PhoneScreen['kind']>(['chat', 'channel']);

/**
 * River on a phone (2.12): Telegram and Instagram's layout over River's own pages and stores.
 * A tab bar at the bottom (Chats, Communities, Calls, Feed, Settings) and screens pushed over it.
 * The computer keeps its own layout (App.tsx).
 */
export function PhoneShell({ notices }: { notices?: ReactNode }): ReactElement {
  const tab = usePhoneNav((s) => s.tab);
  const stack = usePhoneNav((s) => s.stack);
  const leaving = usePhoneNav((s) => s.leaving);
  const motion = usePhoneNav((s) => s.motion);
  const accountState = useRiver((r) => r.account.state);

  useEffect(() => {
    setPhoneShellActive(true);
    const off = startPhoneSync();
    return () => {
      off();
      setPhoneShellActive(false);
    };
  }, []);

  // The call history, for the Calls badge: loaded once, and again whenever a call is logged.
  useEffect(() => {
    if (accountState !== 'registered') return;
    void useCallHistory.getState().load();
    return window.river.dm.onEvent((e) => {
      if (e.t === 'calls') void useCallHistory.getState().load();
    });
  }, [accountState]);

  const top = stack.at(-1);
  const immersive = !!top && IMMERSIVE.has(top.kind);
  // The screen sliding away after Back stays (same key, same instance) until its animation ends.
  const screens =
    leaving && !stack.some((s) => screenKey(s) === screenKey(leaving)) ? [...stack, leaving] : stack;

  return (
    <div className={`pshell ${immersive ? 'pshell--immersive' : ''}`} data-nav-motion={motion}>
      <div className="pshell__screens">
        <section
          key={tab}
          className={`pscreen pscreen--root ${stack.length ? 'is-covered' : ''} ${motion === 'tab' ? 'is-fading' : ''}`}
          aria-hidden={stack.length ? true : undefined}
          inert={stack.length > 0}
        >
          <ErrorBoundary area={TABS.find((t) => t.id === tab)!.label}>
            <TabRoot tab={tab} notices={notices} />
          </ErrorBoundary>
        </section>
        {screens.map((s, i) => {
          const isLeaving = s === leaving && i >= stack.length;
          const covered = !isLeaving && i < stack.length - 1;
          return (
            <section
              key={screenKey(s)}
              className={`pscreen pscreen--pushed ${isLeaving ? 'is-leaving' : ''} ${covered ? 'is-covered' : ''}`}
              aria-hidden={isLeaving || covered ? true : undefined}
              inert={isLeaving || covered}
            >
              <ErrorBoundary area="This screen">
                <Screen screen={s} />
              </ErrorBoundary>
            </section>
          );
        })}
      </div>
      <PhoneVoiceBar />
      <TabBar hidden={immersive} />
    </div>
  );
}

function TabRoot({ tab, notices }: { tab: PhoneTab; notices?: ReactNode }): ReactElement {
  switch (tab) {
    case 'chats':
      return <ChatsTab notices={notices} />;
    case 'communities':
      return <CommunitiesTab />;
    case 'calls':
      return <CallsTab />;
    case 'feed':
      return (
        <TabPage title="Feed" className="ptab--feed">
          <SocialPage />
        </TabPage>
      );
    case 'profile':
      return <ProfileTab />;
  }
}

function Screen({ screen }: { screen: PhoneScreen }): ReactElement {
  switch (screen.kind) {
    case 'chat':
      return <ChatScreen peer={screen.peer} />;
    case 'community':
      return <CommunityScreen id={screen.id} />;
    case 'channel':
      return <ChannelScreen communityId={screen.communityId} channelId={screen.channelId} />;
    case 'friends':
      return (
        <TitledScreen title="Friends">
          <FriendsPage />
        </TitledScreen>
      );
    case 'files':
      return (
        <TitledScreen title="Files">
          <FilesPage />
        </TitledScreen>
      );
    case 'start':
      return <StartCommunityScreen />;
  }
}

/** A conversation full screen: River's own conversation, with the phone's header and bubbles. */
function ChatScreen({ peer }: { peer: string }): ReactElement {
  const conversation = useDm((d) => d.conversations.find((c) => c.riverId === peer)) ?? null;
  const [safety, setSafety] = useState<string | null>(null);
  // Deleted while open: back to the list (a new chat may arrive a moment after it opens).
  const seen = useRef(false);
  useEffect(() => {
    if (conversation) seen.current = true;
    else if (seen.current && screenKey(topScreen() ?? { kind: 'files' }) === `chat:${peer}`) phonePop();
  }, [conversation, peer]);
  if (!conversation) return <TitledScreen title="Chat">{null}</TitledScreen>;
  return (
    <div className="pscreen__frame pchat">
      <Conversation conversation={conversation} onSafety={() => setSafety(conversation.riverId)} />
      {safety && <SafetyNumber peer={safety} onClose={() => setSafety(null)} />}
    </div>
  );
}

/** "Voice connected" above the tab bar while you are in a community voice channel. */
function PhoneVoiceBar(): ReactElement | null {
  const me = useRiver((r) => r.identity?.riverId ?? '');
  const callChannel = useCommunity((s) => s.call?.channelId ?? null);
  const openChannel = usePhoneNav((s) => {
    const top = s.stack.at(-1);
    return top?.kind === 'channel' ? top.channelId : null;
  });
  if (
    !callChannel ||
    callChannel.startsWith('dm:') ||
    callChannel.startsWith('gcall:') ||
    callChannel === openChannel
  )
    return null;
  return (
    <div className="pvoice">
      <VoicePanel me={me} />
    </div>
  );
}

function TabBar({ hidden }: { hidden: boolean }): ReactElement {
  const tab = usePhoneNav((s) => s.tab);
  const prefs = useRiver((r) => r.settings?.notifications);
  const chats = useDm((d) => chatsBadge(d.conversations, prefs));
  const missed = useCallHistory((s) => missedSince(s.calls, s.seenAt));
  const mentions = useCommunity((s) => Object.values(s.mentions).reduce((n, m) => n + m, 0));
  const badge: Partial<Record<PhoneTab, number>> = {
    chats,
    communities: mentions,
    calls: tab === 'calls' ? 0 : missed,
  };
  return (
    <nav
      className={`ptabs ${hidden ? 'is-hidden' : ''}`}
      aria-label="River"
      aria-hidden={hidden ? true : undefined}
      inert={hidden}
    >
      {TABS.map(({ id, label, Icon }) => {
        const n = badge[id] ?? 0;
        const what = id === 'calls' ? 'missed' : id === 'communities' ? 'mentions' : 'unread';
        return (
          <button
            key={id}
            className={`ptabs__tab ${tab === id ? 'is-active' : ''}`}
            aria-current={tab === id ? 'page' : undefined}
            aria-label={n > 0 ? `${label}, ${n} ${what}` : label}
            onClick={() => phoneTab(id)}
          >
            <span className="ptabs__icon">
              <Icon size={26} />
              {n > 0 && (
                <span
                  className={`ptabs__badge ${id === 'calls' ? 'ptabs__badge--missed' : ''}`}
                  aria-hidden="true"
                >
                  {countLabel(n)}
                </span>
              )}
            </span>
            <span className="ptabs__label" aria-hidden="true">
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
