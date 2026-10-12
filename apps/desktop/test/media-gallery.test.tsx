import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/shared/ipc.ts';
import { mediaPosts } from '../src/renderer/src/community/ui/MediaGallery.tsx';

const msg = (id: string, mimes: string[]): ChatMessage =>
  ({
    id,
    attachments: mimes.map((mime, i) => ({ id: `${id}${i}`, mime, name: 'f', size: 1, key: '', digest: '' })),
  }) as unknown as ChatMessage;

describe('media gallery', () => {
  it('keeps messages with pictures or videos, newest first', () => {
    const list = [
      msg('1', ['image/png']),
      msg('2', ['application/pdf']),
      msg('3', ['video/mp4']),
      msg('4', []),
    ];
    expect(mediaPosts(list).map((m) => m.id)).toEqual(['3', '1']);
  });
});
