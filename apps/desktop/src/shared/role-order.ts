/**
 * Moving a role in Community settings → Roles (2.10.13). Only the roles below your own highest
 * role can move, and they move among themselves: roles at or above you keep their positions, so
 * the server never has to refuse a step halfway through. The positions already in use are
 * reused (a swap or an insert within that range), unless two of them are the same.
 */
export interface OrderedRole {
  id: string;
  position: number;
}

export type RoleMove = { roleId: string; direction: 1 | -1 } | { roleId: string; aboveId: string | null };

/** The new positions, only for the roles that change; empty when the move is not possible. */
export function roleOrderChanges(
  roles: readonly OrderedRole[],
  myRank: number,
  move: RoleMove,
): OrderedRole[] {
  // Highest first, as the settings list shows them.
  const sorted = [...roles].sort((a, b) => b.position - a.position);
  const below = sorted.filter((r) => r.position < myRank);
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
      // Above a role you cannot pass: as high as you may put it.
      if (at < 0) at = sorted.some((r) => r.id === move.aboveId) ? 0 : next.length;
    }
    next.splice(at, 0, moving!);
  }
  const used = below.map((r) => r.position);
  const unique = new Set(used).size === used.length;
  // Shared positions cannot express an order: number them 1..n if that still fits below you.
  const values = unique || below.length >= myRank ? used : below.map((_, i) => below.length - i);
  return next.flatMap((r, i) => (r.position === values[i] ? [] : [{ id: r.id, position: values[i]! }]));
}
