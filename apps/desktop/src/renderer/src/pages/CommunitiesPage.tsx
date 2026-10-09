import { useEffect, useState, type ReactElement } from 'react';
import { Celebrations } from '../community/fx.tsx';
import { AddFriendDialog, JoinInviteDialog, PasteToJoin } from '../community/ui/PasteToJoin.tsx';
import { StartScreen } from '../community/ui/StartScreen.tsx';
import { useCommunity } from '../community/store.ts';
import { ChannelSidebar } from '../community/ui/Sidebar.tsx';
import { TextChannel } from '../community/ui/Chat.tsx';
import { CommunitySettings } from '../community/ui/CommunitySettings.tsx';
import {
  ChannelSettings,
  ConfirmDialog,
  CategoryDialog,
  CreateChannelDialog,
  InviteDialog,
} from '../community/ui/Dialogs.tsx';
import { MemberList } from '../community/ui/Members.tsx';
import { UserSettings } from '../community/ui/UserSettings.tsx';
import { VoiceChannel } from '../community/ui/Voice.tsx';
import { PlusIcon, initials } from '../community/ui/common.tsx';
import { useRiver } from '../store.ts';
import { CallPill, IncomingCall } from '../dm/CallUi.tsx';

export function CommunitiesPage(): ReactElement {
  const s = useCommunity();
  const identity = useRiver((r) => r.identity);
  const account = useRiver((r) => r.account);
  const [adding, setAdding] = useState(false);
  const me = identity?.riverId ?? '';

  useEffect(() => {
    void s.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.state]);

  // Coming back to the window counts as reading the open channel.
  useEffect(() => {
    const onFocus = (): void => {
      const ch = useCommunity.getState().selectedChannel;
      if (!ch) return;
      void window.river.community.action({ a: 'markRead', channelId: ch });
      const { [ch]: _u, ...unread } = useCommunity.getState().unread;
      const { [ch]: _m, ...mentions } = useCommunity.getState().mentions;
      useCommunity.setState({ unread, mentions });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const community = s.communities.find((c) => c.id === s.selectedCommunity) ?? null;
  const channel = community?.channels.find((ch) => ch.id === s.selectedChannel) ?? null;

  if (!s.loaded) return <div className="page muted">Loading…</div>;
  if (s.communities.length === 0 || adding) {
    return (
      <>
        <StartScreen
          onDone={() => setAdding(false)}
          canCancel={s.communities.length > 0}
          hasAccount={account.state === 'registered'}
        />
      </>
    );
  }

  return (
    <div className={`community ${s.showMembers && channel?.kind === 'text' ? '' : 'community--no-members'}`}>
      <nav className="community__servers" aria-label="Your communities">
        {s.communities.map((c) => {
          const unread = c.channels.some(
            (ch) => (s.unread[ch.id] ?? 0) > 0 || (ch.unread && ch.id !== s.selectedChannel),
          );
          const mentions = c.channels.reduce((n, ch) => n + (s.mentions[ch.id] ?? 0), 0);
          return (
            <div
              key={c.id}
              className={`community__server-wrap ${c.id === community?.id ? 'is-active' : ''} ${unread ? 'is-unread' : ''}`}
            >
              <span className="community__pill" aria-hidden="true" />
              <button
                className={`community__server ${c.id === community?.id ? 'is-active' : ''}`}
                title={c.name}
                aria-label={c.name}
                onClick={() => s.select(c.id)}
              >
                {c.icon ? (
                  <span className="community__server-icon" aria-hidden="true">
                    {c.icon}
                  </span>
                ) : (
                  initials(c.name)
                )}
              </button>
              {mentions > 0 && (
                <span key={mentions} className="badge badge--mention community__server-badge">
                  {mentions}
                </span>
              )}
            </div>
          );
        })}
        <div className="community__server-wrap">
          <button
            className="community__server community__server--add"
            title="Create or join a community"
            aria-label="Create or join a community"
            onClick={() => setAdding(true)}
          >
            <PlusIcon size={22} />
          </button>
        </div>
      </nav>

      {community && <ChannelSidebar community={community} me={me} />}

      <section className="community__main">
        {s.connection !== 'online' && (
          <div className="community__banner" role="status">
            {s.connection === 'connecting' ? 'Connecting to your River server…' : 'Offline — reconnecting…'}
          </div>
        )}
        {community && channel?.kind === 'text' && (
          <TextChannel key={channel.id} community={community} channel={channel} me={me} />
        )}
        {community && channel?.kind === 'voice' && (
          <VoiceChannel community={community} channel={channel} me={me} />
        )}
      </section>

      {community && s.showMembers && channel?.kind === 'text' && <MemberList community={community} me={me} />}
    </div>
  );
}

/** Dialogs and toasts, mounted once at the app root so every section can use them. */
export function Overlays(): ReactElement {
  const me = useRiver((r) => r.identity?.riverId ?? '');
  return (
    <>
      <Modals me={me} />
      <Toast />
      <Celebrations />
      <PasteToJoin />
      <IncomingCall />
      <CallPill />
    </>
  );
}

function Modals({ me }: { me: string }): ReactElement | null {
  const s = useCommunity();
  const modal = s.modal;
  if (!modal) return null;
  const communityById = (id: string) => s.communities.find((c) => c.id === id);
  switch (modal.kind) {
    case 'confirm':
      return <ConfirmDialog modal={modal} />;
    case 'user-settings':
      return <UserSettings tab={modal.tab} />;
    case 'join-invite':
      return <JoinInviteDialog link={modal.link} />;
    case 'add-friend':
      return <AddFriendDialog riverId={modal.riverId} serverUrl={modal.serverUrl} />;
    case 'invite': {
      const c = communityById(modal.communityId);
      return c ? <InviteDialog community={c} /> : null;
    }
    case 'create-channel': {
      const c = communityById(modal.communityId);
      return c ? (
        <CreateChannelDialog community={c} kind={modal.channelKind} parentId={modal.parentId} />
      ) : null;
    }
    case 'category': {
      const c = communityById(modal.communityId);
      return c ? <CategoryDialog community={c} categoryId={modal.categoryId} /> : null;
    }
    case 'community-settings': {
      const c = communityById(modal.communityId);
      return c ? <CommunitySettings community={c} me={me} tab={modal.tab} /> : null;
    }
    case 'channel-settings': {
      const c = s.communities.find((x) => x.channels.some((ch) => ch.id === modal.channelId));
      const ch = c?.channels.find((x) => x.id === modal.channelId);
      return c && ch ? <ChannelSettings key={ch.id} community={c} channel={ch} /> : null;
    }
  }
}

function Toast(): ReactElement | null {
  const toast = useCommunity((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`river-toast river-toast--${toast.tone}`} role="status">
      {toast.text}
    </div>
  );
}

/**
 * Push-to-talk and mute/deafen shortcuts. Mounted at the app root so they
 * work on every screen while River is focused.
 */
export function VoiceHotkeys(): null {
  const pttKey = useRiver((r) => r.settings?.voice.pushToTalkKey ?? 'Backquote');
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const s = useCommunity.getState();
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault();
        s.toggleMute();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        s.toggleDeafen();
        return;
      }
      if (e.code === pttKey && s.call?.pushToTalk && !e.repeat) {
        e.preventDefault();
        s.call.setPushToTalkActive(true);
      }
    };
    const up = (e: KeyboardEvent): void => {
      const call = useCommunity.getState().call;
      if (e.code === pttKey && call?.pushToTalk) call.setPushToTalkActive(false);
    };
    const blur = (): void => useCommunity.getState().call?.setPushToTalkActive(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [pttKey]);
  return null;
}
