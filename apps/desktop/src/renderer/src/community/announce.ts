import type { ChatMessage } from '../../../shared/ipc.ts';

/**
 * What a screen reader should hear when a message arrives while you are in
 * the channel (1.0.38): only messages from others that are newer than the
 * last one already shown, so loading older history stays silent.
 */
export function announcement(
  previousLast: ChatMessage | undefined,
  last: ChatMessage | undefined,
): string | null {
  if (!previousLast || !last || last.id === previousLast.id || last.mine) return null;
  if (Date.parse(last.sentAt) < Date.parse(previousLast.sentAt)) return null;
  const what = last.text.trim()
    ? last.text.trim().slice(0, 200)
    : last.sticker
      ? 'sent a sticker'
      : last.attachments.length
        ? `sent ${last.attachments.length === 1 ? 'a file' : `${last.attachments.length} files`}`
        : last.poll
          ? 'started a poll'
          : 'sent a message';
  return `${last.senderName}: ${what}`;
}
