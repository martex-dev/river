import { create } from 'zustand';
import type { FeedView, SocialAction, SocialActionResult } from '../../../shared/social.ts';
import type { Result } from '../../../shared/ipc.ts';
import { useCommunity } from '../community/store.ts';

interface SocialState {
  feed: FeedView | null;
  load(): Promise<void>;
  run<A extends SocialAction>(action: A): Promise<SocialActionResult<A> | null>;
}

let reloadTimer: number | undefined;

export const useSocial = create<SocialState>((set, get) => ({
  feed: null,
  load: async () => {
    const res = await window.river.social.action({ a: 'feed' });
    if (res.ok) set({ feed: res.value });
  },
  run: async (action) => {
    const res = (await window.river.social.action(action)) as Result<SocialActionResult<typeof action>>;
    if (!res.ok) {
      useCommunity.getState().notify(res.message, 'error');
      return null;
    }
    void get().load();
    return res.value;
  },
}));

/** Feed changed in main (new post, comment, view…): reload, at most every 250 ms. */
export function onSocialChanged(): void {
  window.clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => void useSocial.getState().load(), 250);
}
