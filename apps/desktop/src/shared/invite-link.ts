/**
 * A quick check for "this text is a River invite link", used by the renderer to
 * offer joining when a link is pasted. Main parses and validates it properly.
 */
const INVITE_RE = /^https?:\/\/[^\s#]+\/join#c=[A-Za-z0-9_-]{22}&k=[A-Za-z0-9_-]{43}(&e=\d{1,7})?$/;

export function looksLikeInvite(text: string): boolean {
  return INVITE_RE.test(text.trim());
}

/** The first invite link inside a message, e.g. "Join me in The Crew: https://…/join#c=…&k=…". */
export function findInvite(text: string): string | null {
  for (const word of text.split(/\s+/)) if (looksLikeInvite(word)) return word;
  return null;
}

/** The server part of an invite link, for showing where you are about to join. */
export function inviteHost(text: string): string {
  try {
    return new URL(text.trim()).host;
  } catch {
    return '';
  }
}

const RIVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A link that tells River "add me as a friend": `<server>/add#<River ID>`. */
export function friendLink(serverUrl: string, riverId: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/add#${riverId}`;
}

/** A friend link or a bare River ID → who to add (and on which server, for links). */
export function parseFriend(text: string): { riverId: string; serverUrl: string | null } | null {
  const value = text.trim();
  if (RIVER_ID.test(value)) return { riverId: value.toLowerCase(), serverUrl: null };
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !url.pathname.endsWith('/add')) return null;
    const riverId = url.hash.slice(1);
    if (!RIVER_ID.test(riverId)) return null;
    return {
      riverId: riverId.toLowerCase(),
      serverUrl: `${url.origin}${url.pathname.slice(0, -'/add'.length)}`,
    };
  } catch {
    return null;
  }
}
