/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { isPrintable, nextZoom, typingSomewhere } from '../src/renderer/src/components/QuickSwitcher.tsx';

describe('keyboard routing', () => {
  it('plain characters start a message; shortcuts and special keys do not', () => {
    const k = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
      key,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      ...mods,
    });
    expect(isPrintable(k('a'))).toBe(true);
    expect(isPrintable(k('Ж'))).toBe(true);
    expect(isPrintable(k('a', { ctrlKey: true }))).toBe(false);
    expect(isPrintable(k('Enter'))).toBe(false);
    expect(isPrintable(k('ArrowUp'))).toBe(false);
  });

  it('keys typed into fields, menus and dialogs stay there', () => {
    document.body.innerHTML = `
      <input id="i" /><textarea id="t"></textarea><div id="free"></div>
      <div role="dialog"><button id="in-dialog">x</button></div>
      <div role="menu"><button id="in-menu">y</button></div>`;
    const el = (id: string) => document.getElementById(id);
    expect(typingSomewhere(el('i'))).toBe(true);
    expect(typingSomewhere(el('t'))).toBe(true);
    expect(typingSomewhere(el('in-dialog'))).toBe(true);
    expect(typingSomewhere(el('in-menu'))).toBe(true);
    expect(typingSomewhere(el('free'))).toBe(false);
    expect(typingSomewhere(document.body)).toBe(false);
  });
});

describe('interface size', () => {
  it('steps through sizes and stops at the ends', () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(1.6, 1)).toBe(1.6);
    expect(nextZoom(0.7, -1)).toBe(0.7);
    expect(nextZoom(1.05, 1)).toBe(1.1); // from a slider value between steps
  });
});
