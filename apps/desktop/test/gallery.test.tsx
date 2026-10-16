import { describe, expect, it } from 'vitest';
import { galleryOf } from '../src/renderer/src/community/ui/Attachments.tsx';
import type { AttachmentPointer } from '../src/shared/community-actions.ts';

const file = (id: string, mime: string): AttachmentPointer => ({
  id,
  key: 'k',
  digest: 'd',
  size: 1,
  name: `${id}.bin`,
  mime,
});

describe('image gallery', () => {
  it('collects the pictures of all messages, oldest first, and nothing else', () => {
    const gallery = galleryOf([
      [file('a', 'image/png'), file('b', 'video/mp4')],
      [],
      [file('c', 'application/pdf'), file('d', 'image/jpeg'), file('e', 'image/svg+xml')],
    ]);
    // SVG is never shown inline (it can carry scripts), so it is not in the viewer either.
    expect(gallery.map((a) => a.id)).toEqual(['a', 'd']);
  });
});
