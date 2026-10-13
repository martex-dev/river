import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/shared/ipc.ts';
import { announcement } from '../src/renderer/src/community/announce.ts';

const msg = (id: string, sentAt: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id,
    sentAt,
    senderName: 'Ada',
    text: 'hello',
    mine: false,
    attachments: [],
    ...extra,
  }) as ChatMessage;

describe('screen reader announcements (1.0.38)', () => {
  const a = msg('a', '2026-10-13T10:00:00.000Z');
  it('announces a new message from someone else', () => {
    expect(announcement(a, msg('b', '2026-10-13T10:01:00.000Z'))).toBe('Ada: hello');
  });
  it('stays quiet for my own messages, the first load and older history', () => {
    expect(announcement(a, msg('b', '2026-10-13T10:01:00.000Z', { mine: true }))).toBeNull();
    expect(announcement(undefined, a)).toBeNull();
    expect(announcement(a, msg('z', '2026-10-13T09:00:00.000Z'))).toBeNull();
    expect(announcement(a, a)).toBeNull();
  });
  it('describes messages without text', () => {
    const files = msg('c', '2026-10-13T10:02:00.000Z', {
      text: '',
      attachments: [{}, {}] as ChatMessage['attachments'],
    });
    expect(announcement(a, files)).toBe('Ada: sent 2 files');
  });
});
