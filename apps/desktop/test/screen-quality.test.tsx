import { describe, expect, it } from 'vitest';
import { screenConstraints } from '../src/renderer/src/community/screen-quality.ts';

describe('screen share quality', () => {
  it('maps each choice to resolution and frame-rate limits', () => {
    expect(screenConstraints('detail').video.frameRate).toEqual({ ideal: 15, max: 15 });
    expect(screenConstraints('motion')).toMatchObject({
      contentHint: 'motion',
      video: { frameRate: { max: 60 } },
    });
    expect(screenConstraints('balanced').video.height).toEqual({ max: 720 });
  });
});
