import { useState, type ReactElement } from 'react';
import { computePermissions } from '@river/protocol/permissions';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { infoOf } from './CommunitySettings.tsx';
import { hex } from './common.tsx';
import { tr } from '../../i18n.ts';

export type Overwrite = { roleId: string; allow: number; deny: number };
export type BitState = 'allow' | 'deny' | 'inherit';

/** Sets one permission for one role to allow, deny or inherit, dropping empty overwrites. */
export function setOverwrite(list: Overwrite[], roleId: string, bit: number, value: BitState): Overwrite[] {
  const current = list.find((o) => o.roleId === roleId) ?? { roleId, allow: 0, deny: 0 };
  const next = {
    roleId,
    allow: value === 'allow' ? current.allow | bit : current.allow & ~bit,
    deny: value === 'deny' ? current.deny | bit : current.deny & ~bit,
  };
  const rest = list.filter((o) => o.roleId !== roleId);
  return next.allow || next.deny ? [...rest, next] : rest;
}

export function stateOf(list: Overwrite[], roleId: string, bit: number): BitState {
  const o = list.find((x) => x.roleId === roleId);
  if (o && o.allow & bit) return 'allow';
  if (o && o.deny & bit) return 'deny';
  return 'inherit';
}

/** What you hold in a category with its saved overwrites applied, as the server checks it. */
export function categoryPermissions(community: CommunityView, me: string, saved: Overwrite[]): number {
  const member = community.members.find((m) => m.riverId === me);
  return computePermissions({
    ownerId: community.ownerId,
    everyoneRoleId: community.id,
    roles: community.roles,
    member: { riverId: me, roles: member?.roles ?? [] },
    overwrites: saved,
  });
}

/**
 * May you set Allow on this bit for this role? Only for what you hold there yourself, or what the
 * saved overwrite already allowed (the server refuses anything else).
 */
export function mayAllow(mine: number, saved: Overwrite[], roleId: string, bit: number): boolean {
  return (mine & bit) === bit || ((saved.find((o) => o.roleId === roleId)?.allow ?? 0) & bit) === bit;
}

/**
 * Per-role allow / inherit / deny switches for a channel or a category. Roles
 * with changes are marked; @everyone is first.
 */
export function PermissionEditor(props: {
  community: CommunityView;
  overwrites: Overwrite[];
  bits: number[];
  /** Your own permissions here and the saved overwrites: Allow is offered only where it would work. */
  mine: number;
  saved: Overwrite[];
  onChange(next: Overwrite[]): void;
}): ReactElement {
  const { community, overwrites, bits } = props;
  const [role, setRole] = useState(community.id);
  const selected = community.roles.find((r) => r.id === role) ?? community.roles.find((r) => r.everyone)!;
  const set = (bit: number, value: BitState): void =>
    props.onChange(setOverwrite(overwrites, role, bit, value));
  return (
    <div className="overwrites">
      <div className="overwrites__roles">
        <div className="field__label">{tr('Roles')}</div>
        {community.roles.map((r) => (
          <button
            key={r.id}
            className={`role-row__main ${r.id === role ? 'is-active' : ''} ${overwrites.some((o) => o.roleId === r.id) ? 'has-overwrite' : ''}`}
            onClick={() => setRole(r.id)}
          >
            <span
              className="role-chip__dot"
              style={{ background: r.color ? hex(r.color) : 'var(--text-faint)' }}
            />
            {r.name}
          </button>
        ))}
      </div>
      <div className="overwrites__bits">
        <div className="field__label">{selected.name}</div>
        {bits.map((bit) => {
          const info = infoOf(bit);
          const value = stateOf(overwrites, role, bit);
          const allowable = value === 'allow' || mayAllow(props.mine, props.saved, role, bit);
          return (
            <div key={bit} className="tri-row">
              <span className="toggle-row__text">
                <span className="toggle-row__label">{info.label}</span>
                <span className="toggle-row__help">{info.help}</span>
              </span>
              <span className="tri" role="radiogroup" aria-label={info.label}>
                <button
                  className={`tri__opt tri__opt--deny ${value === 'deny' ? 'is-on' : ''}`}
                  role="radio"
                  aria-checked={value === 'deny'}
                  aria-label={tr('Deny')}
                  title={tr('Deny')}
                  onClick={() => set(bit, 'deny')}
                >
                  ✕
                </button>
                <button
                  className={`tri__opt ${value === 'inherit' ? 'is-on' : ''}`}
                  role="radio"
                  aria-checked={value === 'inherit'}
                  aria-label={tr('Inherit')}
                  title={tr('Inherit from roles')}
                  onClick={() => set(bit, 'inherit')}
                >
                  /
                </button>
                <button
                  className={`tri__opt tri__opt--allow ${value === 'allow' ? 'is-on' : ''}`}
                  role="radio"
                  aria-checked={value === 'allow'}
                  aria-label={tr('Allow')}
                  title={allowable ? tr('Allow') : tr('You can only allow permissions you have yourself')}
                  disabled={!allowable}
                  onClick={() => set(bit, 'allow')}
                >
                  ✓
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
