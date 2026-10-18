// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleBack, HoldTap, isTextField, keyboardInset } from '../../mobile/ui/shell.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

/** `screens`: what the phone shell's own Back can still close (0 = Chats, where Back leaves). */
const env = (screens: 0 | 1, closeTopOverlay = () => false) => {
  const back = vi.fn(() => screens > 0);
  return { env: { closeTopOverlay, doc: document, back }, back };
};

describe("the phone's Back button", () => {
  it('closes the topmost menu or dialog first', () => {
    const close = vi.fn(() => true);
    const { env: e, back } = env(1, close);
    expect(handleBack(e)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
  });

  it('shrinks a full-screen call back into its conversation (the call goes on)', () => {
    document.body.innerHTML =
      '<div class="dm-call dm-call--full"><button class="dm-call__min">⌄</button></div>';
    const min = vi.fn();
    document.querySelector('.dm-call__min')!.addEventListener('click', min);
    const { env: e, back } = env(1);
    expect(handleBack(e)).toBe(true);
    expect(min).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
  });

  it('closes Settings or a story with Escape', () => {
    document.body.innerHTML = '<div class="settings-overlay" role="dialog"></div>';
    const keys: string[] = [];
    window.addEventListener('keydown', (k) => keys.push(k.key), { once: true });
    const { env: e } = env(1);
    expect(handleBack(e)).toBe(true);
    expect(keys).toEqual(['Escape']);
  });

  it('then asks the phone shell, and leaves River when the shell has nothing to close', () => {
    const open = env(1);
    expect(handleBack(open.env)).toBe(true);
    expect(open.back).toHaveBeenCalledOnce();
    const chats = env(0);
    expect(handleBack(chats.env)).toBe(false);
    expect(chats.back).toHaveBeenCalledOnce();
  });
});

describe('the on-screen keyboard', () => {
  it('counts what it covers only where it does not resize the page', () => {
    expect(keyboardInset(800, null)).toBe(0);
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0); // Android: page resized
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300); // iPhone
    expect(keyboardInset(800, { height: 500, offsetTop: 100 })).toBe(200); // page panned up
    expect(keyboardInset(800, { height: 760, offsetTop: 0 })).toBe(0); // a toolbar, not a keyboard
  });
});

describe('the tap after a long press on iPhone', () => {
  it('is ignored once, right after the press', () => {
    const t = new HoldTap();
    t.start();
    t.held();
    t.end(1000);
    expect(t.swallow(1100)).toBe(true);
    expect(t.swallow(1150)).toBe(false);
  });

  it('is not remembered past a moment or a new touch', () => {
    const t = new HoldTap();
    t.start();
    t.held();
    t.end(1000);
    expect(t.swallow(1600)).toBe(false);
    t.start();
    t.held();
    t.end(2000);
    t.start(); // the next tap
    expect(t.swallow(2050)).toBe(false);
    // A plain tap is never ignored.
    t.end(2060);
    expect(t.swallow(2070)).toBe(false);
  });

  it('leaves text fields their own long press', () => {
    document.body.innerHTML = '<textarea></textarea><div contenteditable="true"><b>x</b></div><p>y</p>';
    expect(isTextField(document.querySelector('textarea'))).toBe(true);
    expect(isTextField(document.querySelector('b'))).toBe(true);
    expect(isTextField(document.querySelector('p'))).toBe(false);
  });
});
