/**
 * Small pure helpers for how messages look (2.19), shared by direct messages and channels:
 * big emoji, one-line previews for replies, and long links shortened in bubbles.
 */

/** A custom community emoji as it is written in a message: <:name:id> or <a:name:id>. */
const CUSTOM_TOKEN = /<a?:([A-Za-z0-9_]{2,32}):[A-Za-z0-9_-]{22}>/g;
/** One emoji as the reader sees it (a grapheme): pictographs, flags, keycaps, skin tones, ZWJ sequences. */
const EMOJI_GRAPHEME =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}[️\p{Emoji_Modifier}\u{E0020}-\u{E007F}]*(?:‍\p{Extended_Pictographic}[️\p{Emoji_Modifier}]*)*)$/u;

let segmenter: Intl.Segmenter | null = null;
function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...segmenter.segment(text)].map((s) => s.segment);
}

/** Messages of only this many emoji (or fewer) show big, without a bubble, as in Telegram. */
export const MAX_BIG_EMOJI = 3;

/**
 * How many emoji a message is made of, when it is only emoji (1–3, spaces allowed between them);
 * 0 for anything else — text, a 4th emoji, an empty message.
 */
export function bigEmojiCount(text: string): number {
  if (!text || text.length > 200) return 0;
  let n = 0;
  const rest = text.replace(CUSTOM_TOKEN, () => {
    n++;
    return ' ';
  });
  for (const g of graphemes(rest)) {
    if (/^\s+$/u.test(g)) continue;
    if (!EMOJI_GRAPHEME.test(g)) return 0;
    if (++n > MAX_BIG_EMOJI) return 0;
  }
  return n;
}

/** Attachment names that mark a voice message and a sticker (VoiceMessage.tsx, Stickers.tsx). */
export const VOICE_NAME_PREFIX = 'voice-message';
export const STICKER_NAME_PREFIX = 'sticker-';

interface Previewable {
  text: string;
  deleted?: boolean;
  attachments: ReadonlyArray<{ name: string; mime: string }>;
  poll?: { question: string } | null;
}

const MAX_PREVIEW = 100;

/** What the attachments are, in a word or two: "Photo", "3 photos", "Voice message", "File: a.pdf". */
export function attachmentLabel(attachments: ReadonlyArray<{ name: string; mime: string }>): string {
  const first = attachments[0];
  if (!first) return '';
  const all = (test: (a: { name: string; mime: string }) => boolean): boolean => attachments.every(test);
  const n = attachments.length;
  if (all((a) => a.name.startsWith(VOICE_NAME_PREFIX) && a.mime.startsWith('audio/'))) return 'Voice message';
  if (all((a) => a.name.startsWith(STICKER_NAME_PREFIX) && a.mime.startsWith('image/'))) return 'Sticker';
  if (all((a) => a.mime === 'image/gif')) return n > 1 ? `${n} GIFs` : 'GIF';
  if (all((a) => a.mime.startsWith('image/'))) return n > 1 ? `${n} photos` : 'Photo';
  if (all((a) => a.mime.startsWith('video/'))) return n > 1 ? `${n} videos` : 'Video';
  if (all((a) => a.mime.startsWith('audio/'))) return n > 1 ? `${n} audio files` : 'Audio';
  return n > 1 ? `${n} files` : `File: ${first.name}`;
}

/** The message's text on one line, as plain as a preview should be: no Markdown, spoilers hidden. */
export function plainLine(text: string): string {
  const lines = text
    .split('\n')
    // The "↪ Forwarded from …" line a forward starts with says nothing about the message itself.
    .filter((l) => l.trim() && !/^-# ↪ /.test(l));
  const line = (lines[0] ?? '')
    .replace(/```/g, '')
    .replace(/\|\|[^|\n]+\|\|/g, 'Spoiler')
    .replace(CUSTOM_TOKEN, (_m, name: string) => `:${name}:`)
    .replace(/\[([^\]\n]{1,200})\]\((?:https?|mailto|tel):[^\s)]+\)/g, '$1')
    .replace(/<t:(\d{1,12})(?::[tTdDfFR])?>/g, (_m, unix: string) =>
      new Date(Number(unix) * 1000).toLocaleDateString(),
    )
    .replace(/^(?:#{1,3} |> |-# |\s*[-*] |\s*\d{1,4}\. )/, '')
    .replace(/(\*\*\*|\*\*|__|~~|`)(.+?)\1/g, '$2')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$)/g, '$1$2')
    .trim();
  return line.length > MAX_PREVIEW ? `${line.slice(0, MAX_PREVIEW - 1).trimEnd()}…` : line;
}

/**
 * A message on one line, for the reply bar and the quote above a reply (2.19): its text, else what
 * it holds — "Photo", "Voice message", "Poll: …" — as in Telegram.
 */
export function replyPreview(m: Previewable): string {
  if (m.deleted) return 'Deleted message';
  if (m.poll) return `Poll: ${plainLine(m.poll.question) || 'a question'}`;
  const text = plainLine(m.text);
  const kind = attachmentLabel(m.attachments);
  if (text && kind) return `${kind} · ${text}`;
  return text || kind || 'Message';
}

/** Links longer than this show shortened in a message (the whole address on hover and long-press). */
export const SHORT_LINK = 48;

/**
 * A long link made short for a bubble (2.19): the whole site name always stays — it is what tells
 * you where a link goes — and the middle of the rest gives way to "…". https:// is left out
 * (http:// stays, so an unencrypted link still says so). Short links are shown as they are.
 */
export function shortLink(href: string, max = SHORT_LINK): string {
  if (href.length <= max) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const scheme = url.protocol === 'https:' ? '' : `${url.protocol}//`;
  const host = `${scheme}${url.host}`;
  const rest = href.slice(href.indexOf(url.host) + url.host.length);
  const whole = `${host}${rest}`;
  if (whole.length <= max) return whole;
  const room = max - host.length - 1;
  if (room < 8) return `${host}${rest ? '/…' : ''}`;
  const tail = Math.min(12, Math.floor(room / 3));
  return `${host}${rest.slice(0, room - tail)}…${rest.slice(-tail)}`;
}
