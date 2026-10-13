/** How much quieter others get while a priority speaker talks (Discord uses about the same). */
export const DUCKED = 0.25;

/**
 * Volume factor for one person in a call (1.0.33). While someone who is
 * allowed to (`allowed`) has Priority speaker on (`on`) and is speaking,
 * everyone else is turned down. A peer saying "priority" without the
 * permission is ignored, so nobody can duck a call by just claiming it.
 */
export function priorityFactor(
  peerId: string,
  speaking: ReadonlySet<string>,
  on: ReadonlySet<string>,
  allowed: readonly string[],
): number {
  if (on.has(peerId) && allowed.includes(peerId)) return 1;
  for (const id of on) if (id !== peerId && allowed.includes(id) && speaking.has(id)) return DUCKED;
  return 1;
}
