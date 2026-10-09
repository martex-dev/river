import { useEffect, useState, type ReactElement } from 'react';
import { PERMISSION_INFO, Permission } from '@river/protocol/permissions';
import type { BanView } from '../../../../shared/community-actions.ts';
import type { AuditView, CommunityView, RoleView } from '../../../../shared/ipc.ts';
import { COMMUNITY_ICONS } from '../../../../shared/templates.ts';
import { useCommunity, type CommunityTab } from '../store.ts';
import { ArrowDownIcon, ArrowUpIcon, Avatar, Modal, Toggle, XIcon, can, hex, initials } from './common.tsx';

export const ROLE_COLORS = [
  0x1abc9c, 0x2ecc71, 0x3498db, 0x9b59b6, 0xe91e63, 0xf1c40f, 0xe67e22, 0xe74c3c, 0x95a5a6, 0x607d8b,
  0x11806a, 0x1f8b4c, 0x206694, 0x71368a, 0xad1457, 0xc27c0e, 0xa84300, 0x992d22, 0x979c9f, 0x546e7a,
];

export function CommunitySettings(props: {
  community: CommunityView;
  me: string;
  tab?: CommunityTab;
}): ReactElement {
  const { community, me } = props;
  const s = useCommunity();
  const perms = community.permissions;
  const tabs: Array<[CommunityTab, string, boolean]> = [
    ['overview', 'Overview', can(perms, Permission.MANAGE_COMMUNITY)],
    ['roles', 'Roles', can(perms, Permission.MANAGE_ROLES)],
    ['members', 'Members', true],
    ['bans', 'Bans', can(perms, Permission.BAN_MEMBERS)],
    ['audit', 'Audit log', can(perms, Permission.VIEW_AUDIT_LOG)],
  ];
  const visible = tabs.filter((t) => t[2]);
  const [tab, setTab] = useState<CommunityTab>(
    props.tab && visible.some((t) => t[0] === props.tab) ? props.tab : (visible[0]?.[0] ?? 'members'),
  );
  const close = (): void => s.setModal(null);

  return (
    <Modal onClose={close} full title={undefined}>
      <div className="settings-layout">
        <nav className="settings-layout__nav" aria-label="Community settings">
          <div className="settings-layout__heading">{community.name}</div>
          {visible.map(([id, label]) => (
            <button
              key={id}
              className={`settings-tab ${tab === id ? 'is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          {community.ownerId === me && (
            <>
              <hr />
              <button
                className="settings-tab settings-tab--danger"
                onClick={() =>
                  s.setModal({
                    kind: 'confirm',
                    title: `Delete ${community.name}`,
                    body: 'This permanently deletes the community, its channels and all messages for everyone. This cannot be undone.',
                    action: 'Delete community',
                    run: async () => {
                      await s.run({ a: 'deleteCommunity', communityId: community.id });
                    },
                  })
                }
              >
                Delete community
              </button>
            </>
          )}
        </nav>
        <section className="settings-layout__body">
          <button className="settings-layout__close icon-btn" aria-label="Close settings" onClick={close}>
            <XIcon />
          </button>
          {tab === 'overview' && <Overview community={community} />}
          {tab === 'roles' && <Roles community={community} me={me} />}
          {tab === 'members' && <Members community={community} me={me} />}
          {tab === 'bans' && <Bans community={community} />}
          {tab === 'audit' && <AuditLog community={community} />}
        </section>
      </div>
    </Modal>
  );
}

function Overview({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description);
  const [icon, setIcon] = useState(community.icon);
  const dirty = name !== community.name || description !== community.description || icon !== community.icon;
  return (
    <div className="settings-page">
      <h2>Overview</h2>
      <div className="field__label">Icon</div>
      <div className="icon-picker" role="radiogroup" aria-label="Community icon">
        <button
          type="button"
          role="radio"
          aria-checked={icon === null}
          aria-label="Initials"
          className={`icon-picker__item icon-picker__item--initials ${icon === null ? 'is-active' : ''}`}
          onClick={() => setIcon(null)}
        >
          {initials(name || community.name)}
        </button>
        {COMMUNITY_ICONS.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={icon === e}
            aria-label={`Icon ${e}`}
            className={`icon-picker__item ${icon === e ? 'is-active' : ''}`}
            onClick={() => setIcon(e)}
          >
            {e}
          </button>
        ))}
      </div>
      <label className="textfield">
        <span className="field__label">Community name</span>
        <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="textfield">
        <span className="field__label">Description</span>
        <textarea
          value={description}
          maxLength={300}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <p className="muted small">
        Names and descriptions are encrypted with the community key; the server cannot read them.
      </p>
      {dirty && (
        <div className="save-bar">
          <span>Careful — you have unsaved changes!</span>
          <button
            className="btn btn--link"
            onClick={() => {
              setName(community.name);
              setDescription(community.description);
              setIcon(community.icon);
            }}
          >
            Reset
          </button>
          <button
            className="btn btn--primary btn--small"
            disabled={name.trim() === ''}
            onClick={() =>
              void s.run({
                a: 'updateCommunity',
                communityId: community.id,
                name: name.trim(),
                description,
                icon,
              })
            }
          >
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

const PERMISSION_GROUPS: Array<[string, number[]]> = [
  [
    'General',
    [
      Permission.VIEW_CHANNELS,
      Permission.MANAGE_CHANNELS,
      Permission.MANAGE_ROLES,
      Permission.MANAGE_COMMUNITY,
      Permission.CREATE_INVITE,
    ],
  ],
  ['Membership', [Permission.KICK_MEMBERS, Permission.BAN_MEMBERS]],
  [
    'Text',
    [
      Permission.SEND_MESSAGES,
      Permission.ADD_REACTIONS,
      Permission.ATTACH_FILES,

      Permission.MENTION_EVERYONE,
      Permission.MANAGE_MESSAGES,
      Permission.PIN_MESSAGES,
    ],
  ],
  [
    'Voice',
    [
      Permission.CONNECT,
      Permission.SPEAK,
      Permission.STREAM,
      Permission.MUTE_MEMBERS,
      Permission.MOVE_MEMBERS,
    ],
  ],
  ['Advanced', [Permission.ADMINISTRATOR]],
];

export const infoOf = (bit: number): { label: string; help: string } => {
  const entry = PERMISSION_INFO.find((p) => Permission[p.key] === bit);
  return entry ? { label: entry.label, help: entry.help } : { label: 'Permission', help: '' };
};

function Roles({ community, me }: { community: CommunityView; me: string }): ReactElement {
  const s = useCommunity();
  const [selected, setSelected] = useState<string>(
    community.roles.find((r) => !r.everyone)?.id ?? community.id,
  );
  const role = community.roles.find((r) => r.id === selected) ?? community.roles.find((r) => r.everyone)!;
  const isOwner = community.ownerId === me;
  const editable = (r: RoleView): boolean => isOwner || r.everyone || r.position < community.myRank;

  const create = async (): Promise<void> => {
    const id = await s.run({
      a: 'createRole',
      communityId: community.id,
      name: 'new role',
      color: ROLE_COLORS[community.roles.length % ROLE_COLORS.length]!,
      permissions: 0,
    });
    if (id) setSelected(id);
  };

  return (
    <div className="settings-page settings-page--split">
      <div className="role-list">
        <div className="role-list__head">
          <h2>Roles</h2>
          <button className="btn btn--primary btn--small" onClick={() => void create()}>
            Create role
          </button>
        </div>
        <p className="muted small">
          Members get every permission from all their roles. Higher roles can manage lower ones. The owner can
          do everything.
        </p>
        {community.roles.map((r, i) => {
          const others = community.roles.filter((x) => !x.everyone);
          const idx = others.findIndex((x) => x.id === r.id);
          return (
            <div key={r.id} className={`role-row ${r.id === role.id ? 'is-active' : ''}`}>
              <button className="role-row__main" onClick={() => setSelected(r.id)}>
                <span
                  className="role-chip__dot"
                  style={{ background: r.color ? hex(r.color) : 'var(--text-faint)' }}
                />
                <span>{r.name}</span>
                <span className="muted small">
                  {community.members.filter((m) => r.everyone || m.roles.includes(r.id)).length}
                </span>
              </button>
              {!r.everyone && editable(r) && (
                <span className="role-row__move">
                  <button
                    className="icon-btn"
                    aria-label={`Move ${r.name} up`}
                    disabled={idx === 0 || (!isOwner && (others[idx - 1]?.position ?? 0) >= community.myRank)}
                    onClick={() =>
                      void s.run({ a: 'moveRole', communityId: community.id, roleId: r.id, direction: 1 })
                    }
                  >
                    <ArrowUpIcon size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Move ${r.name} down`}
                    disabled={idx === others.length - 1 || i === community.roles.length - 1}
                    onClick={() =>
                      void s.run({ a: 'moveRole', communityId: community.id, roleId: r.id, direction: -1 })
                    }
                  >
                    <ArrowDownIcon size={14} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <RoleEditor
        key={role.id}
        community={community}
        role={role}
        editable={editable(role)}
        isOwner={isOwner}
      />
    </div>
  );
}

function RoleEditor(props: {
  community: CommunityView;
  role: RoleView;
  editable: boolean;
  isOwner: boolean;
}): ReactElement {
  const { community, role, editable } = props;
  const s = useCommunity();
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [permissions, setPermissions] = useState(role.permissions);
  const [mentionable, setMentionable] = useState(role.mentionable);
  const [hoist, setHoist] = useState(role.hoist);
  const dirty =
    name !== role.name ||
    color !== role.color ||
    permissions !== role.permissions ||
    mentionable !== role.mentionable ||
    hoist !== role.hoist;
  const mine = community.permissions;

  const save = (): void => {
    void s.run({
      a: 'updateRole',
      communityId: community.id,
      roleId: role.id,
      ...(role.everyone ? {} : { name: name.trim() || role.name, color, mentionable, hoist }),
      permissions,
    });
  };

  return (
    <div className="role-editor">
      <h3>Edit role — {role.name}</h3>
      {!editable && <p className="field__error">You can only edit roles below your highest role.</p>}
      {!role.everyone && (
        <>
          <label className="textfield">
            <span className="field__label">Role name</span>
            <input
              value={name}
              maxLength={64}
              disabled={!editable}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="field__label">Role colour</div>
          <div className="color-swatches">
            <button
              className={`color-swatch color-swatch--none ${color === 0 ? 'is-active' : ''}`}
              aria-label="Default colour"
              disabled={!editable}
              onClick={() => setColor(0)}
            />
            {ROLE_COLORS.map((c) => (
              <button
                key={c}
                className={`color-swatch ${color === c ? 'is-active' : ''}`}
                style={{ background: hex(c) }}
                aria-label={`Colour ${hex(c)}`}
                disabled={!editable}
                onClick={() => setColor(c)}
              />
            ))}
            <input
              type="color"
              className="color-input"
              aria-label="Custom colour"
              value={hex(color || 0x99aab5)}
              disabled={!editable}
              onChange={(e) => setColor(parseInt(e.target.value.slice(1), 16))}
            />
          </div>
          <Toggle
            label="Allow anyone to @mention this role"
            help="Members can ping everyone with this role. People who may mention @everyone can always mention every role."
            checked={mentionable}
            disabled={!editable}
            onChange={setMentionable}
          />
          <Toggle
            label="Show members with this role separately"
            help="Online members with this role get their own group in the member list."
            checked={hoist}
            disabled={!editable}
            onChange={setHoist}
          />
        </>
      )}
      {role.everyone && (
        <p className="muted small">
          @everyone applies to every member of the community. Use it for the defaults.
        </p>
      )}
      {PERMISSION_GROUPS.map(([group, bits]) => (
        <div key={group} className="perm-group">
          <div className="perm-group__title">{group} permissions</div>
          {bits.map((bit) => {
            const info = infoOf(bit);
            return (
              <Toggle
                key={bit}
                label={info.label}
                help={info.help}
                checked={(permissions & bit) === bit}
                // You cannot grant what you do not have (the server enforces this too).
                disabled={!editable || (!props.isOwner && !can(mine, bit) && (permissions & bit) !== bit)}
                onChange={(on) => setPermissions(on ? permissions | bit : permissions & ~bit)}
              />
            );
          })}
        </div>
      ))}
      {!role.everyone && editable && (
        <button
          className="btn btn--ghost btn--danger-text"
          onClick={() =>
            s.setModal({
              kind: 'confirm',
              title: `Delete ${role.name}`,
              body: 'Members with this role lose it. This cannot be undone.',
              action: 'Delete role',
              run: async () => {
                await s.run({ a: 'deleteRole', communityId: community.id, roleId: role.id });
                s.setModal({ kind: 'community-settings', communityId: community.id, tab: 'roles' });
              },
            })
          }
        >
          Delete role
        </button>
      )}
      {dirty && editable && (
        <div className="save-bar">
          <span>Careful — you have unsaved changes!</span>
          <button
            className="btn btn--link"
            onClick={() => {
              setName(role.name);
              setColor(role.color);
              setPermissions(role.permissions);
              setMentionable(role.mentionable);
              setHoist(role.hoist);
            }}
          >
            Reset
          </button>
          <button className="btn btn--primary btn--small" onClick={save}>
            Save changes
          </button>
        </div>
      )}
    </div>
  );
}

function Members({ community, me }: { community: CommunityView; me: string }): ReactElement {
  const s = useCommunity();
  const [query, setQuery] = useState('');
  const perms = community.permissions;
  const isOwner = community.ownerId === me;
  const assignable = community.roles.filter((r) => !r.everyone && (isOwner || r.position < community.myRank));
  const members = community.members
    .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  return (
    <div className="settings-page">
      <h2>Members — {community.members.length}</h2>
      <input
        className="search"
        placeholder="Search members"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="member-table">
        {members.map((m) => {
          const outranks = isOwner || (!m.owner && community.myRank > m.rank);
          const canRoles = can(perms, Permission.MANAGE_ROLES) && (outranks || m.riverId === me);
          return (
            <div key={m.riverId} className="member-table__row">
              <Avatar
                id={m.riverId}
                name={m.name}
                avatar={m.avatar}
                size={32}
                status={m.online ? 'online' : 'offline'}
              />
              <div className="member-table__who">
                <strong style={m.color ? { color: hex(m.color) } : undefined}>
                  {m.name}
                  {m.owner ? ' 👑' : ''}
                </strong>
                <div className="role-chips">
                  {community.roles
                    .filter((r) => m.roles.includes(r.id))
                    .map((r) => (
                      <span key={r.id} className="role-chip">
                        <span
                          className="role-chip__dot"
                          style={{ background: r.color ? hex(r.color) : 'var(--text-faint)' }}
                        />
                        {r.name}
                        {canRoles && assignable.some((a) => a.id === r.id) && (
                          <button
                            className="role-chip__x"
                            aria-label={`Remove ${r.name} from ${m.name}`}
                            onClick={() =>
                              void s.run({
                                a: 'setMemberRoles',
                                communityId: community.id,
                                riverId: m.riverId,
                                roles: m.roles.filter((id) => id !== r.id),
                              })
                            }
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  {canRoles && assignable.some((r) => !m.roles.includes(r.id)) && (
                    <select
                      className="role-add"
                      aria-label={`Add role to ${m.name}`}
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        void s.run({
                          a: 'setMemberRoles',
                          communityId: community.id,
                          riverId: m.riverId,
                          roles: [...m.roles, e.target.value],
                        });
                      }}
                    >
                      <option value="">+ Role</option>
                      {assignable
                        .filter((r) => !m.roles.includes(r.id))
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              </div>
              <div className="member-table__actions">
                {m.riverId !== me && outranks && can(perms, Permission.KICK_MEMBERS) && (
                  <button
                    className="btn btn--ghost btn--small btn--danger-text"
                    onClick={() =>
                      s.setModal({
                        kind: 'confirm',
                        title: `Kick ${m.name}`,
                        body: `${m.name} will be removed. They can rejoin with a new invite.`,
                        action: 'Kick',
                        run: async () => {
                          await s.run({ a: 'kick', communityId: community.id, riverId: m.riverId });
                          s.setModal({
                            kind: 'community-settings',
                            communityId: community.id,
                            tab: 'members',
                          });
                        },
                      })
                    }
                  >
                    Kick
                  </button>
                )}
                {m.riverId !== me && outranks && can(perms, Permission.BAN_MEMBERS) && (
                  <button
                    className="btn btn--ghost btn--small btn--danger-text"
                    onClick={() =>
                      s.setModal({
                        kind: 'confirm',
                        title: `Ban ${m.name}`,
                        body: `${m.name} will be removed and cannot rejoin until unbanned.`,
                        action: 'Ban',
                        run: async () => {
                          await s.run({ a: 'ban', communityId: community.id, riverId: m.riverId });
                          s.setModal({
                            kind: 'community-settings',
                            communityId: community.id,
                            tab: 'members',
                          });
                        },
                      })
                    }
                  >
                    Ban
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bans({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [bans, setBans] = useState<BanView[] | null>(null);
  const load = (): void => {
    void s.run({ a: 'bans', communityId: community.id }).then((b) => setBans(b ?? []));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [community.id]);
  return (
    <div className="settings-page">
      <h2>Bans</h2>
      {bans === null && <p className="muted">Loading…</p>}
      {bans?.length === 0 && <p className="muted">Nobody is banned.</p>}
      <div className="member-table">
        {bans?.map((b) => (
          <div key={b.riverId} className="member-table__row">
            <Avatar id={b.riverId} name={b.name} size={32} />
            <div className="member-table__who">
              <strong>{b.name}</strong>
              <span className="muted small">Banned on {b.bannedOn}</span>
            </div>
            <button
              className="btn btn--ghost btn--small"
              onClick={() =>
                void s.run({ a: 'unban', communityId: community.id, riverId: b.riverId }).then(load)
              }
            >
              Revoke ban
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Who changed what, newest first; names are filled in on this device. */
function AuditLog({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const [entries, setEntries] = useState<AuditView[] | null>(null);
  const [more, setMore] = useState(true);
  const load = (before?: string): void => {
    void s.run({ a: 'audit', communityId: community.id, ...(before ? { before } : {}) }).then((page) => {
      const list = page ?? [];
      setEntries((prev) => (before ? [...(prev ?? []), ...list] : list));
      setMore(list.length === 100);
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), [community.id]);
  return (
    <div className="settings-page">
      <h2>Audit log</h2>
      <p className="muted small">
        Changes to roles, channels and settings, and moderation, for the last 90 days. The server keeps only
        IDs; names are filled in on your computer.
      </p>
      {entries === null && <p className="muted">Loading…</p>}
      {entries?.length === 0 && <p className="muted">Nothing has happened yet.</p>}
      <ol className="audit">
        {entries?.map((e) => {
          const actor = community.members.find((m) => m.riverId === e.actor);
          return (
            <li key={e.id} className="audit__row">
              <Avatar id={e.actor} name={e.actorName} avatar={actor?.avatar} size={28} />
              <span className="audit__text">
                <strong>{e.actorName}</strong> {e.summary}
              </span>
              <time className="muted small" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                {new Date(e.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              </time>
            </li>
          );
        })}
      </ol>
      {entries && entries.length > 0 && more && (
        <button className="btn btn--ghost btn--small" onClick={() => load(entries.at(-1)!.at)}>
          Load older
        </button>
      )}
    </div>
  );
}
