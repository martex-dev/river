import { play } from '../community/sound.ts';
import { useRiver } from '../store.ts';
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

/**
 * Adding someone from a username, link or QR code: already a friend means their chat opens
 * (nothing is sent, and no "request sent" is claimed); anyone else gets a request.
 */
export async function addFriend(
  riverId: string,
  text: string = GREETING,
): Promise<'sent' | 'friend' | 'failed'> {
  if (friendState(riverId) === 'friend') {
    const dm = useDm.getState();
    useRiver.getState().navigate('messages');
    dm.select(riverId);
    return 'friend';
  }
  return (await sendFriendRequest(riverId, text)) ? 'sent' : 'failed';
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
