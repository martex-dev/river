/**
 * Search filters (1.0.20), typed into the search box like on Discord:
 *   from:alice  in:general  has:image|video|audio|file|link|poll
 *   before:2026-10-01  after:2026-09-01  during:2026-09-15
 *   pinned:true  mentions:me
 * Everything else is plain text to look for. Pure, so main and tests share it.
 */

export type HasKind = 'image' | 'video' | 'audio' | 'file' | 'link' | 'poll';
const HAS: readonly HasKind[] = ['image', 'video', 'audio', 'file', 'link', 'poll'];

export interface SearchQuery {
  text: string;
  from: string[];
  in: string[];
  has: HasKind[];
  /** ISO instants, inclusive start / exclusive end. */
  after: string | null;
  before: string | null;
  pinned: boolean;
  mentionsMe: boolean;
}

/** Start of a local calendar day from "YYYY-MM-DD", or null. */
function day(s: string, plusDays = 0): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + plusDays);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseSearch(raw: string): SearchQuery {
  const q: SearchQuery = {
    text: '',
    from: [],
    in: [],
    has: [],
    after: null,
    before: null,
    pinned: false,
    mentionsMe: false,
  };
  const words: string[] = [];
  // Tokens: key:"quoted value", key:value, or a plain word.
  for (const m of raw.matchAll(/(\w+):"([^"]*)"|(\w+):(\S+)|(\S+)/g)) {
    const key = (m[1] ?? m[3])?.toLowerCase();
    const value = (m[2] ?? m[4] ?? '').trim();
    if (!key) {
      words.push(m[5]!);
      continue;
    }
    const v = value.toLowerCase().replace(/^[@#]/, '');
    switch (key) {
      case 'from':
        if (v) q.from.push(v);
        break;
      case 'in':
        if (v) q.in.push(v);
        break;
      case 'has':
        if ((HAS as readonly string[]).includes(v)) q.has.push(v as HasKind);
        else words.push(m[0]);
        break;
      case 'before':
        q.before = day(v) ?? q.before;
        break;
      case 'after':
        q.after = day(v, 1) ?? q.after;
        break;
      case 'during':
        if (day(v)) {
          q.after = day(v);
          q.before = day(v, 1);
        }
        break;
      case 'pinned':
        q.pinned = v === 'true' || v === 'yes';
        break;
      case 'mentions':
        q.mentionsMe = v === 'me';
        break;
      default:
        words.push(m[0]);
    }
  }
  q.text = words.join(' ').toLowerCase();
  return q;
}

/** True when the query asks for something (text or at least one filter). */
export function hasCriteria(q: SearchQuery): boolean {
  return (
    q.text.length > 0 ||
    q.from.length > 0 ||
    q.in.length > 0 ||
    q.has.length > 0 ||
    q.after !== null ||
    q.before !== null ||
    q.pinned ||
    q.mentionsMe
  );
}

export interface Searchable {
  text: string;
  sentAt: string;
  senderName: string;
  sender: string;
  pinned: boolean;
  mentionsMe: boolean;
  attachments: Array<{ name: string; mime: string }>;
  poll?: unknown;
}

const LINK = /\bhttps?:\/\/\S+/i;

function has(m: Searchable, kind: HasKind): boolean {
  switch (kind) {
    case 'image':
    case 'video':
    case 'audio':
      return m.attachments.some((a) => a.mime.startsWith(`${kind}/`));
    case 'file':
      return m.attachments.length > 0;
    case 'link':
      return LINK.test(m.text);
    case 'poll':
      return !!m.poll;
  }
}

/** Does a message match? `channelName` is the message's channel name (for in:). */
export function matchesSearch(m: Searchable, q: SearchQuery, channelName = ''): boolean {
  if (q.from.length && !q.from.some((f) => m.senderName.toLowerCase().includes(f) || m.sender === f))
    return false;
  if (q.in.length && !q.in.some((c) => channelName.toLowerCase() === c)) return false;
  if (!q.has.every((k) => has(m, k))) return false;
  if (q.after && m.sentAt < q.after) return false;
  if (q.before && m.sentAt >= q.before) return false;
  if (q.pinned && !m.pinned) return false;
  if (q.mentionsMe && !m.mentionsMe) return false;
  if (!q.text) return true;
  return (
    m.text.toLowerCase().includes(q.text) || m.attachments.some((a) => a.name.toLowerCase().includes(q.text))
  );
}
