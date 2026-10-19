import { PERMISSION_INFO, Permission } from '@river/protocol/permissions';
import type { RoleReach } from '../../../shared/role-order.ts';
import { msg, tr } from '../i18n.ts';

/** Shown where roles are given, when some are left out because they are out of your reach. */
export const OUT_OF_REACH_NOTE = msg(
  'Roles at or above your highest role, or with permissions you do not have, cannot be given or taken by you, so they are not offered.',
);

/** Why a role cannot be edited, given or moved by you, naming the permissions you lack. */
export function reachText(reach: RoleReach): string {
  if (reach.ok) return '';
  if (reach.reason === 'rank') return tr('You can only edit roles below your highest role.');
  const missing = PERMISSION_INFO.filter((p) => (reach.missing & Permission[p.key]) !== 0).map((p) =>
    tr(p.label),
  );
  return tr(
    'This role has permissions you do not have ({permissions}), so you cannot edit, give, take, move or delete it.',
    { permissions: missing.join(', ') },
  );
}
