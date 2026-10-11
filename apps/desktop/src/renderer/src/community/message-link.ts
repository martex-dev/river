/**
 * Links to a message (1.0.17): `<server>/channels/<community>/<channel>/<message>`.
 * Inside River they open the message directly; in a browser the server shows
 * a short "open River" page. They reveal nothing: only members who can see the
 * channel can read the message.
 */
const ID = '[A-Za-z0-9_-]{22}';
const LINK = new RegExp(`^https?://[^/\\s]+(?:/[^\\s]*)?/channels/(${ID})/(${ID})/(${ID})$`);

export interface MessageLink {
  communityId: string;
  channelId: string;
  messageId: string;
}

export function formatMessageLink(server: string, link: MessageLink): string {
  return `${server.replace(/\/+$/, '')}/channels/${link.communityId}/${link.channelId}/${link.messageId}`;
}

export function parseMessageLink(url: string): MessageLink | null {
  const m = LINK.exec(url.trim());
  return m ? { communityId: m[1]!, channelId: m[2]!, messageId: m[3]! } : null;
}

let opener: ((link: MessageLink) => boolean) | null = null;

/** How message links open inside River (set by the community store at start). */
export function setMessageLinkOpener(fn: (link: MessageLink) => boolean): void {
  opener = fn;
}

/** Opens a message link inside River; false if it is not one (or no opener is set). */
export function openMessageLink(url: string): boolean {
  const link = parseMessageLink(url);
  if (!link || !opener) return false;
  opener(link);
  return true;
}
