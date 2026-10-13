import { describe, expect, it } from 'vitest';
import { HIGHLIGHTS, whatsNew } from '../src/renderer/src/whats-new.ts';

describe("what's new (1.0.40)", () => {
  it('shows the highlights once after an update', () => {
    expect(whatsNew('1.0.40', '1.0.39')).toEqual(HIGHLIGHTS['1.0.40']);
    expect(whatsNew('1.0.40', '1.0.40')).toBeNull();
  });
  it('stays quiet on a fresh install and for versions without highlights', () => {
    expect(whatsNew('1.0.40', null)).toBeNull();
    expect(whatsNew('9.9.9', '1.0.40')).toBeNull();
  });
});
