import { useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, CommunityView } from '../../../../shared/ipc.ts';
import { useRiver } from '../../store.ts';
import { useCommunity } from '../store.ts';
import {
  Avatar,
  ChevronIcon,
  DoorIcon,
  GearIcon,
  HashIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  LockSmallIcon,
  MenuItem,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  PlusIcon,
  Popover,
  ScreenIcon,
  SpeakerIcon,
  UsersIcon,
  can,
  memberOf,
} from './common.tsx';

export function ChannelSidebar(props: { community: CommunityView; me: string }): ReactElement {
  const { community, me } = props;
  const s = useCommunity();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const perms = community.permissions;
  const manageChannels = can(perms, Permission.MANAGE_CHANNELS);
  const canSettings =
    can(perms, Permission.MANAGE_COMMUNITY) ||
    can(perms, Permission.MANAGE_ROLES) ||
    can(perms, Permission.KICK_MEMBERS) ||
    can(perms, Permission.BAN_MEMBERS);

  const confirmLeave = (): void =>
    s.setModal({
      kind: 'confirm',
      title: `Leave ${community.name}`,
      body: `You will not be able to rejoin unless someone invites you again.`,
      action: 'Leave community',
      run: async () => {
        await s.run({ a: 'leave', communityId: community.id });
      },
    });

  return (
    <aside className="community__channels" aria-label="Channels">
      <button
        className="community__title"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left + 8, y: r.bottom + 4 });
        }}
      >
        <strong>{community.name}</strong>
        <ChevronIcon size={16} />
      </button>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          {can(perms, Permission.CREATE_INVITE) && (
            <MenuItem
              icon={<UsersIcon size={16} />}
              onClick={() => {
                setMenu(null);
                s.setModal({ kind: 'invite', communityId: community.id });
              }}
            >
              Invite people
            </MenuItem>
          )}
          {canSettings && (
            <MenuItem
              icon={<GearIcon size={16} />}
              onClick={() => {
                setMenu(null);
                s.setModal({ kind: 'community-settings', communityId: community.id });
              }}
            >
              Community settings
            </MenuItem>
          )}
          {manageChannels && (
            <MenuItem
              icon={<PlusIcon size={16} />}
              onClick={() => {
                setMenu(null);
                s.setModal({ kind: 'create-channel', communityId: community.id, channelKind: 'text' });
              }}
            >
              Create channel
            </MenuItem>
          )}
          {community.ownerId !== me && (
            <MenuItem
              danger
              icon={<DoorIcon size={16} />}
              onClick={() => {
                setMenu(null);
                confirmLeave();
              }}
            >
              Leave community
            </MenuItem>
          )}
        </Popover>
      )}
      <div className="community__badges">
        <span className="chip" title="Messages are encrypted with the community key">
          <LockSmallIcon size={11} /> End-to-end encrypted
        </span>
      </div>
      {can(perms, Permission.CREATE_INVITE) && (
        <button
          className="btn btn--ghost btn--small community__invite"
          onClick={() => s.setModal({ kind: 'invite', communityId: community.id })}
        >
          Invite people
        </button>
      )}
      <div className="community__channel-scroll">
        {(['text', 'voice'] as const).map((kind) => (
          <div key={kind} className="channel-group">
            <div className="channel-group__head">
              <span>{kind === 'text' ? 'Text channels' : 'Voice channels'}</span>
              {manageChannels && (
                <button
                  className="channel-group__add"
                  title={`Create ${kind} channel`}
                  aria-label={`Create ${kind} channel`}
                  onClick={() =>
                    s.setModal({ kind: 'create-channel', communityId: community.id, channelKind: kind })
                  }
                >
                  <PlusIcon size={14} />
                </button>
              )}
            </div>
            {community.channels
              .filter((ch) => ch.kind === kind)
              .map((ch) => (
                <ChannelRow key={ch.id} community={community} channel={ch} me={me} />
              ))}
          </div>
        ))}
      </div>
      <VoicePanel community={community} />
      <UserPanel me={me} community={community} />
    </aside>
  );
}

function ChannelRow(props: { community: CommunityView; channel: ChannelView; me: string }): ReactElement {
  const { community, channel: ch, me } = props;
  const s = useCommunity();
  useCommunity((x) => x.callVersion);
  const unread = s.unread[ch.id] ?? 0;
  const mentions = s.mentions[ch.id] ?? 0;
  const active = ch.id === s.selectedChannel;
  const participants = community.voice[ch.id] ?? [];
  const canManage = can(ch.permissions, Permission.MANAGE_CHANNELS);
  const open = (): void => {
    s.selectChannel(ch.id);
    if (ch.kind === 'voice' && s.call?.channelId !== ch.id && can(ch.permissions, Permission.CONNECT)) {
      void s.joinVoice(ch.id, me);
    }
  };
  return (
    <div className="channel-wrap">
      <div
        className={`channel ${active ? 'is-active' : ''} ${unread ? 'is-unread' : ''}`}
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter') open();
        }}
      >
        <span className="channel__icon">
          {ch.kind === 'text' ? <HashIcon size={17} /> : <SpeakerIcon size={17} />}
        </span>
        <span className="channel__name">{ch.name}</span>
        {ch.private && (
          <span className="channel__lock" title="Private channel">
            <LockSmallIcon size={12} />
          </span>
        )}
        {mentions > 0 && <span className="badge badge--mention">{mentions}</span>}
        {canManage && (
          <button
            className="channel__gear"
            aria-label={`Edit ${ch.name}`}
            title="Edit channel"
            onClick={(e) => {
              e.stopPropagation();
              s.setModal({ kind: 'channel-settings', channelId: ch.id });
            }}
          >
            <GearIcon size={14} />
          </button>
        )}
      </div>
      {ch.kind === 'voice' &&
        participants.map((id) => {
          const m = memberOf(community, id);
          const state = community.voiceStates[id];
          const speaking = s.call?.channelId === ch.id && s.call.speaking.has(id);
          return (
            <div key={id} className="channel__participant">
              <Avatar id={id} name={m?.name ?? '?'} avatar={m?.avatar} size={22} speaking={speaking} />
              <span
                className="channel__participant-name"
                style={m?.color ? { color: `#${m.color.toString(16).padStart(6, '0')}` } : undefined}
              >
                {m?.name ?? 'Someone'}
                {id === me ? ' (you)' : ''}
              </span>
              {state?.streaming && <span className="live-badge">LIVE</span>}
              {(state?.serverMuted || state?.muted) && (
                <span
                  className={`voice-icon ${state.serverMuted ? 'voice-icon--server' : ''}`}
                  title={state.serverMuted ? 'Server muted' : 'Muted'}
                >
                  <MicOffIcon size={13} />
                </span>
              )}
              {state?.deafened && (
                <span className="voice-icon" title="Deafened">
                  <HeadphonesOffIcon size={13} />
                </span>
              )}
            </div>
          );
        })}
    </div>
  );
}

function VoicePanel({ community }: { community: CommunityView }): ReactElement | null {
  const s = useCommunity();
  useCommunity((x) => x.callVersion);
  const call = s.call;
  if (!call) return null;
  const channelCommunity =
    s.communities.find((c) => c.channels.some((ch) => ch.id === call.channelId)) ?? community;
  const channel = channelCommunity.channels.find((ch) => ch.id === call.channelId);
  const screen = !!call.localTrack('screen');
  return (
    <div className="voice-panel">
      <div className="voice-panel__status">
        <span className="voice-panel__signal" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div>
          <strong>Voice connected</strong>
          <button
            className="voice-panel__where"
            onClick={() => s.select(channelCommunity.id, call.channelId)}
          >
            {channel?.name ?? 'Voice'} / {channelCommunity.name}
          </button>
        </div>
      </div>
      <div className="voice-panel__actions">
        {screen && (
          <span className="live-badge" title="You are sharing your screen">
            <ScreenIcon size={12} /> LIVE
          </span>
        )}
        <button
          className="icon-btn icon-btn--danger"
          aria-label="Disconnect"
          title="Disconnect"
          onClick={() => void s.leaveVoice()}
        >
          <PhoneOffIcon size={18} />
        </button>
      </div>
    </div>
  );
}

function UserPanel({ me, community }: { me: string; community: CommunityView }): ReactElement {
  const s = useCommunity();
  const identity = useRiver((r) => r.identity);
  const member = memberOf(community, me);
  useCommunity((x) => x.callVersion);
  const ptt = s.call?.pushToTalk ?? false;
  return (
    <div className="user-panel">
      <button
        className="user-panel__me"
        onClick={() => s.setModal({ kind: 'user-settings', tab: 'profile' })}
      >
        <Avatar
          id={me}
          name={member?.name ?? identity?.displayName ?? '?'}
          avatar={member?.avatar}
          size={32}
          status={s.connection === 'online' ? 'online' : 'offline'}
          speaking={s.call?.speaking.has(me)}
        />
        <span className="user-panel__text">
          <strong>{member?.name ?? identity?.displayName ?? 'You'}</strong>
          <span className="muted small">
            {s.connection === 'online' ? (ptt ? 'Push to talk' : 'Online') : 'Offline'}
          </span>
        </span>
      </button>
      <button
        className={`icon-btn ${s.selfMuted ? 'icon-btn--off' : ''}`}
        aria-label={s.selfMuted ? 'Unmute' : 'Mute'}
        title={s.selfMuted ? 'Unmute (Ctrl+Shift+M)' : 'Mute (Ctrl+Shift+M)'}
        onClick={s.toggleMute}
      >
        {s.selfMuted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
      </button>
      <button
        className={`icon-btn ${s.selfDeafened ? 'icon-btn--off' : ''}`}
        aria-label={s.selfDeafened ? 'Undeafen' : 'Deafen'}
        title={s.selfDeafened ? 'Undeafen (Ctrl+Shift+D)' : 'Deafen (Ctrl+Shift+D)'}
        onClick={s.toggleDeafen}
      >
        {s.selfDeafened ? <HeadphonesOffIcon size={18} /> : <HeadphonesIcon size={18} />}
      </button>
      <button
        className="icon-btn"
        aria-label="User settings"
        title="User settings"
        onClick={() => s.setModal({ kind: 'user-settings' })}
      >
        <GearIcon size={18} />
      </button>
    </div>
  );
}
