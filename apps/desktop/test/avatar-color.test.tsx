import { describe, expect, it } from 'vitest';
import { avatarColor } from '../src/renderer/src/community/ui/common.tsx';

/** WCAG contrast of white on an `hsl(h s% l%)` string. */
function whiteContrast(hsl: string): number {
  const [h, s, l] = (hsl.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number];
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const ch = (n: number): number => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 1.05 / (0.2126 * ch(0) + 0.7152 * ch(8) + 0.0722 * ch(4) + 0.05);
}

describe('avatar fallback colour', () => {
  it('keeps white initials readable (WCAG AA) for every hue', () => {
    for (let i = 0; i < 2000; i++) {
      const color = avatarColor(`member-${i}`);
      expect(whiteContrast(color), color).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is the same for the same person', () => {
    expect(avatarColor('abc')).toBe(avatarColor('abc'));
  });
});
