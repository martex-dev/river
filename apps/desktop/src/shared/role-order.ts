/**
 * Moving a role in Community settings → Roles (2.10.13). Only the roles in your reach can move,
 * and they move among themselves: roles at or above you, and roles with permissions you do not
 * have (2.20.2), keep their positions, so the server never has to refuse a step halfway through.
 * The positions already in use are reused (a swap or an insert within that range), unless two of
 * them are the same.
 */
export interface OrderedRole {
  id: string;
  position: number;
  /** The role's permissions; with `myPermissions`, a role carrying more than you hold stays put. */
  permissions?: number;
}

export type RoleMove = { roleId: string; direction: 1 | -1 } | { roleId: string; aboveId: string | null };

/**
 * Why a role is out of your reach (2.20.2), as the server decides it: you may give, take, edit,
 * move or delete a role only below your highest role (owners: any), carrying no permission you do
 * not have yourself (owners and administrators hold them all). @everyone has no rank.
 */
export type RoleReach =
  { ok: true } | { ok: false; reason: 'rank' } | { ok: false; reason: 'permissions'; missing: number };

export function roleReach(
  role: { position: number; permissions: number; everyone?: boolean },
  me: { myRank: number; permissions: number },
): RoleReach {
  if (!role.everyone && role.position >= me.myRank) return { ok: false, reason: 'rank' };
  const missing = role.permissions & ~me.permissions;
  return missing ? { ok: false, reason: 'permissions', missing } : { ok: true };
}

/** The new positions, only for the roles that change; empty when the move is not possible. */
export function roleOrderChanges(
  roles: readonly OrderedRole[],
  myRank: number,
  move: RoleMove,
  myPermissions?: number,
): OrderedRole[] {
  const movable = (r: OrderedRole): boolean =>
    r.position < myRank &&
    (myPermissions === undefined || r.permissions === undefined || (r.permissions & ~myPermissions) === 0);
  // Highest first, as the settings list shows them.
  const sorted = [...roles].sort((a, b) => b.position - a.position);
  const below = sorted.filter(movable);
  const from = below.findIndex((r) => r.id === move.roleId);
  if (from < 0) return [];
  const next = [...below];
  if ('direction' in move) {
    const to = from - move.direction; // 1 = up (a higher position)
    if (to < 0 || to >= next.length) return [];
    [next[from], next[to]] = [next[to]!, next[from]!];
  } else {
    const [moving] = next.splice(from, 1);
    let at: number;
    if (move.aboveId === null) at = next.length;
    else {
      at = next.findIndex((r) => r.id === move.aboveId);
      if (at < 0) {
        // Above a role that stays put: just above the movable roles below it (as high as you may
        // put it when that role is above you).
        const above = sorted.find((r) => r.id === move.aboveId);
        at = above ? next.findIndex((r) => r.position < above.position) : -1;
        if (at < 0) at = next.length;
      }
    }
    next.splice(at, 0, moving!);
  }
  const used = below.map((r) => r.position);
  const unique = new Set(used).size === used.length;
  // Roles that stay put below you keep their numbers, so the movable ones cannot be renumbered.
  const fixedBelow = sorted.some((r) => r.position < myRank && !movable(r));
  // Shared positions cannot express an order: number them 1..n if that still fits below you.
  const values =
    unique || fixedBelow || below.length >= myRank ? used : below.map((_, i) => below.length - i);
  return next.flatMap((r, i) => (r.position === values[i] ? [] : [{ id: r.id, position: values[i]! }]));
}
