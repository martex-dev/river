/** Small colour toolkit for the theme engine: hex ⇄ rgb, mixing, WCAG contrast. */

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0').slice(0, 6);
  const n = Number.parseInt(v, 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: Rgb): string {
  const c = (x: number): string =>
    Math.round(Math.min(255, Math.max(0, x)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** "r g b" for `rgb(var(--x-rgb) / a)` in CSS. */
export function channels(hex: string): string {
  return parseHex(hex).join(' ');
}

/** Mixes b into a: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function luminance(hex: string): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const isLight = (hex: string): boolean => luminance(hex) > 0.4;

/** Moves `fg` towards black or white until it reaches `ratio` against `bg` (or gets as close as possible). */
export function ensureContrast(fg: string, bg: string, ratio: number): string {
  if (contrast(fg, bg) >= ratio) return fg;
  // Move towards whichever extreme has more room against this background.
  const target = contrast('#000000', bg) >= contrast('#ffffff', bg) ? '#000000' : '#ffffff';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= ratio) return c;
  }
  return target;
}

/** Text that reads on a filled background (e.g. a primary button). */
export function inkOn(bg: string): string {
  return contrast('#ffffff', bg) >= contrast('#0a0a0a', bg) ? '#ffffff' : '#0a0a0a';
}

/** Scales saturation around the colour's grey: 0 = grey, 1 = unchanged, 1.5 = vivid. */
export function saturate(hex: string, amount: number): string {
  if (amount === 1) return hex;
  const [r, g, b] = parseHex(hex);
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  return toHex([grey + (r - grey) * amount, grey + (g - grey) * amount, grey + (b - grey) * amount]);
}

export const rgba = (hex: string, a: number): string => {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
};
