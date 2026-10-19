import { msg, tr, trn } from '../../i18n.ts';
import { CommunityArtFields } from './CommunityArt.tsx';
import { InsightsPanel } from './Insights.tsx';
import { StickerSettings } from './Stickers.tsx';
import { AUDIT_GROUPS, auditText, filterAudit, type AuditFilter } from '../../../../shared/audit-filter.ts';
import { OnboardingSettings, WordFilterSettings } from './Onboarding.tsx';
import { SoundSettings } from './Soundboard.tsx';
import { ReportsPanel } from './Reports.tsx';
import { InvitesPanel } from './Invites.tsx';
import { WebhooksPanel } from './Webhooks.tsx';
import { useEffect, useState, type ReactElement } from 'react';
import { PERMISSION_INFO, Permission } from '@river/protocol/permissions';
import type { BanView } from '../../../../shared/community-actions.ts';
import type { AuditView, CommunityView, MemberView, RoleView } from '../../../../shared/ipc.ts';
import { COMMUNITY_ICONS } from '../../../../shared/templates.ts';
import { useCommunity, type CommunityTab } from '../store.ts';
import { communityTabs } from '../settings-tabs.ts';
import { roleOrderChanges, roleReach, type RoleReach } from '../../../../shared/role-order.ts';
import { OUT_OF_REACH_NOTE, reachText } from '../role-reach.ts';
import { EmojiSettings } from './EmojiSettings.tsx';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Avatar,
  EmojiPicker,
  MenuItem,
  Modal,
  Popover,
  Toggle,
  XIcon,
  can,
  hex,
  initials,
  presenceOf,
} from './common.tsx';

export { ROLE_COLORS } from '../role-colors.ts';
import { ROLE_COLORS } from '../role-colors.ts';

export function CommunitySettings(props: {
  community: CommunityView;
  me: string;
  tab?: CommunityTab;
}): ReactElement {
  const { community, me } = props;
  const s = useCommunity();
  const tabs = communityTabs(community.permissions);
  const visible = tabs.filter((t) => t[2]);
  const [tab, setTab] = useState<CommunityTab>(
    props.tab && visible.some((t) => t[0] === props.tab) ? props.tab : (visible[0]?.[0] ?? 'members'),
  );
  const close = (): void => s.setModal(null);

  return (
    <Modal onClose={close} full title={undefined}>
      <div className="settings-layout">
        <nav className="settings-layout__nav" aria-label={tr('Community settings')}>
          <div className="settings-layout__heading">{community.name}</div>
          {visible.map(([id, label]) => (
            <button
              key={id}
              className={`settings-tab ${tab === id ? 'is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {tr(label)}
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
                    title: tr('Delete {name}', { name: community.name }),
                    body: tr(
                      'This permanently deletes the community, its channels and all messages for everyone. This cannot be undone.',
                    ),
                    action: tr('Delete community'),
                    run: async () => {
                      await s.run({ a: 'deleteCommunity', communityId: community.id });
                    },
                    back: { kind: 'community-settings', communityId: community.id, tab },
                  })
                }
              >
                {tr('Delete community')}
              </button>
            </>
          )}
        </nav>
        <section className="settings-layout__body">
          <button
            className="settings-layout__close icon-btn"
            aria-label={tr('Close settings')}
            onClick={close}
          >
            <XIcon />
          </button>
          {tab === 'overview' && <Overview community={community} />}
          {tab === 'onboarding' && (
            <>
              <OnboardingSettings community={community} />
              <WordFilterSettings community={community} />
            </>
          )}
          {tab === 'roles' && <Roles community={community} me={me} />}
          {tab === 'members' && <Members community={community} me={me} />}
          {tab === 'emoji' && <EmojiSettings community={community} />}
          {tab === 'stickers' && <StickerSettings community={community} />}
          {tab === 'sounds' && <SoundSettings community={community} />}
          {tab === 'bans' && <Bans community={community} />}
          {tab === 'invites' && <InvitesPanel community={community} />}
          {tab === 'webhooks' && <WebhooksPanel community={community} />}
          {tab === 'reports' && <ReportsPanel community={community} />}
          {tab === 'insights' && <InsightsPanel community={community} />}
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
      <h2>{tr('Overview')}</h2>
      <CommunityArtFields community={community} />
      <div className="field__label">{tr('Icon')}</div>
      <div className="icon-picker" role="radiogroup" aria-label={tr('Community icon')}>
        <button
          type="button"
          role="radio"
          aria-checked={icon === null}
          aria-label={tr('Initials')}
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
            aria-label={tr('Icon {emoji}', { emoji: e })}
            className={`icon-picker__item ${icon === e ? 'is-active' : ''}`}
            onClick={() => setIcon(e)}
          >
            {e}
          </button>
        ))}
      </div>
      <label className="textfield">
        <span className="field__label">{tr('Community name')}</span>
        <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="textfield">
        <span className="field__label">{tr('Description')}</span>
        <textarea
          value={description}
          maxLength={300}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <p className="muted small">
        {tr('Names and descriptions are encrypted with the community key; the server cannot read them.')}
      </p>
      {dirty && (
        <div className="save-bar">
          <span>{tr('Careful — you have unsaved changes!')}</span>
          <button
            className="btn btn--link"
            onClick={() => {
              setName(community.name);
              setDescription(community.description);
              setIcon(community.icon);
            }}
          >
            {tr('Reset')}
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
            {tr('Save changes')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Every permission, grouped for the role editor (each bit appears exactly once). */
export const PERMISSION_GROUPS: Array<[string, number[]]> = [
  [
    'General',
    [
      Permission.VIEW_CHANNELS,
      Permission.MANAGE_CHANNELS,
      Permission.MANAGE_ROLES,
      Permission.MANAGE_COMMUNITY,
      Permission.CREATE_INVITE,
      Permission.VIEW_AUDIT_LOG,
      Permission.MANAGE_EVENTS,
      Permission.MANAGE_EXPRESSIONS,
    ],
  ],
  ['Membership', [Permission.KICK_MEMBERS, Permission.BAN_MEMBERS, Permission.MODERATE_MEMBERS]],
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
      Permission.PRIORITY_SPEAKER,
    ],
  ],
  ['Advanced', [Permission.ADMINISTRATOR]],
];

/** Each group's title (PERMISSION_GROUPS' names are the keys). */
const GROUP_TITLES: Record<string, string> = {
  General: msg('General permissions'),
  Membership: msg('Membership permissions'),
  Text: msg('Text permissions'),
  Voice: msg('Voice permissions'),
  Advanced: msg('Advanced permissions'),
};

/** A permission's name and help, in River's language (permission-texts.ts lists them). */
export const infoOf = (bit: number): { label: string; help: string } => {
  const entry = PERMISSION_INFO.find((p) => Permission[p.key] === bit);
  return entry ? { label: tr(entry.label), help: tr(entry.help) } : { label: tr('Permission'), help: '' };
};

function Roles({ community, me }: { community: CommunityView; me: string }): ReactElement {
  const [dragOver, setDragOver] = useState<string | null>(null);
  /** Right-click menu on a role (1.0.35). */
  const [roleMenu, setRoleMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const s = useCommunity();
  const [selected, setSelected] = useState<string>(
    community.roles.find((r) => !r.everyone)?.id ?? community.id,
  );
  const role = community.roles.find((r) => r.id === selected) ?? community.roles.find((r) => r.everyone)!;
  const isOwner = community.ownerId === me;
  // In reach (2.20.2): below your highest role and carrying nothing you lack, as the server checks.
  const reach = (r: RoleView): RoleReach =>
    isOwner ? { ok: true } : roleReach(r, { myRank: community.myRank, permissions: community.permissions });
  const editable = (r: RoleView): boolean => reach(r).ok;
  const others = community.roles.filter((x) => !x.everyone);
  const canMove = (r: RoleView, direction: 1 | -1): boolean =>
    roleOrderChanges(others, community.myRank, { roleId: r.id, direction }, community.permissions).length > 0;

  const create = async (): Promise<void> => {
    const id = await s.run({
      a: 'createRole',
      communityId: community.id,
      name: tr('new role'),
      color: ROLE_COLORS[community.roles.length % ROLE_COLORS.length]!,
      permissions: 0,
    });
    if (id) setSelected(id);
  };

  return (
    <div className="settings-page settings-page--split">
      <div className="role-list">
        <div className="role-list__head">
          <h2>{tr('Roles')}</h2>
          <button className="btn btn--primary btn--small" onClick={() => void create()}>
            {tr('Create role')}
          </button>
        </div>
        <p className="muted small">
          {tr(
            'Members get every permission from all their roles. Higher roles can manage lower ones. The owner can do everything. Drag roles to reorder them.',
          )}
        </p>
        {community.roles.map((r) => {
          const out = reach(r);
          return (
            <div
              key={r.id}
              className={`role-row ${r.id === role.id ? 'is-active' : ''} ${dragOver === r.id ? 'is-drop' : ''}`}
              draggable={!r.everyone && editable(r)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/role', r.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/role')) return;
                // Only above roles you may place things under (or the bottom, @everyone's row).
                if (!r.everyone && !isOwner && r.position >= community.myRank) return;
                e.preventDefault();
                setDragOver(r.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setRoleMenu({ id: r.id, x: e.clientX, y: e.clientY });
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const moving = e.dataTransfer.getData('text/role');
                if (!moving || moving === r.id) return;
                void s.run({
                  a: 'placeRole',
                  communityId: community.id,
                  roleId: moving,
                  aboveId: r.everyone ? null : r.id,
                });
              }}
            >
              {roleMenu?.id === r.id && (
                <Popover x={roleMenu.x} y={roleMenu.y} onClose={() => setRoleMenu(null)} className="menu">
                  <MenuItem
                    onClick={() => {
                      setRoleMenu(null);
                      setSelected(r.id);
                    }}
                  >
                    {editable(r) ? tr('Edit role') : tr('View role')}
                  </MenuItem>
                  {!r.everyone && editable(r) && (
                    <MenuItem
                      danger
                      onClick={() => {
                        setRoleMenu(null);
                        s.setModal({
                          kind: 'confirm',
                          title: tr('Delete {name}', { name: r.name }),
                          body: tr('Members with this role lose it. This cannot be undone.'),
                          action: tr('Delete role'),
                          run: async () => {
                            await s.run({ a: 'deleteRole', communityId: community.id, roleId: r.id });
                          },
                          back: { kind: 'community-settings', communityId: community.id, tab: 'roles' },
                          then: { kind: 'community-settings', communityId: community.id, tab: 'roles' },
                        });
                      }}
                    >
                      {tr('Delete role')}
                    </MenuItem>
                  )}
                </Popover>
              )}
              <button className="role-row__main" onClick={() => setSelected(r.id)}>
                <span
                  className="role-chip__dot"
                  style={{ background: r.color ? hex(r.color) : 'var(--text-faint)' }}
                />
                <span className="role-row__name">{r.name}</span>
                {!out.ok && (
                  <span
                    className="role-row__lock"
                    role="img"
                    aria-label={tr('Out of your reach')}
                    title={reachText(out)}
                  >
                    🔒
                  </span>
                )}
                <span className="muted small">
                  {community.members.filter((m) => r.everyone || m.roles.includes(r.id)).length}
                </span>
              </button>
              {!r.everyone && editable(r) && (
                <span className="role-row__move">
                  <button
                    className="icon-btn"
                    aria-label={`Move ${r.name} up`}
                    disabled={!canMove(r, 1)}
                    onClick={() =>
                      void s.run({ a: 'moveRole', communityId: community.id, roleId: r.id, direction: 1 })
                    }
                  >
                    <ArrowUpIcon size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Move ${r.name} down`}
                    disabled={!canMove(r, -1)}
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
      <RoleEditor key={role.id} community={community} role={role} reach={reach(role)} isOwner={isOwner} />
    </div>
  );
}

function RoleEditor(props: {
  community: CommunityView;
  role: RoleView;
  reach: RoleReach;
  isOwner: boolean;
}): ReactElement {
  const { community, role } = props;
  const editable = props.reach.ok;
  const s = useCommunity();
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [permissions, setPermissions] = useState(role.permissions);
  const [mentionable, setMentionable] = useState(role.mentionable);
  const [hoist, setHoist] = useState(role.hoist);
  const [icon, setIcon] = useState(role.icon);
  const [iconPicker, setIconPicker] = useState<{ x: number; y: number } | null>(null);
  const dirty =
    name !== role.name ||
    color !== role.color ||
    permissions !== role.permissions ||
    mentionable !== role.mentionable ||
    hoist !== role.hoist ||
    icon !== role.icon;
  const mine = community.permissions;

  const save = (): void => {
    void s.run({
      a: 'updateRole',
      communityId: community.id,
      roleId: role.id,
      ...(role.everyone ? {} : { name: name.trim() || role.name, color, mentionable, hoist, icon }),
      permissions,
    });
  };

  return (
    <div className="role-editor">
      <h3>Edit role — {role.name}</h3>
      {!props.reach.ok && (
        <p className="field__error" role="note">
          {reachText(props.reach)}
        </p>
      )}
      {!role.everyone && (
        <>
          <label className="textfield">
            <span className="field__label">{tr('Role name')}</span>
            <input
              value={name}
              maxLength={64}
              disabled={!editable}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="field__label">{tr('Role colour')}</div>
          <div className="color-swatches">
            <button
              className={`color-swatch color-swatch--none ${color === 0 ? 'is-active' : ''}`}
              aria-label={tr('Default colour')}
              disabled={!editable}
              onClick={() => setColor(0)}
            />
            {ROLE_COLORS.map((c) => (
              <button
                key={c}
                className={`color-swatch ${color === c ? 'is-active' : ''}`}
                style={{ background: hex(c) }}
                aria-label={tr('Colour {hex}', { hex: hex(c) })}
                disabled={!editable}
                onClick={() => setColor(c)}
              />
            ))}
            <input
              type="color"
              className="color-input"
              aria-label={tr('Custom colour')}
              value={hex(color || 0x99aab5)}
              disabled={!editable}
              onChange={(e) => setColor(parseInt(e.target.value.slice(1), 16))}
            />
          </div>
          <div className="field__label">{tr('Role icon')}</div>
          <div className="role-icon-field">
            <button
              className="role-icon-field__pick"
              disabled={!editable}
              aria-label={icon ? tr('Role icon {emoji}, change', { emoji: icon }) : tr('Choose a role icon')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setIconPicker({ x: r.left, y: r.bottom + 6 });
              }}
            >
              {icon ?? '＋'}
            </button>
            {icon && editable && (
              <button className="btn btn--link btn--small" onClick={() => setIcon(null)}>
                {tr('Remove')}
              </button>
            )}
            <span className="muted small">{tr('Shown next to the names of people with this role.')}</span>
          </div>
          {iconPicker && (
            <Popover x={iconPicker.x} y={iconPicker.y} onClose={() => setIconPicker(null)}>
              <EmojiPicker
                onPick={(e) => {
                  // Community emoji are pictures; role icons are plain emoji.
                  if (!e.startsWith('<')) setIcon(e);
                  setIconPicker(null);
                }}
              />
            </Popover>
          )}
          <Toggle
            label={tr('Allow anyone to @mention this role')}
            help={tr(
              'Members can ping everyone with this role. People who may mention @everyone can always mention every role.',
            )}
            checked={mentionable}
            disabled={!editable}
            onChange={setMentionable}
          />
          <Toggle
            label={tr('Show members with this role separately')}
            help={tr('Online members with this role get their own group in the member list.')}
            checked={hoist}
            disabled={!editable}
            onChange={setHoist}
          />
        </>
      )}
      {role.everyone && (
        <p className="muted small">
          {tr('@everyone applies to every member of the community. Use it for the defaults.')}
        </p>
      )}
      {PERMISSION_GROUPS.map(([group, bits]) => (
        <div key={group} className="perm-group">
          <div className="perm-group__title">{tr(GROUP_TITLES[group] ?? group)}</div>
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
          className="btn btn--ghost"
          onClick={() =>
            void s
              .run({
                a: 'createRole',
                communityId: community.id,
                name: tr('{name} (copy)', { name: role.name }).slice(0, 64),
                color: role.color,
                permissions: role.permissions,
                mentionable: role.mentionable,
                hoist: role.hoist,
                icon: role.icon,
              })
              .then((id) => id && s.notify(tr('Made a copy of {name}.', { name: role.name })))
          }
        >
          {tr('Duplicate role')}
        </button>
      )}
      {!role.everyone && editable && (
        <button
          className="btn btn--ghost btn--danger-text"
          onClick={() =>
            s.setModal({
              kind: 'confirm',
              title: tr('Delete {name}', { name: role.name }),
              body: tr('Members with this role lose it. This cannot be undone.'),
              action: tr('Delete role'),
              run: async () => {
                await s.run({ a: 'deleteRole', communityId: community.id, roleId: role.id });
              },
              back: { kind: 'community-settings', communityId: community.id, tab: 'roles' },
              then: { kind: 'community-settings', communityId: community.id, tab: 'roles' },
            })
          }
        >
          {tr('Delete role')}
        </button>
      )}
      {dirty && editable && (
        <div className="save-bar">
          <span>{tr('Careful — you have unsaved changes!')}</span>
          <button
            className="btn btn--link"
            onClick={() => {
              setName(role.name);
              setColor(role.color);
              setPermissions(role.permissions);
              setMentionable(role.mentionable);
              setHoist(role.hoist);
              setIcon(role.icon);
            }}
          >
            {tr('Reset')}
          </button>
          <button className="btn btn--primary btn--small" onClick={save}>
            {tr('Save changes')}
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
  // Below your highest role, and carrying nothing you lack (the server refuses the rest, 2.20).
  const assignable = community.roles.filter(
    (r) => !r.everyone && (isOwner || roleReach(r, { myRank: community.myRank, permissions: perms }).ok),
  );
  const unreachable = community.roles.filter((r) => !r.everyone).length - assignable.length;
  const members = community.members
    .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  // Bulk role changes (1.0.37): pick members, then give or take a role from all of them.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const mayManage = (m: MemberView): boolean =>
    can(perms, Permission.MANAGE_ROLES) &&
    (isOwner || (!m.owner && community.myRank > m.rank) || m.riverId === me);
  const bulk = async (roleId: string, give: boolean): Promise<void> => {
    const role = community.roles.find((r) => r.id === roleId);
    const targets = community.members.filter(
      (m) => picked.has(m.riverId) && mayManage(m) && m.roles.includes(roleId) !== give,
    );
    if (!role || targets.length === 0) return;
    setBusy(true);
    let done = 0;
    for (const m of targets) {
      const res = await window.river.community.action({
        a: 'setMemberRoles',
        communityId: community.id,
        riverId: m.riverId,
        roles: give ? [...m.roles, roleId] : m.roles.filter((id) => id !== roleId),
      });
      if (res.ok) done++;
    }
    setBusy(false);
    setPicked(new Set());
    const what = give
      ? trn('Gave {role} to {done} of {count} members.', targets.length, { role: role.name, done })
      : trn('Took {role} from {done} of {count} members.', targets.length, { role: role.name, done });
    s.notify(what, done === targets.length ? 'info' : 'error');
  };
  return (
    <div className="settings-page">
      <h2>{tr('Members — {count}', { count: community.members.length })}</h2>
      <input
        className="search"
        placeholder={tr('Search members')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {can(perms, Permission.MANAGE_ROLES) && unreachable > 0 && (
        <p className="muted small" role="note">
          {tr(OUT_OF_REACH_NOTE)}
        </p>
      )}
      {picked.size > 0 && assignable.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label={tr('Change roles of selected members')}>
          <strong>{tr('{count} selected', { count: picked.size })}</strong>
          <select
            aria-label={tr('Give a role to the selected members')}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && void bulk(e.target.value, true)}
          >
            <option value="">{tr('Give role…')}</option>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            aria-label={tr('Remove a role from the selected members')}
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && void bulk(e.target.value, false)}
          >
            <option value="">{tr('Remove role…')}</option>
            {assignable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="btn btn--link btn--small" disabled={busy} onClick={() => setPicked(new Set())}>
            {tr('Clear')}
          </button>
        </div>
      )}
      <div className="member-table">
        {members.map((m) => {
          const outranks = isOwner || (!m.owner && community.myRank > m.rank);
          const canRoles = can(perms, Permission.MANAGE_ROLES) && (outranks || m.riverId === me);
          return (
            <div key={m.riverId} className="member-table__row">
              {can(perms, Permission.MANAGE_ROLES) && assignable.length > 0 && (
                <input
                  type="checkbox"
                  className="member-table__pick"
                  aria-label={tr('Select {name}', { name: m.name })}
                  disabled={!canRoles}
                  checked={picked.has(m.riverId)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(m.riverId);
                    else next.delete(m.riverId);
                    setPicked(next);
                  }}
                />
              )}
              <Avatar id={m.riverId} name={m.name} avatar={m.avatar} size={32} status={presenceOf(m)} />
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
                            aria-label={tr('Remove {role} from {name}', { role: r.name, name: m.name })}
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
                      aria-label={tr('Add role to {name}', { name: m.name })}
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
                      <option value="">{tr('+ Role')}</option>
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
                        title: tr('Kick {name}', { name: m.name }),
                        body: tr('{name} will be removed. They can rejoin with a new invite.', {
                          name: m.name,
                        }),
                        action: tr('Kick'),
                        run: async () => {
                          await s.run({ a: 'kick', communityId: community.id, riverId: m.riverId });
                        },
                        back: { kind: 'community-settings', communityId: community.id, tab: 'members' },
                        then: { kind: 'community-settings', communityId: community.id, tab: 'members' },
                      })
                    }
                  >
                    {tr('Kick')}
                  </button>
                )}
                {m.riverId !== me && outranks && can(perms, Permission.BAN_MEMBERS) && (
                  <button
                    className="btn btn--ghost btn--small btn--danger-text"
                    onClick={() =>
                      s.setModal({
                        kind: 'ban',
                        communityId: community.id,
                        riverId: m.riverId,
                        name: m.name,
                        then: { kind: 'community-settings', communityId: community.id, tab: 'members' },
                      })
                    }
                  >
                    {tr('Ban')}
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
      <h2>{tr('Bans')}</h2>
      {bans === null && <p className="muted">{tr('Loading…')}</p>}
      {bans?.length === 0 && <p className="muted">{tr('Nobody is banned.')}</p>}
      <div className="member-table">
        {bans?.map((b) => (
          <div key={b.riverId} className="member-table__row">
            <Avatar id={b.riverId} name={b.name} size={32} />
            <div className="member-table__who">
              <strong>{b.name}</strong>
              <span className="muted small">
                {tr('Banned on {date}', { date: b.bannedOn })}
                {b.until
                  ? ` · ${tr('until {time}', { time: new Date(b.until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) })}`
                  : ''}
              </span>
            </div>
            <button
              className="btn btn--ghost btn--small"
              onClick={() =>
                void s.run({ a: 'unban', communityId: community.id, riverId: b.riverId }).then(load)
              }
            >
              {tr('Revoke ban')}
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
  const load = (before?: { at: string; id: string }): void => {
    void s
      .run({
        a: 'audit',
        communityId: community.id,
        ...(before ? { before: before.at, beforeId: before.id } : {}),
      })
      .then((page) => {
        const list = page ?? [];
        setEntries((prev) => (before ? [...(prev ?? []), ...list] : list));
        setMore(list.length === 100);
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), [community.id]);
  const [filter, setFilter] = useState<AuditFilter>({ group: null, actor: null, text: '' });
  const shown = entries ? filterAudit(entries, filter) : null;
  const actors = [...new Map((entries ?? []).map((e) => [e.actor, e.actorName])).entries()];
  return (
    <div className="settings-page">
      <h2>{tr('Audit log')}</h2>
      <p className="muted small">
        {tr(
          'Changes to roles, channels and settings, and moderation, for the last 90 days. The server keeps only IDs; names are filled in on your computer.',
        )}
      </p>
      {entries && entries.length > 0 && (
        <div className="audit-filter">
          <select
            aria-label={tr('Kind of change')}
            value={filter.group ?? ''}
            onChange={(e) => setFilter({ ...filter, group: e.target.value || null })}
          >
            <option value="">{tr('Everything')}</option>
            {AUDIT_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {tr(g.label)}
              </option>
            ))}
          </select>
          <select
            aria-label={tr('Who')}
            value={filter.actor ?? ''}
            onChange={(e) => setFilter({ ...filter, actor: e.target.value || null })}
          >
            <option value="">{tr('Anyone')}</option>
            {actors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <input
            className="search"
            placeholder={tr('Search')}
            aria-label={tr('Search the audit log')}
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          />
          <button
            className="btn btn--ghost btn--small"
            disabled={!shown?.length}
            onClick={() =>
              void navigator.clipboard
                .writeText(auditText(shown ?? []))
                .then(() => s.notify(trn('Copied {count} entries.', shown?.length ?? 0)))
            }
          >
            {tr('Copy')}
          </button>
        </div>
      )}
      {entries === null && <p className="muted">{tr('Loading…')}</p>}
      {entries?.length === 0 && <p className="muted">{tr('Nothing has happened yet.')}</p>}
      {entries && entries.length > 0 && shown?.length === 0 && (
        <p className="muted">{tr('Nothing matches.')}</p>
      )}
      <ol className="audit">
        {shown?.map((e) => {
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
        <button className="btn btn--ghost btn--small" onClick={() => load(entries.at(-1)!)}>
          {tr('Load older')}
        </button>
      )}
    </div>
  );
}
