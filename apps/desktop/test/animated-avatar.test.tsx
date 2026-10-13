import { describe, expect, it } from 'vitest';
import { avatarSchema } from '../src/shared/community-actions.ts';
import { KEEP_GIF_BYTES, animatedAvatar } from '../src/renderer/src/community/ui/AvatarCrop.tsx';

const gif = (size: number): Uint8Array => {
  const b = new Uint8Array(size);
  b.set([...'GIF89a'].map((c) => c.charCodeAt(0)));
  return b;
};

describe('animated avatars (1.0.34)', () => {
  it('keeps small real GIFs as they are, within the avatar limit', () => {
    const url = animatedAvatar(gif(KEEP_GIF_BYTES))!;
    expect(url.startsWith('data:image/gif;base64,')).toBe(true);
    expect(avatarSchema.safeParse(url).success).toBe(true);
  });
  it('crops larger GIFs and anything that is not really a GIF', () => {
    expect(animatedAvatar(gif(KEEP_GIF_BYTES + 1))).toBeNull();
    expect(animatedAvatar(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]))).toBeNull();
  });
});
