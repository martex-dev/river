import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Small pieces shared by the channel and direct-message conversations (2.13.1): where a picker
 * opens, inserting at the caret, and keeping the newest message in view while things load.
 */

/**
 * Where a floating panel of `size` opens for the button `el`: above it and right-aligned with it,
 * or below it when there is no room above. Anchored to the button, not the pointer, so a picker
 * opened with the keyboard (a click at 0,0) opens next to its button, not in the top-left corner.
 */
export function nearButton(
  el: Element,
  size: { width: number; height: number },
  gap = 8,
): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const x = Math.max(gap, r.right - size.width);
  const above = r.top - size.height - gap;
  return { x, y: above >= gap ? above : r.bottom + gap };
}

/** The emoji picker's size (styles/community.css `.emoji-picker`). */
export const EMOJI_PICKER = { width: 340, height: 360 };

/** `text` with `insert` put where the caret is (replacing what is selected), and the caret after it. */
export function insertAt(
  text: string,
  insert: string,
  start: number | null | undefined,
  end: number | null | undefined = start,
): { text: string; caret: number } {
  const from = start === null || start === undefined ? text.length : Math.min(start, text.length);
  const to = end === null || end === undefined ? from : Math.max(from, Math.min(end, text.length));
  return { text: text.slice(0, from) + insert + text.slice(to), caret: from + insert.length };
}

/** Puts `insert` at the caret of a message box (an emoji from the picker) and keeps typing there. */
export function insertIntoBox(
  box: HTMLTextAreaElement | null,
  text: string,
  insert: string,
  setText: (text: string) => void,
): void {
  const next = insertAt(text, insert, box?.selectionStart, box?.selectionEnd);
  setText(next.text);
  if (!box) return;
  box.focus();
  // After React has written the new value.
  requestAnimationFrame(() => box.setSelectionRange(next.caret, next.caret));
}

/**
 * Ends editing a message and puts the keyboard back in the message box, as other messengers do
 * after Up arrow → edit → Enter or Escape (focus was left on nothing when the edit box went).
 */
export function stopEditing(close: () => void): void {
  close();
  requestAnimationFrame(() =>
    document.querySelector<HTMLTextAreaElement>('.chat__composer textarea')?.focus(),
  );
}

/** How far the reader is from the newest message, in px. */
export function fromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/**
 * Keeps a conversation scrolled to the newest message while it is there: when a picture, video or
 * link preview finishes loading, or the box shrinks (the message box grows, the window is resized),
 * the last message no longer slides out of view. Someone reading older messages is left alone.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, threshold = 40): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The box as it was last measured: whether the reader was at the newest message is judged
    // against that (before the picture grew it), with where they are now. Not a flag set by scroll
    // events, which arrive a frame late: a jump to the "New" line just before must count.
    let height = el.scrollHeight;
    let client = el.clientHeight;
    const measure = (): void => {
      height = el.scrollHeight;
      client = el.clientHeight;
    };
    const stick = (): void => {
      const wasAtBottom = height - el.scrollTop - client < threshold;
      if (wasAtBottom && fromBottom(el) > 0) el.scrollTop = el.scrollHeight;
      measure();
    };
    const onScroll = measure;
    el.addEventListener('scroll', onScroll, { passive: true });
    // Media load events do not bubble, but they can be caught on the way down.
    el.addEventListener('load', stick, true);
    el.addEventListener('loadedmetadata', stick, true);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(stick);
    resize?.observe(el);
    // Something added inside (a message, a link preview, a poll): the same check, right after
    // React drew it and before anything scrolls, so the height measured next is the new one.
    const added = typeof MutationObserver === 'undefined' ? null : new MutationObserver(stick);
    added?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('load', stick, true);
      el.removeEventListener('loadedmetadata', stick, true);
      resize?.disconnect();
      added?.disconnect();
    };
  }, [ref, threshold]);
}

/**
 * A message box that grows with what is typed, lines that wrap included, up to its CSS
 * max-height (then it scrolls). Phones only: a narrow box wraps after a few words, and with only
 * `rows` it would stay one line tall and hide what you wrote (2.16.1).
 */
export function useGrowToFit(ref: RefObject<HTMLTextAreaElement | null>, text: string, on: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    el.style.height = 'auto';
    const s = getComputedStyle(el);
    const extra =
      s.boxSizing === 'border-box'
        ? el.offsetHeight - el.clientHeight
        : -(parseFloat(s.paddingTop) + parseFloat(s.paddingBottom));
    el.style.height = `${el.scrollHeight + (Number.isFinite(extra) ? extra : 0)}px`;
  }, [ref, text, on]);
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) el.style.height = '';
    };
  }, [ref, on]);
}
