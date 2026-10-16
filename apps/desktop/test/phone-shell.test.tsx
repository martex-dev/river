// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleBack, HoldTap, isTextField, keyboardInset } from '../../mobile/ui/shell.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

const env = (pane: 'nav' | 'main', closeTopOverlay = () => false) => {
  const showList = vi.fn();
  return { env: { closeTopOverlay, doc: document, pane, showList }, showList };
};

describe("the phone's Back button", () => {
  it('closes the topmost menu or dialog first', () => {
    const close = vi.fn(() => true);
    const { env: e, showList } = env('main', close);
    expect(handleBack(e)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(showList).not.toHaveBeenCalled();
  });

  it('shrinks a full-screen call back into its conversation (the call goes on)', () => {
    document.body.innerHTML =
      '<div class="dm-call dm-call--full"><button class="dm-call__min">⌄</button></div>';
    const min = vi.fn();
    document.querySelector('.dm-call__min')!.addEventListener('click', min);
    const { env: e, showList } = env('main');
    expect(handleBack(e)).toBe(true);
    expect(min).toHaveBeenCalledOnce();
    expect(showList).not.toHaveBeenCalled();
  });

  it('closes Settings or a story with Escape', () => {
    document.body.innerHTML = '<div class="settings-overlay" role="dialog"></div>';
    const keys: string[] = [];
    window.addEventListener('keydown', (k) => keys.push(k.key), { once: true });
    const { env: e } = env('main');
    expect(handleBack(e)).toBe(true);
    expect(keys).toEqual(['Escape']);
  });

  it('goes from a conversation to the list, and from the list out of River', () => {
    const main = env('main');
    expect(handleBack(main.env)).toBe(true);
    expect(main.showList).toHaveBeenCalledOnce();
    const nav = env('nav');
    expect(handleBack(nav.env)).toBe(false);
    expect(nav.showList).not.toHaveBeenCalled();
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
