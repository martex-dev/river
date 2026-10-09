/**
 * A quick check for "this text is a River invite link", used by the renderer to
 * offer joining when a link is pasted. Main parses and validates it properly.
 */
const INVITE_RE = /^https?:\/\/[^\s#]+\/join#c=[A-Za-z0-9_-]{22}&k=[A-Za-z0-9_-]{43}(&e=\d{1,7})?$/;

export function looksLikeInvite(text: string): boolean {
  return INVITE_RE.test(text.trim());
}

/** The server part of an invite link, for showing where you are about to join. */
export function inviteHost(text: string): string {
  try {
    return new URL(text.trim()).host;
  } catch {
    return '';
  }
}
