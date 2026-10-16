import { describe, expect, it } from 'vitest';
import { albumTile, galleryOf } from '../src/renderer/src/community/ui/Attachments.tsx';
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

  it('lays out albums: the first of three pictures is wide, every other one square', () => {
    expect([0, 1, 2].map((i) => albumTile(3, i))).toEqual([2, 1, 1]);
    expect([0, 1].map((i) => albumTile(2, i))).toEqual([1, 1]);
    expect([0, 1, 2, 3].map((i) => albumTile(4, i))).toEqual([1, 1, 1, 1]);
  });
});
