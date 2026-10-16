/**
 * Enter in a message box (2.10.12). On a computer it sends (Shift+Enter is a new line). On a phone
 * the keyboard's Return key is for new lines, as in other messengers; the Send button sends. And
 * never while an input method is still composing (Japanese, Chinese, Korean…): that Enter picks
 * the characters, it does not send them half-typed.
 */

export interface EnterKey {
  key: string;
  shiftKey: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
  isComposing?: boolean;
}

/** True while an input method is composing: the key belongs to it. */
export function composing(e: EnterKey): boolean {
  // 229: the key code browsers report for keys an input method takes (Safari reports no isComposing).
  return !!(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229;
}

/** True when this key press sends the message. */
export function enterSends(e: EnterKey, phone: boolean): boolean {
  if (e.key !== 'Enter' || e.shiftKey || composing(e)) return false;
  return !phone;
}
