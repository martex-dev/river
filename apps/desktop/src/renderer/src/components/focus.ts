/**
 * Keyboard focus for dialogs and menus (2.13.1): a dialog keeps Tab inside itself, a menu's items
 * are reached with the arrow keys, and closing either gives the keyboard back to where it was.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/** What Tab can reach inside `root`, in order (not what is hidden). */
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[hidden], [inert], [aria-hidden="true"]'),
  );
}

/**
 * Tab and Shift+Tab inside `root`: from the last control to the first and back, never out to
 * the page behind a dialog. True when it moved the focus (the key press is then handled).
 */
export function trapTab(root: HTMLElement, e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
  if (e.key !== 'Tab') return false;
  const list = focusables(root);
  const active = document.activeElement;
  const inside = active instanceof Node && root.contains(active);
  if (list.length === 0) {
    root.focus({ preventScroll: true });
    return true;
  }
  const first = list[0]!;
  const last = list.at(-1)!;
  if (e.shiftKey && (!inside || active === first || active === root)) {
    last.focus();
    return true;
  }
  if (!e.shiftKey && (!inside || active === last)) {
    first.focus();
    return true;
  }
  return false;
}

/** The menu item the arrow keys move to from `current` (wrapping), or null for other keys. */
export function nextMenuItem(items: HTMLElement[], current: Element | null, key: string): HTMLElement | null {
  if (items.length === 0) return null;
  const at = current ? items.indexOf(current as HTMLElement) : -1;
  switch (key) {
    case 'ArrowDown':
      return items[(at + 1) % items.length]!;
    case 'ArrowUp':
      return items[(at - 1 + items.length) % items.length]!;
    case 'Home':
      return items[0]!;
    case 'End':
      return items.at(-1)!;
    default:
      return null;
  }
}

/** The enabled menu items in `root`, in order. */
export function menuItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
    (el) => !(el as HTMLButtonElement).disabled && !el.closest('[hidden]'),
  );
}

/**
 * Gives the keyboard back to `previous` once an overlay has closed, if the focus went with the
 * overlay (it is on nothing, or still inside it). If something else took the focus meanwhile (a
 * menu item that focuses the message box), that is left alone.
 */
export function restoreFocus(previous: Element | null, overlay: Element | null): void {
  if (!(previous instanceof HTMLElement) || !previous.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body && !(overlay?.contains(active) ?? false)) return;
  previous.focus({ preventScroll: true });
}
