import { memo, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { CommunityView, MemberView } from '../../../../shared/ipc.ts';
import type { NoteView } from '../../../../shared/community-actions.ts';
import { useRiver } from '../../store.ts';
import { friendState, sendFriendRequest } from '../../dm/friends.ts';
import { useDm } from '../../dm/store.ts';
import { useCommunity } from '../store.ts';
import { phoneShellActive } from '../../phone/mode.ts';
import { Avatar, CrownIcon, CustomStatus, Popover, XIcon, can, hex, presenceOf } from './common.tsx';
import { msg, tr } from '../../i18n.ts';

export function MemberList({ community, me }: { community: CommunityView; me: string }): ReactElement {
  const [card, setCard] = useState<{ member: MemberView; x: number; y: number } | null>(null);
  // Grouped and sorted again only when the members or roles change (not on every message).
  const groups = useMemo(
    () => memberGroups(community.members, community.roles),
    [community.members, community.roles],
  );

  return (
    <aside className="community__members" aria-label={tr('Members')}>
      {phoneShellActive() && (
        // On a phone the list covers the channel: a way back to it (Back closes it too).
        <header className="pins__head members__head">
          <strong>{tr('Members · {count}', { count: community.members.length })}</strong>
          <button
            className="icon-btn"
            aria-label={tr('Close members')}
            data-phone-back=""
            onClick={() => useCommunity.setState({ showMembers: false })}
          >
            <XIcon size={14} />
          </button>
        </header>
      )}
      {groups.map((g) => (
        <div key={g.key} className="member-group">
          <div className="channel-group__head">
            <span>
              {g.key === 'online' || g.key === 'offline' ? tr(g.title) : g.title} — {g.members.length}
            </span>
          </div>
          {g.members.map((m) => (
            <MemberRow key={m.riverId} m={m} onCard={setCard} />
          ))}
        </div>
      ))}
      {card && (
        <Popover x={card.x} y={card.y} onClose={() => setCard(null)} className="profile-pop">
          <ProfileCard
            community={community}
            member={community.members.find((m) => m.riverId === card.member.riverId) ?? card.member}
            me={me}
            onDone={() => setCard(null)}
          />
        </Popover>
      )}
    </aside>
  );
}

type Groups = Array<{ key: string; title: string; members: MemberView[] }>;

function memberGroups(all: MemberView[], roles: CommunityView['roles']): Groups {
  const byName = (a: MemberView, b: MemberView): number => a.name.localeCompare(b.name);
  const online = all.filter((m) => m.online);
  const offline = all.filter((m) => !m.online).sort(byName);
  // Online members are grouped under their highest role that is shown separately (hoisted).
  const groups: Groups = [];
  const placed = new Set<string>();
  for (const role of roles.filter((r) => !r.everyone && r.hoist)) {
    const members = online.filter((m) => !placed.has(m.riverId) && m.roles.includes(role.id)).sort(byName);
    for (const m of members) placed.add(m.riverId);
    if (members.length) groups.push({ key: role.id, title: role.name, members });
  }
  const rest = online.filter((m) => !placed.has(m.riverId)).sort(byName);
  if (rest.length) groups.push({ key: 'online', title: msg('Online'), members: rest });
  if (offline.length) groups.push({ key: 'offline', title: msg('Offline'), members: offline });
  return groups;
}

/** One member; memoised (members keep their objects while unchanged, see structural.ts). */
const MemberRow = memo(function MemberRow({
  m,
  onCard,
}: {
  m: MemberView;
  onCard(card: { member: MemberView; x: number; y: number }): void;
}): ReactElement {
  return (
    <button
      className={`member ${m.online ? '' : 'is-offline'}`}
      onClick={(e) => onCard({ member: m, x: e.clientX - 330, y: e.clientY - 40 })}
      onContextMenu={(e) => {
        e.preventDefault();
        onCard({ member: m, x: e.clientX - 330, y: e.clientY - 40 });
      }}
    >
      <Avatar id={m.riverId} name={m.name} avatar={m.avatar} size={32} status={presenceOf(m)} />
      <span className="member__text">
        <span className="member__name" title={m.name} style={m.color ? { color: hex(m.color) } : undefined}>
          {m.name}
          {m.roleIcon && (
            <span className="role-icon" aria-hidden="true">
              {m.roleIcon}
            </span>
          )}
        </span>
        <CustomStatus member={m} />
      </span>
      {m.owner && (
        <span className="member__crown" title={tr('Community owner')}>
          <CrownIcon size={14} />
        </span>
      )}
    </button>
  );
});

export function ProfileCard(props: {
  community: CommunityView;
  member: MemberView;
  me: string;
  onDone(): void;
}): ReactElement {
  const { community, member, me } = props;
  const s = useCommunity();
  const settings = useRiver((r) => r.settings);
  const updateSettings = useRiver((r) => r.updateSettings);
  const [adding, setAdding] = useState(false);
  const perms = community.permissions;
  const isMe = member.riverId === me;
  const outranks = community.ownerId === me || (!member.owner && community.myRank > member.rank);
  const canRoles = can(perms, Permission.MANAGE_ROLES) && (outranks || isMe);
  // Below your highest role, and carrying nothing you lack (the server refuses the rest, 2.20).
  const assignable = community.roles.filter(
    (r) =>
      !r.everyone &&
      (community.ownerId === me || r.position < community.myRank) &&
      (r.permissions & ~perms) === 0,
  );
  const roles = community.roles.filter((r) => member.roles.includes(r.id));
  const voiceChannel = Object.entries(community.voice).find(([, ids]) => ids.includes(member.riverId))?.[0];
  const voiceState = community.voiceStates[member.riverId];
  const volume = settings?.voice.userVolumes[member.riverId] ?? 1;

  const [giveFor, setGiveFor] = useState(0);
  const setRoles = (ids: string[]): void => {
    void s.run({ a: 'setMemberRoles', communityId: community.id, riverId: member.riverId, roles: ids });
  };
  const confirm = (kind: 'kick' | 'ban'): void => {
    props.onDone();
    if (kind === 'ban') {
      s.setModal({ kind: 'ban', communityId: community.id, riverId: member.riverId, name: member.name });
      return;
    }
    s.setModal({
      kind: 'confirm',
      title:
        kind === 'kick' ? tr('Kick {name}', { name: member.name }) : tr('Ban {name}', { name: member.name }),
      body:
        kind === 'kick'
          ? tr('{name} will be removed from {community}. They can rejoin with a new invite.', {
              name: member.name,
              community: community.name,
            })
          : tr('{name} will be removed from {community} and cannot rejoin until unbanned.', {
              name: member.name,
              community: community.name,
            }),
      action: kind === 'kick' ? tr('Kick') : tr('Ban'),
      run: async () => {
        await s.run({ a: kind, communityId: community.id, riverId: member.riverId });
      },
    });
  };

  return (
    <div className="profile-card">
      <div
        className="profile-card__banner"
        style={
          member.banner !== null && member.banner !== undefined
            ? { background: hex(member.banner) }
            : member.color
              ? { background: hex(member.color) }
              : undefined
        }
      />
      <div className="profile-card__avatar">
        <Avatar
          id={member.riverId}
          name={member.name}
          avatar={member.avatar}
          size={76}
          status={presenceOf(member)}
        />
      </div>
      <div className="profile-card__body">
        <h3>
          {member.name} {member.owner && <CrownIcon size={15} />}
        </h3>
        {member.pronouns && <div className="muted small profile-card__pronouns">{member.pronouns}</div>}
        {member.customStatus && (
          <div className="profile-card__custom">
            <CustomStatus member={member} />
          </div>
        )}
        {member.timeoutUntil && (
          <div className="chip chip--error profile-card__timeout">
            {tr('Timed out until {time}', {
              time: new Date(member.timeoutUntil).toLocaleString([], {
                dateStyle: 'short',
                timeStyle: 'short',
              }),
            })}
          </div>
        )}
        <button
          className="btn btn--link profile-card__id mono small"
          title={tr('Copy River ID')}
          onClick={() =>
            void navigator.clipboard
              .writeText(member.riverId)
              .then(() => useCommunity.getState().notify(tr('River ID copied.')))
          }
        >
          {member.riverId.slice(0, 8)}… · {tr('Copy ID')}
        </button>
        {member.joinedOn && (
          <div className="muted small profile-card__since">
            {tr('Member of {community} since {date}', {
              community: community.name,
              date: new Date(`${member.joinedOn}T12:00:00`).toLocaleDateString([], { dateStyle: 'medium' }),
            })}
          </div>
        )}
        {member.bio && (
          <>
            <div className="profile-card__section">{tr('About me')}</div>
            <p className="profile-card__bio">{member.bio}</p>
          </>
        )}
        {member.riverId !== me &&
          (can(perms, Permission.MODERATE_MEMBERS) ||
            can(perms, Permission.KICK_MEMBERS) ||
            can(perms, Permission.BAN_MEMBERS)) && (
            <ModNotes community={community} riverId={member.riverId} />
          )}
        <div className="profile-card__section">{tr('Roles')}</div>
        <div className="role-chips">
          {roles.map((r) => (
            <span key={r.id} className="role-chip">
              <span
                className="role-chip__dot"
                style={{ background: r.color ? hex(r.color) : 'var(--text-faint)' }}
              />
              {r.name}
              {member.roleExpiry?.[r.id] && (
                <span
                  className="role-chip__until"
                  title={tr('Until {time}', { time: new Date(member.roleExpiry[r.id]!).toLocaleString() })}
                >
                  ⏳
                </span>
              )}
              {canRoles && assignable.some((a) => a.id === r.id) && (
                <button
                  className="role-chip__x"
                  aria-label={tr('Remove {name}', { name: r.name })}
                  onClick={() => setRoles(member.roles.filter((id) => id !== r.id))}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {canRoles && assignable.some((r) => !member.roles.includes(r.id)) && (
            <button
              className="role-chip role-chip--add"
              aria-label={tr('Add role')}
              onClick={() => setAdding(!adding)}
            >
              +
            </button>
          )}
          {roles.length === 0 && !canRoles && <span className="muted small">{tr('No roles')}</span>}
        </div>
        {adding && (
          <div className="role-picker">
            <label className="role-picker__for">
              <span className="muted small">{tr('For')}</span>
              <select value={giveFor} onChange={(e) => setGiveFor(Number(e.target.value))}>
                <option value={0}>{tr('Good')}</option>
                <option value={3600}>{tr('1 hour')}</option>
                <option value={86_400}>{tr('1 day')}</option>
                <option value={604_800}>{tr('1 week')}</option>
                <option value={2_592_000}>{tr('30 days')}</option>
              </select>
            </label>
            {assignable
              .filter((r) => !member.roles.includes(r.id))
              .map((r) => (
                <button
                  key={r.id}
                  className="role-picker__item"
                  onClick={() => {
                    setAdding(false);
                    if (giveFor)
                      void s.run({
                        a: 'giveTempRole',
                        communityId: community.id,
                        riverId: member.riverId,
                        roleId: r.id,
                        seconds: giveFor as 3600 | 86_400 | 604_800 | 2_592_000,
                      });
                    else setRoles([...member.roles, r.id]);
                  }}
                >
                  <span
                    className="role-chip__dot"
                    style={{ background: r.color ? hex(r.color) : 'var(--text-faint)' }}
                  />
                  {r.name}
                </button>
              ))}
          </div>
        )}
        {!isMe && s.call && voiceChannel === s.call.channelId && (
          <>
            <div className="profile-card__section">{tr('User volume')}</div>
            <input
              type="range"
              className="slider"
              min={0}
              max={200}
              value={Math.round(volume * 100)}
              aria-label={tr('Volume for {name}', { name: member.name })}
              aria-valuetext={`${Math.round(volume * 100)}%`}
              onChange={(e) =>
                void updateSettings({
                  voice: {
                    userVolumes: {
                      ...settings?.voice.userVolumes,
                      [member.riverId]: Number(e.target.value) / 100,
                    },
                  },
                })
              }
            />
          </>
        )}
        {!isMe && (
          <div className="profile-card__actions">
            <button
              className="btn btn--primary btn--small"
              onClick={() => {
                props.onDone();
                void useDm.getState().open(member.riverId, member.name);
              }}
            >
              {tr('Message')}
            </button>
            <FriendButton riverId={member.riverId} />
            {voiceChannel && outranks && can(perms, Permission.MUTE_MEMBERS) && (
              <button
                className="btn btn--ghost btn--small"
                onClick={() =>
                  void s.run({
                    a: 'moderateVoice',
                    riverId: member.riverId,
                    serverMuted: !voiceState?.serverMuted,
                  })
                }
              >
                {voiceState?.serverMuted ? tr('Server unmute') : tr('Server mute')}
              </button>
            )}
            {voiceChannel && outranks && can(perms, Permission.MUTE_MEMBERS) && (
              <button
                className="btn btn--ghost btn--small"
                onClick={() =>
                  void s.run({
                    a: 'moderateVoice',
                    riverId: member.riverId,
                    serverDeafened: !voiceState?.serverDeafened,
                  })
                }
              >
                {voiceState?.serverDeafened ? tr('Server undeafen') : tr('Server deafen')}
              </button>
            )}
            {voiceChannel && outranks && can(perms, Permission.MOVE_MEMBERS) && (
              <button
                className="btn btn--ghost btn--small"
                onClick={() => void s.run({ a: 'moderateVoice', riverId: member.riverId, disconnect: true })}
              >
                {tr('Disconnect')}
              </button>
            )}
            {voiceChannel &&
              outranks &&
              can(perms, Permission.MOVE_MEMBERS) &&
              community.channels.some(
                (ch) =>
                  ch.kind === 'voice' &&
                  ch.id !== voiceChannel &&
                  can(ch.permissions, Permission.MOVE_MEMBERS),
              ) && (
                <select
                  className="role-add"
                  aria-label={tr('Move {name} to another voice channel', { name: member.name })}
                  value=""
                  onChange={(e) =>
                    e.target.value &&
                    void s.run({ a: 'moderateVoice', riverId: member.riverId, moveTo: e.target.value })
                  }
                >
                  <option value="">{tr('Move to…')}</option>
                  {community.channels
                    .filter(
                      (ch) =>
                        ch.kind === 'voice' &&
                        ch.id !== voiceChannel &&
                        can(ch.permissions, Permission.MOVE_MEMBERS),
                    )
                    .map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.name}
                      </option>
                    ))}
                </select>
              )}
            {outranks && can(perms, Permission.MODERATE_MEMBERS) && (
              <TimeoutButton community={community} member={member} onDone={props.onDone} />
            )}
            {outranks && can(perms, Permission.KICK_MEMBERS) && (
              <button className="btn btn--ghost btn--small btn--danger-text" onClick={() => confirm('kick')}>
                {tr('Kick')}
              </button>
            )}
            {outranks && can(perms, Permission.BAN_MEMBERS) && (
              <button className="btn btn--ghost btn--small btn--danger-text" onClick={() => confirm('ban')}>
                {tr('Ban')}
              </button>
            )}
            {community.ownerId === me && member.riverId !== me && (
              <button
                className="btn btn--ghost btn--small btn--danger-text"
                onClick={() =>
                  s.setModal({
                    kind: 'confirm',
                    title: tr('Make {name} the owner?', { name: member.name }),
                    body: tr(
                      '{name} will own {community} and can do everything, including deleting it. You become an ordinary member with the roles you have. Only they can hand it back.',
                      { name: member.name, community: community.name },
                    ),
                    action: tr('Transfer ownership'),
                    run: async () => {
                      await s.run({
                        a: 'transferOwnership',
                        communityId: community.id,
                        riverId: member.riverId,
                      });
                    },
                  })
                }
              >
                {tr('Transfer ownership')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Add friend" on a member's card; shows where things stand once you are connected. */
function FriendButton({ riverId }: { riverId: string }): ReactElement | null {
  useDm((d) => d.conversations);
  const [sent, setSent] = useState(false);
  const state = friendState(riverId);
  if (state === 'blocked') return null;
  if (state === 'friend')
    return (
      <span className="chip chip--online" title={tr('You are friends')}>
        {tr('Friends ✓')}
      </span>
    );
  if (state === 'request') return <span className="chip">{tr('Wants to be friends')}</span>;
  if (state === 'sent' || sent) return <span className="chip">{tr('Request sent ✓')}</span>;
  return (
    <button
      className="btn btn--ghost btn--small"
      onClick={() => {
        setSent(true);
        void sendFriendRequest(riverId).then((ok) => {
          if (ok) useCommunity.getState().notify(tr('Friend request sent'));
          else setSent(false);
        });
      }}
    >
      {tr('Add friend')}
    </button>
  );
}

const TIMEOUTS: Array<[string, number]> = [
  [msg('60 seconds'), 60_000],
  [msg('5 minutes'), 5 * 60_000],
  [msg('10 minutes'), 10 * 60_000],
  [msg('1 hour'), 60 * 60_000],
  [msg('1 day'), 24 * 60 * 60_000],
  [msg('1 week'), 7 * 24 * 60 * 60_000],
];

/** Time someone out for a while, or end their timeout early. */
function TimeoutButton(props: {
  community: CommunityView;
  member: MemberView;
  onDone(): void;
}): ReactElement {
  const s = useCommunity();
  const [open, setOpen] = useState(false);
  const run = (until: string | null): void => {
    props.onDone();
    void s
      .run({ a: 'timeout', communityId: props.community.id, riverId: props.member.riverId, until })
      .then((r) => {
        if (r !== null)
          s.notify(
            until
              ? tr('{name} is timed out', { name: props.member.name })
              : tr('Timeout ended for {name}', { name: props.member.name }),
          );
      });
  };
  if (props.member.timeoutUntil)
    return (
      <button className="btn btn--ghost btn--small" onClick={() => run(null)}>
        {tr('End timeout')}
      </button>
    );
  return (
    <span className="timeout-picker">
      <button
        className="btn btn--ghost btn--small btn--danger-text"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {tr('Time out')}
      </button>
      {open && (
        <span className="timeout-picker__menu" role="menu" aria-label={tr('Timeout length')}>
          {TIMEOUTS.map(([label, ms]) => (
            <button
              key={label}
              role="menuitem"
              className="role-picker__item"
              onClick={() => run(new Date(Date.now() + ms).toISOString())}
            >
              {tr(label)}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** Moderator notes on a profile card (1.0.23): only people who moderate members see them. */
function ModNotes({ community, riverId }: { community: CommunityView; riverId: string }): ReactElement {
  const s = useCommunity();
  const [notes, setNotes] = useState<NoteView[] | null>(null);
  const [text, setText] = useState('');
  const load = (): void =>
    void window.river.community
      .action({ a: 'notes', communityId: community.id, riverId })
      .then((r) => setNotes(r.ok ? r.value : []));
  useEffect(load, [community.id, riverId]);
  const add = async (): Promise<void> => {
    if (!text.trim()) return;
    const res = await s.run({ a: 'addNote', communityId: community.id, riverId, text: text.trim() });
    if (res) {
      setText('');
      load();
    }
  };
  return (
    <div className="mod-notes">
      <div className="profile-card__section">{tr('Moderator notes · only moderators see these')}</div>
      {notes === null && <p className="muted small">{tr('Loading…')}</p>}
      {notes?.map((n) => (
        <div key={n.id} className="mod-notes__note">
          <span className="mod-notes__text">{n.text}</span>
          <span className="muted small">
            {n.authorName} · {new Date(n.createdAt).toLocaleDateString()}
            <button
              className="btn btn--link btn--small"
              aria-label={tr('Remove note')}
              onClick={() => void s.run({ a: 'deleteNote', noteId: n.id }).then(load)}
            >
              {tr('Remove')}
            </button>
          </span>
        </div>
      ))}
      <form
        className="mod-notes__add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          value={text}
          maxLength={1000}
          placeholder={tr('Add a note')}
          aria-label={tr('Add a moderator note')}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
    </div>
  );
}
