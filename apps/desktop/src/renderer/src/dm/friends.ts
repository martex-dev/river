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

/** What adding someone did: see addFriendMessage for what to tell the person. */
export type AddFriendResult = 'sent' | 'friend' | 'already-sent' | 'accepted' | 'blocked' | 'failed';

function openChat(riverId: string): void {
  useRiver.getState().navigate('messages');
  useDm.getState().select(riverId);
}

/**
 * Adding someone from a username, link or QR code. Nothing is claimed that did not happen:
 * - already a friend: their chat opens, nothing is sent;
 * - you already sent them a request: no second greeting;
 * - they asked you first: their request is accepted (you are friends now) and the chat opens;
 * - you blocked them: nothing happens until you unblock them;
 * - anyone else gets a request.
 */
export async function addFriend(riverId: string, text: string = GREETING): Promise<AddFriendResult> {
  switch (friendState(riverId)) {
    case 'friend':
      openChat(riverId);
      return 'friend';
    case 'sent':
      return 'already-sent';
    case 'blocked':
      return 'blocked';
    case 'request': {
      // (The conversation update that follows plays the "now friends" sound.)
      if (!(await useDm.getState().attempt({ a: 'accept', peer: riverId }))) return 'failed';
      openChat(riverId);
      return 'accepted';
    }
    case 'none':
      return (await sendFriendRequest(riverId, text)) ? 'sent' : 'failed';
  }
}

/** The line to show after addFriend. */
export function addFriendMessage(result: AddFriendResult, name?: string): string {
  const who = name ?? 'This person';
  switch (result) {
    case 'sent':
      return 'Friend request sent';
    case 'friend':
      return `${who} is already your friend — here is your chat.`;
    case 'already-sent':
      return `You already sent ${name ?? 'them'} a friend request. It waits for their answer.`;
    case 'accepted':
      return `You are now friends${name ? ` with ${name}` : ''}`;
    case 'blocked':
      return `You blocked ${name ?? 'this person'}. Unblock them in Messages first.`;
    case 'failed':
      return 'Could not send the request. Try again.';
  }
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
