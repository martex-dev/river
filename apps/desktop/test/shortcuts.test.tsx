/** @vitest-environment jsdom */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  QuickSwitcher,
  activates,
  isPrintable,
  keysForField,
  nextZoom,
  typingSomewhere,
} from '../src/renderer/src/components/QuickSwitcher.tsx';

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

  it('Alt+↑/↓ stay with fields and dialogs, but work from the message box', () => {
    document.body.innerHTML = `
      <select id="s"></select><div class="chat__composer"><textarea id="box"></textarea></div>
      <textarea id="other"></textarea><div role="dialog"><button id="d">x</button></div><div id="free"></div>`;
    const el = (id: string) => document.getElementById(id);
    expect(keysForField(el('s'))).toBe(true);
    expect(keysForField(el('other'))).toBe(true);
    expect(keysForField(el('d'))).toBe(true);
    expect(keysForField(el('box'))).toBe(false);
    expect(keysForField(el('free'))).toBe(false);
  });

  it('Space on a focused button presses it instead of jumping to the message box', () => {
    document.body.innerHTML = `
      <div class="chat__composer"><textarea id="box"></textarea></div>
      <button id="b">Like</button><div id="free" tabindex="0"></div>`;
    const { unmount } = render(<QuickSwitcher />);
    const button = document.getElementById('b')!;
    expect(activates(button)).toBe(true);
    button.focus();
    fireEvent.keyDown(button, { key: ' ' });
    expect(document.activeElement).toBe(button);
    // A letter still goes to the message box.
    fireEvent.keyDown(button, { key: 'a' });
    expect(document.activeElement?.id).toBe('box');
    unmount();
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
