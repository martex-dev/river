import { afterEach, describe, expect, it } from 'vitest';
import { phonePlatform } from '../../apps/mobile/core/platform.ts';

const g = globalThis as { __riverPlatform?: unknown };

afterEach(() => {
  delete g.__riverPlatform;
});

describe('phone platform', () => {
  it("takes the iOS shell's word over the user agent (an iPad's WebView looks like a Mac)", () => {
    g.__riverPlatform = 'ios';
    expect(phonePlatform()).toBe('ios');
  });

  it('falls back to the user agent, which is Android unless it names an iPhone', () => {
    expect(phonePlatform()).toBe('android');
    g.__riverPlatform = 'windows';
    expect(phonePlatform()).toBe('android');
  });
});
