// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeTopOverlay,
  overlayCount,
  placeWithin,
  pushOverlay,
} from '../src/renderer/src/components/overlays.ts';
import { Modal, Popover } from '../src/renderer/src/community/ui/common.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const escape = (): void => void fireEvent.keyDown(window, { key: 'Escape' });
/** Popovers start listening for outside presses on the next tick. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};

describe('overlay stack', () => {
  it('closes only the topmost overlay on Escape, and nothing when none is open', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = pushOverlay(first);
    const b = pushOverlay(second);
    const other = vi.fn();
    window.addEventListener('keydown', other);
    escape();
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    // Other Escape listeners do not also close their things.
    expect(other).not.toHaveBeenCalled();
    b.remove();
    expect(closeTopOverlay()).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    a.remove();
    expect(overlayCount()).toBe(0);
    expect(closeTopOverlay()).toBe(false);
    escape();
    expect(other).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', other);
  });

  it('keeps a panel inside the visible screen, above the keyboard and clear of the notch', () => {
    const view = { left: 0, top: 0, width: 400, height: 500 };
    const insets = { top: 40, right: 0, bottom: 20, left: 0 };
    expect(placeWithin(10, 10, { width: 100, height: 100 }, view, insets)).toEqual({
      left: 10,
      top: 48,
      maxHeight: 424,
    });
    // Too far right and down: pulled back in.
    expect(placeWithin(380, 480, { width: 100, height: 100 }, view, insets)).toMatchObject({
      left: 292,
      top: 372,
    });
    // Taller than the screen: starts at the top and may be at most as tall as the visible part.
    expect(placeWithin(0, 300, { width: 100, height: 900 }, view, insets)).toMatchObject({
      top: 48,
      maxHeight: 424,
    });
  });
});

function Menus(): ReactElement {
  const [menu, setMenu] = useState(false);
  const [other, setOther] = useState(false);
  return (
    <div className="msg" data-testid="msg">
      <button onClick={() => setMenu((m) => !m)}>Open menu</button>
      <button onClick={() => setOther(true)}>Open other</button>
      {menu && (
        <Popover x={10} y={10} onClose={() => setMenu(false)} className="menu">
          <button>First item</button>
        </Popover>
      )}
      {other && (
        <Popover x={10} y={10} onClose={() => setOther(false)}>
          <span>Other panel</span>
        </Popover>
      )}
    </div>
  );
}

describe('dialogs and menus', () => {
  it('render into the page body, not inside the message they come from', () => {
    render(
      <div className="msg" data-testid="msg">
        <Modal title="Hello" onClose={() => undefined}>
          <p>Inside</p>
        </Modal>
      </div>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Hello' });
    expect(screen.getByTestId('msg').contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
  });

  it('Escape closes the menu above a dialog first, then the dialog', async () => {
    const closeModal = vi.fn();
    function Both(): ReactElement {
      const [menu, setMenu] = useState(false);
      return (
        <Modal title="Dialog" onClose={closeModal}>
          <button onClick={() => setMenu(true)}>More</button>
          {menu && (
            <Popover x={0} y={0} onClose={() => setMenu(false)}>
              <span>Menu</span>
            </Popover>
          )}
        </Modal>
      );
    }
    render(<Both />);
    fireEvent.click(screen.getByText('More'));
    await settle();
    escape();
    expect(screen.queryByText('Menu')).toBeNull();
    expect(closeModal).not.toHaveBeenCalled();
    escape();
    expect(closeModal).toHaveBeenCalledOnce();
  });

  it('a press outside closes a menu; pressing the button that opened it closes it for good', async () => {
    render(<Menus />);
    fireEvent.click(screen.getByText('Open menu'));
    await settle();
    expect(screen.getByText('First item')).toBeTruthy();
    // A press inside does not close it.
    fireEvent.pointerDown(screen.getByText('First item'));
    expect(screen.queryByText('First item')).not.toBeNull();
    // The trigger: its press closes the menu and its click does not open it again.
    fireEvent.pointerDown(screen.getByText('Open menu'));
    fireEvent.click(screen.getByText('Open menu'));
    expect(screen.queryByText('First item')).toBeNull();
    // And it still works as a button afterwards.
    fireEvent.click(screen.getByText('Open menu'));
    await settle();
    expect(screen.queryByText('First item')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('First item')).toBeNull();
  });

  it('opening a menu closes the other one, and scrolling away (not River scrolling) closes it', async () => {
    render(<Menus />);
    fireEvent.click(screen.getByText('Open menu'));
    await settle();
    fireEvent.click(screen.getByText('Open other'));
    expect(screen.queryByText('First item')).toBeNull();
    expect(screen.getByText('Other panel')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 320));
    });
    // River scrolling the chat to a new message (or the keyboard opening) does not close it…
    fireEvent.scroll(screen.getByTestId('msg'));
    fireEvent.scroll(document);
    expect(screen.getByText('Other panel')).toBeTruthy();
    // …the reader scrolling away does.
    fireEvent.wheel(screen.getByTestId('msg'));
    expect(screen.queryByText('Other panel')).toBeNull();
  });

  it('leaves Escape to a field that uses it itself (cancelling a rename inside a dialog)', () => {
    const close = vi.fn();
    const layer = pushOverlay(close);
    const input = document.createElement('input');
    input.setAttribute('data-own-escape', '');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    layer.remove();
    input.remove();
  });
});
