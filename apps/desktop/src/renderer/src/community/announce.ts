import type { ChatMessage } from '../../../shared/ipc.ts';
import { fill, msg, type Vars } from '../../../shared/i18n/index.ts';

/**
 * What a screen reader should hear when a message arrives while you are in
 * the channel (1.0.38): only messages from others that are newer than the
 * last one already shown, so loading older history stays silent.
 */
export function announcement(
  previousLast: ChatMessage | undefined,
  last: ChatMessage | undefined,
  t: (text: string, vars?: Vars) => string = fill,
  tn: (key: string, count: number, vars?: Vars) => string = (key, count, vars) =>
    fill(key, { count, ...vars }),
): string | null {
  if (!previousLast || !last || last.id === previousLast.id || last.mine) return null;
  if (Date.parse(last.sentAt) < Date.parse(previousLast.sentAt)) return null;
  const what = last.text.trim()
    ? last.text.trim().slice(0, 200)
    : last.sticker
      ? t(msg('sent a sticker'))
      : last.attachments.length === 1
        ? t(msg('sent a file'))
        : last.attachments.length
          ? tn('sent {count} files', last.attachments.length)
          : last.poll
            ? t(msg('started a poll'))
            : t(msg('sent a message'));
  return `${last.senderName}: ${what}`;
}
