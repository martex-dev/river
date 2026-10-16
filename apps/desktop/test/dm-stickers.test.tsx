// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isStickerFile, stickerFile } from '../src/renderer/src/community/ui/Stickers.tsx';

describe('stickers in direct messages', () => {
  it('turn a sticker picture into a small file to send, named so apps draw it as a sticker', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const file = stickerFile('Party parrot!', png)!;
    expect(file.name).toBe('sticker-Party_parrot_.png');
    expect(file.type).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(isStickerFile(file.name, file.type)).toBe(true);
  });

  it('refuse anything that is not a picture', () => {
    expect(stickerFile('x', 'data:text/html;base64,PGI+')).toBeNull();
    expect(stickerFile('x', 'javascript:alert(1)')).toBeNull();
    expect(isStickerFile('sticker-a.pdf', 'application/pdf')).toBe(false);
    expect(isStickerFile('photo.png', 'image/png')).toBe(false);
  });
});
