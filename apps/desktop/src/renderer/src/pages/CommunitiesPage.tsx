import { AgeGate, ageConfirmed } from '../community/ui/AgeGate.tsx';
import { PickRolesDialog, RulesGate } from '../community/ui/Onboarding.tsx';
import { ForumChannel } from '../community/ui/Forum.tsx';
import { matches, withDefaults } from '../../../shared/keybinds.ts';
import { ReportDialog } from '../community/ui/Reports.tsx';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Celebrations } from '../community/fx.tsx';
import { ConnectionBanner, NetworkWatcher } from '../community/ui/ConnectionBanner.tsx';
import {
  AddFriendDialog,
  JoinInviteDialog,
  PasteToJoin,
  SignupDialog,
} from '../community/ui/PasteToJoin.tsx';
import { StartScreen } from '../community/ui/StartScreen.tsx';
import { ThreadPanel } from '../community/ui/Thread.tsx';
import { useCommunity } from '../community/store.ts';
import { canOpenCommunitySettings } from '../community/settings-tabs.ts';
import { play } from '../community/sound.ts';
import { pttKeyIsTyping } from '../community/ptt.ts';
import { ChannelSidebar } from '../community/ui/Sidebar.tsx';
import { TextChannel } from '../community/ui/Chat.tsx';
import { CommunitySettings } from '../community/ui/CommunitySettings.tsx';
import {
  ChannelSettings,
  BanDialog,
  ConfirmDialog,
  CategoryDialog,
  NicknameDialog,
  CreateChannelDialog,
  InviteDialog,
} from '../community/ui/Dialogs.tsx';
import { MemberList } from '../community/ui/Members.tsx';
import { VoiceChannel } from '../community/ui/Voice.tsx';
import { MenuItem, Popover, can } from '../community/ui/common.tsx';
import { NotifyMenuSection } from '../community/ui/NotifyMenu.tsx';
import { CommunityRail } from '../community/ui/Rail.tsx';
import { EventsDialog } from '../community/ui/Events.tsx';
import { Permission } from '@river/protocol/permissions';
import type { CommunityView } from '../../../shared/ipc.ts';
import { useRiver } from '../store.ts';
import { CallPill, CallPip, IncomingCall } from '../dm/CallUi.tsx';

export function CommunitiesPage(): ReactElement {
  const s = useCommunity();
  const identity = useRiver((r) => r.identity);
  const account = useRiver((r) => r.account);
  const communityStart = useRiver((r) => r.communityStart);
  const setCommunityStart = useRiver((r) => r.setCommunityStart);

  /** Age-restricted channels confirmed in this session (1.0.27). */
  const [ageOk, setAgeOk] = useState<string[]>([]);
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
  if (s.communities.length === 0 || communityStart) {
    return (
      <StartScreen
        onDone={() => setCommunityStart(false)}
        canCancel={s.communities.length > 0}
        hasAccount={account.state === 'registered'}
      />
    );
  }

  return (
    <div className={`community ${s.showMembers && channel?.kind === 'text' ? '' : 'community--no-members'}`}>
      {community && <ChannelSidebar community={community} me={me} />}

      <section className="community__main">
        <ConnectionBanner />
        {community?.securing && (
          <div className="dm-banner dm-banner--warn" role="status">
            <span>
              <strong>Securing this community after a member left…</strong> Until the new key reaches you,
              messages here are still protected with the previous key, which the person who left also had.
            </span>
          </div>
        )}
        {community?.myPending && <RulesGate community={community} />}
        {community && channel?.nsfw && !ageOk.includes(channel.id) && !ageConfirmed(channel.id) ? (
          <AgeGate channel={channel} onOk={() => setAgeOk([...ageOk, channel.id])} />
        ) : (
          <>
            {community && channel?.kind === 'text' && !channel.forum && (
              <TextChannel key={channel.id} community={community} channel={channel} me={me} />
            )}
            {community && channel?.kind === 'text' && channel.forum && (
              <ForumChannel key={channel.id} community={community} channel={channel} />
            )}
            {community && channel?.kind === 'voice' && (
              <VoiceChannel community={community} channel={channel} me={me} />
            )}
          </>
        )}
      </section>

      {community && s.showMembers && channel?.kind === 'text' && !channel.forum && !s.openThread && (
        <MemberList community={community} me={me} />
      )}
      {community && channel?.kind === 'text' && s.openThread?.channelId === channel.id && (
        <ThreadPanel
          key={s.openThread.rootId}
          community={community}
          channel={channel}
          rootId={s.openThread.rootId}
          me={me}
        />
      )}
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
      <NetworkWatcher />
      <IncomingCall />
      <CallPill />
      <CallPip />
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
    case 'ban':
      return <BanDialog modal={modal} />;
    case 'events': {
      const c = communityById(modal.communityId);
      return c ? <EventsDialog community={c} me={me} /> : null;
    }
    case 'pick-roles': {
      const c = communityById(modal.communityId);
      return c ? <PickRolesDialog community={c} me={me} /> : null;
    }
    case 'report': {
      const c = communityById(modal.communityId);
      return c ? <ReportDialog community={c} message={modal.message} /> : null;
    }
    case 'nickname': {
      const c = communityById(modal.communityId);
      return c ? <NicknameDialog community={c} /> : null;
    }
    case 'join-invite':
      return <JoinInviteDialog link={modal.link} />;
    case 'signup':
      return <SignupDialog link={modal.link} />;
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
  const keybinds = useRiver((r) => r.settings?.voice.keybinds);
  useEffect(() => {
    const binds = withDefaults(keybinds);
    const down = (e: KeyboardEvent): void => {
      const s = useCommunity.getState();
      if (!e.repeat) {
        if (matches(binds.toggleMute, e)) {
          e.preventDefault();
          s.toggleMute();
          return;
        }
        if (matches(binds.toggleDeafen, e)) {
          e.preventDefault();
          s.toggleDeafen();
          return;
        }
        if (matches(binds.toggleCamera, e) && s.call) {
          e.preventDefault();
          const call = s.call;
          void call
            .setCamera(!call.localTrack('camera'))
            .catch(() => s.notify('Could not start your camera.', 'error'));
          return;
        }
        if (matches(binds.leaveVoice, e) && s.call) {
          e.preventDefault();
          void s.leaveVoice();
          return;
        }
      }
      // Typing the push-to-talk character (` by default) into a text field types it; it does not talk.
      if (e.code === pttKey && s.call?.pushToTalk && !e.repeat && !pttKeyIsTyping(e)) {
        e.preventDefault();
        if (!s.call.pttActive) play('pttOn');
        s.call.setPushToTalkActive(true);
      }
    };
    const up = (e: KeyboardEvent): void => {
      const call = useCommunity.getState().call;
      if (e.code === pttKey && call?.pushToTalk) {
        if (call.pttActive) play('pttOff');
        call.setPushToTalkActive(false);
      }
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
  }, [pttKey, keybinds]);
  return null;
}

/** Right-click on a community icon: the things you do with a whole community. */
function CommunityMenu(props: {
  community: CommunityView | undefined;
  me: string;
  x: number;
  y: number;
  onClose(): void;
}): ReactElement | null {
  const s = useCommunity();
  const c = props.community;
  if (!c) return null;
  const perms = c.permissions;
  const settings = canOpenCommunitySettings(perms);
  const run = (f: () => void) => () => {
    props.onClose();
    f();
  };
  return (
    <Popover x={props.x} y={props.y} onClose={props.onClose} className="menu">
      <MenuItem onClick={run(() => s.markChannelsRead(c.channels.map((ch) => ch.id)))}>
        Mark all as read
      </MenuItem>
      {can(perms, Permission.CREATE_INVITE) && (
        <MenuItem onClick={run(() => s.setModal({ kind: 'invite', communityId: c.id }))}>
          Invite people
        </MenuItem>
      )}
      {settings && (
        <MenuItem onClick={run(() => s.setModal({ kind: 'community-settings', communityId: c.id }))}>
          Community settings
        </MenuItem>
      )}
      <MenuItem onClick={run(() => s.setModal({ kind: 'nickname', communityId: c.id }))}>
        Change nickname
      </MenuItem>
      <NotifyMenuSection id={c.id} kind="community" onDone={props.onClose} />
      {c.ownerId !== props.me && (
        <MenuItem
          danger
          onClick={run(() =>
            s.setModal({
              kind: 'confirm',
              title: `Leave ${c.name}`,
              body: 'You will not be able to rejoin unless someone invites you again.',
              action: 'Leave community',
              run: async () => {
                await s.run({ a: 'leave', communityId: c.id });
              },
            }),
          )}
        >
          Leave community
        </MenuItem>
      )}
    </Popover>
  );
}

/**
 * The rail down the left of River, as in Discord: Home (friends and direct
 * messages), your communities, "create or join", and — on the PC that hosts
 * the server — Admin.
 */
export function ServerRail(props: { home: ReactNode; bottom?: ReactNode }): ReactElement {
  const s = useCommunity();
  const section = useRiver((r) => r.section);
  const communityStart = useRiver((r) => r.communityStart);
  const setCommunityStart = useRiver((r) => r.setCommunityStart);
  const me = useRiver((r) => r.identity?.riverId ?? '');
  const [serverMenu, setServerMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const inCommunity = section === 'communities' && !communityStart;
  return (
    <>
      <CommunityRail
        activeId={inCommunity ? s.selectedCommunity : null}
        onAdd={() => setCommunityStart(true)}
        onMenu={(id, x, y) => setServerMenu({ id, x, y })}
        top={props.home}
        {...(props.bottom ? { bottom: props.bottom } : {})}
      />
      {serverMenu && (
        <CommunityMenu
          community={s.communities.find((c) => c.id === serverMenu.id)}
          me={me}
          x={serverMenu.x}
          y={serverMenu.y}
          onClose={() => setServerMenu(null)}
        />
      )}
    </>
  );
}
