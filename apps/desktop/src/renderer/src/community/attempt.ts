import type { CommunityAction } from '../../../shared/community-actions.ts';
import { useCommunity } from './store.ts';

/**
 * Runs a community action that has no result (create a thread, edit, set a nickname…): true when
 * it worked, else false with the error shown as a toast. The store's run() returns null for these
 * whether or not they worked, so callers cannot tell from it (2.10.12).
 */
export async function attempt(action: CommunityAction): Promise<boolean> {
  const res = await window.river.community.action(action);
  if (!res.ok) useCommunity.getState().notify(res.message, 'error');
  return res.ok;
}
