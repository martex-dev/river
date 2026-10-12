import { describe, expect, it } from 'vitest';
import { clampOffset } from '../src/renderer/src/community/ui/AvatarCrop.tsx';

describe('avatar crop', () => {
  it('keeps the picture covering the frame', () => {
    // 400×200 picture in a 240 frame: scaled to 480×240, so it can move 120 px sideways and not at all up/down.
    expect(clampOffset({ x: 500, y: 50 }, { w: 400, h: 200 }, 1, 240)).toEqual({ x: 120, y: 0 });
    expect(clampOffset({ x: -500, y: -500 }, { w: 400, h: 200 }, 2, 240)).toEqual({ x: -360, y: -120 });
    expect(clampOffset({ x: 10, y: 10 }, { w: 300, h: 300 }, 1, 240)).toEqual({ x: 0, y: 0 });
  });
});
