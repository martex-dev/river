import { useEffect, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChatMessage, CommunityView } from '../../../shared/ipc.ts';
import { isMuted } from '../../../shared/notify-rules.ts';
import { ageConfirmed } from '../community/ui/AgeGate.tsx';
import { canOpenCommunitySettings } from '../community/settings-tabs.ts';
import { useCommunity } from '../community/store.ts';
import { ChannelList } from '../community/ui/ChannelList.tsx';
import { can, initials, MenuItem, Popover, avatarColor } from '../community/ui/common.tsx';
import { NotifyMenuSection } from '../community/ui/NotifyMenu.tsx';
import { EventsRow } from '../community/ui/Sidebar.tsx';
import { StartScreen } from '../community/ui/StartScreen.tsx';
import { CommunityMain } from '../pages/CommunitiesPage.tsx';
import { shortWhen } from '../pages/MessagesPage.tsx';
import { tr, trn } from '../i18n.ts';
import { useRiver } from '../store.ts';
import { Glyph, MoreIcon, PlusIcon } from './icons.tsx';
import { phonePush } from './nav.ts';
import { countLabel, ScreenBar, TabPage, TitledScreen } from './ui.tsx';

/** A community's picture: its image, its emoji, or its initials on a colour. */
export function CommunityIcon({ c, size }: { c: CommunityView; size: number }): ReactElement {
  return (
    <span
      className="pcommunity-icon"
      style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(c.id) }}
      aria-hidden="true"
    >
      {c.art?.icon ? (
        <img src={c.art.icon} alt="" draggable={false} />
      ) : c.icon ? (
        <span style={{ fontSize: size * 0.55 }}>{c.icon}</span>
      ) : (
        initials(c.name)
      )}
    </span>
  );
}

/** "12 members · 3 online". */
function membersLine(members: number, online: number): string {
  const all = trn('{count} members', members);
  return online ? `${all} · ${trn('{count} online', online)}` : all;
}

/** Opens a community on its channels, without opening (or reading) any channel for you. */
export function openCommunity(id: string): void {
  const s = useCommunity.getState();
  if (s.selectedCommunity !== id)
    useCommunity.setState({ selectedCommunity: id, replyTo: null, editing: null });
  if (!s.emojis[id]) void s.loadEmojis(id);
  if (!s.stickers[id]) void s.loadStickers(id);
  if (s.saved === null) void s.loadSaved();
  phonePush({ kind: 'community', id });
}

/** The newest message River has loaded in a community, for its row. */
function newestLoaded(c: CommunityView, messages: Record<string, ChatMessage[]>): ChatMessage | null {
  let newest: ChatMessage | null = null;
  for (const ch of c.channels) {
    const last = messages[ch.id]?.at(-1);
    if (last && (!newest || last.sentAt > newest.sentAt)) newest = last;
  }
  return newest;
}

/** Communities (2.12): one row each, like Telegram's groups. */
export function CommunitiesTab(): ReactElement {
  const s = useCommunity();
  const account = useRiver((r) => r.account);
  const prefs = useRiver((r) => r.settings?.notifications);
  const setCommunityStart = useRiver((r) => r.setCommunityStart);
  useEffect(() => {
    void useCommunity.getState().load();
  }, [account.state]);

  return (
    <TabPage
      title={tr('Communities')}
      end={
        <button
          className="ptab__btn"
          aria-label={tr('Create or join a community')}
          onClick={() => setCommunityStart(true)}
        >
          <PlusIcon size={26} />
        </button>
      }
    >
      {s.loaded && s.communities.length === 0 ? (
        <div className="pempty">
          <div className="pempty__icon" aria-hidden="true">
            🏞️
          </div>
          <h2>{tr('No communities yet')}</h2>
          <p>{tr('Got an invite link? Paste it to join. Or start one for your friends from a template.')}</p>
          <button className="pbtn" onClick={() => setCommunityStart(true)}>
            {tr('Join or create a community')}
          </button>
        </div>
      ) : (
        <ul className="plist" aria-label={tr('Your communities')}>
          {s.communities.map((c) => {
            const muted = !!prefs && isMuted(prefs, c.id);
            const mentions = c.channels.reduce((n, ch) => n + (s.mentions[ch.id] ?? 0), 0);
            const counted = c.channels.reduce(
              (n, ch) => n + (prefs && isMuted(prefs, ch.id) ? 0 : (s.unread[ch.id] ?? 0)),
              0,
            );
            const unread =
              counted > 0 ||
              c.channels.some(
                (ch) => ch.unread && !(prefs && isMuted(prefs, ch.id)) && ch.id !== s.selectedChannel,
              );
            const newest = newestLoaded(c, s.messages);
            const online = c.members.filter((m) => m.online).length;
            return (
              <li key={c.id}>
                <button
                  className={`prow ${unread && !muted ? 'is-unread' : ''}`}
                  onClick={() => openCommunity(c.id)}
                >
                  <CommunityIcon c={c} size={54} />
                  <span className="prow__main">
                    <span className="prow__top">
                      <strong className="prow__name">{c.name}</strong>
                      {muted && (
                        <span className="prow__flag" role="img" aria-label={tr('Muted')}>
                          🔕
                        </span>
                      )}
                      {newest && <time className="prow__time">{shortWhen(newest.sentAt)}</time>}
                    </span>
                    <span className="prow__bottom">
                      <span className="prow__preview">
                        {newest ? (
                          <>
                            <span className="prow__you">{newest.mine ? tr('You') : newest.senderName}: </span>
                            {newest.text || tr('Attachment')}
                          </>
                        ) : (
                          membersLine(c.members.length, online)
                        )}
                      </span>
                      {mentions > 0 ? (
                        <span className="pbadge" aria-label={trn('{count} mentions', mentions)}>
                          @{countLabel(mentions)}
                        </span>
                      ) : counted > 0 ? (
                        <span
                          className={`pbadge ${muted ? 'pbadge--muted' : ''}`}
                          aria-label={trn('{count} unread', counted)}
                        >
                          {countLabel(counted)}
                        </span>
                      ) : (
                        unread &&
                        !muted && (
                          <span
                            className="pbadge pbadge--dot pbadge--muted"
                            aria-label={tr('Unread messages')}
                          />
                        )
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </TabPage>
  );
}

/** One community: its channels by category, voice channels with who is in them. */
export function CommunityScreen({ id }: { id: string }): ReactElement {
  const community = useCommunity((s) => s.communities.find((c) => c.id === id));
  const me = useRiver((r) => r.identity?.riverId ?? '');
  const setModal = useCommunity((s) => s.setModal);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!community) return <TitledScreen title={tr('Community')}>{null}</TitledScreen>;
  const perms = community.permissions;
  const online = community.members.filter((m) => m.online).length;
  return (
    <div className="pscreen__frame">
      <ScreenBar
        title={community.name}
        subtitle={membersLine(community.members.length, online)}
        picture={<CommunityIcon c={community} size={38} />}
        end={
          <>
            {can(perms, Permission.CREATE_INVITE) && (
              <button
                className="pchat-head__icon"
                aria-label={tr('Invite people')}
                onClick={() => setModal({ kind: 'invite', communityId: community.id })}
              >
                <Glyph.people size={23} />
              </button>
            )}
            {canOpenCommunitySettings(perms) && (
              <button
                className="pchat-head__icon"
                aria-label={tr('Community settings')}
                onClick={() => setModal({ kind: 'community-settings', communityId: community.id })}
              >
                <Glyph.gear size={23} />
              </button>
            )}
            <button
              className="pchat-head__icon"
              aria-label={tr('Community options')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ x: r.right - 230, y: r.bottom + 4 });
              }}
            >
              <MoreIcon size={24} />
            </button>
          </>
        }
      />
      {menu && <CommunityOptions community={community} me={me} at={menu} onClose={() => setMenu(null)} />}
      <div className="pscreen__body pcommunity">
        {community.art?.banner && (
          <img className="pcommunity__banner" src={community.art.banner} alt="" draggable={false} />
        )}
        {community.description && <p className="pcommunity__about">{community.description}</p>}
        <div className="pcommunity__lock">
          🔒 {tr('Messages here are end-to-end encrypted with the community key')}
        </div>
        <EventsRow community={community} />
        <ChannelList community={community} me={me} />
      </div>
    </div>
  );
}

function CommunityOptions(props: {
  community: CommunityView;
  me: string;
  at: { x: number; y: number };
  onClose(): void;
}): ReactElement {
  const s = useCommunity();
  const c = props.community;
  const perms = c.permissions;
  const run = (f: () => void) => () => {
    props.onClose();
    f();
  };
  return (
    <Popover x={props.at.x} y={props.at.y} onClose={props.onClose} className="menu">
      <MenuItem onClick={run(() => s.markChannelsRead(c.channels.map((ch) => ch.id)))}>
        {tr('Mark all as read')}
      </MenuItem>
      {can(perms, Permission.MANAGE_CHANNELS) && (
        <MenuItem
          onClick={run(() => s.setModal({ kind: 'create-channel', communityId: c.id, channelKind: 'text' }))}
        >
          {tr('Create channel')}
        </MenuItem>
      )}
      {can(perms, Permission.MANAGE_CHANNELS) && (
        <MenuItem onClick={run(() => s.setModal({ kind: 'category', communityId: c.id }))}>
          {tr('Create category')}
        </MenuItem>
      )}
      {c.selfRoles.length > 0 && !c.myPending && (
        <MenuItem onClick={run(() => s.setModal({ kind: 'pick-roles', communityId: c.id }))}>
          {tr('Pick your roles')}
        </MenuItem>
      )}
      <MenuItem onClick={run(() => s.setModal({ kind: 'events', communityId: c.id }))}>
        {tr('Events')}
      </MenuItem>
      <MenuItem onClick={run(() => s.setModal({ kind: 'nickname', communityId: c.id }))}>
        {tr('Nickname & picture here')}
      </MenuItem>
      <NotifyMenuSection id={c.id} kind="community" onDone={props.onClose} />
      {c.ownerId !== props.me && (
        <MenuItem
          danger
          onClick={run(() =>
            s.setModal({
              kind: 'confirm',
              title: tr('Leave {name}', { name: c.name }),
              body: tr('You will not be able to rejoin unless someone invites you again.'),
              action: tr('Leave community'),
              run: async () => {
                await s.run({ a: 'leave', communityId: c.id });
              },
            }),
          )}
        >
          {tr('Leave community')}
        </MenuItem>
      )}
    </Popover>
  );
}

/** A channel full screen: the conversation (its own header), a forum, or the voice screen. */
export function ChannelScreen(props: { communityId: string; channelId: string }): ReactElement {
  const community = useCommunity((s) => s.communities.find((c) => c.id === props.communityId)) ?? null;
  const channel = community?.channels.find((ch) => ch.id === props.channelId) ?? null;
  const showMembers = useCommunity((s) => s.showMembers);
  const me = useRiver((r) => r.identity?.riverId ?? '');
  const plainText =
    channel?.kind === 'text' && !channel.forum && !(channel.nsfw && !ageConfirmed(channel.id));
  return (
    <div className="pscreen__frame">
      {!plainText && (
        <ScreenBar
          title={channel?.name ?? tr('Channel')}
          subtitle={
            channel?.kind === 'voice'
              ? `${trn('{count} in voice', (community?.voice[channel.id] ?? []).length)} · ${community?.name ?? ''}`
              : community?.name
          }
        />
      )}
      <div
        className={`community pchannel ${showMembers && channel?.kind === 'text' ? '' : 'community--no-members'}`}
      >
        <CommunityMain community={community} channel={channel} me={me} />
      </div>
    </div>
  );
}

/** Create or join a community, full screen (done: the screen closes, see nav.ts). */
export function StartCommunityScreen(): ReactElement {
  const account = useRiver((r) => r.account);
  return (
    <TitledScreen title={tr('New community')}>
      <StartScreen
        onDone={() => useRiver.getState().setCommunityStart(false)}
        canCancel
        hasAccount={account.state === 'registered'}
      />
    </TitledScreen>
  );
}
