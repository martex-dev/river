import { play } from '../community/sound.ts';
import { useDm } from './store.ts';

export const GREETING = "Hi! Let's be friends on River 👋";

/**
 * Opens an end-to-end encrypted conversation and sends a first message. On the
 * other side it arrives as a request they can accept, which makes you friends.
 */
export async function sendFriendRequest(riverId: string, text: string = GREETING): Promise<boolean> {
  const dm = useDm.getState();
  const conversation = await dm.run({ a: 'open', peer: riverId });
  if (!conversation) return false;
  const sent = await dm.run({ a: 'send', peer: riverId, text });
  if (!sent) return false;
  play('send');
  return true;
}

/** Your relationship with someone, from your conversations. */
export function friendState(riverId: string): 'friend' | 'sent' | 'request' | 'blocked' | 'none' {
  const c = useDm.getState().conversations.find((x) => x.kind === 'direct' && x.riverId === riverId);
  if (!c) return 'none';
  if (c.state === 'accepted') return c.awaitingReply ? 'sent' : 'friend';
  if (c.state === 'request') return 'request';
  if (c.state === 'blocked') return 'blocked';
  return 'none';
}
