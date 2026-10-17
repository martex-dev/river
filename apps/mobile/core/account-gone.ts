import type { AccountStatus } from '../../desktop/src/shared/ipc.ts';

/**
 * The account this phone was signed in to is gone (2.11.2): signed out, set up again as another
 * account, or the server no longer knows it (removed). Its message notifications must not stay
 * readable then, so the Android shell drops them.
 */
export function accountGone(prev: AccountStatus | null, next: AccountStatus): boolean {
  if (prev?.state !== 'registered' || prev.missing) return false;
  if (next.state !== 'registered') return true;
  return !!next.missing || next.riverId !== prev.riverId;
}
