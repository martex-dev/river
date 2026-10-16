/** Input types you do not type text into (a push-to-talk key there is not typing). */
const NOT_TEXT = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether `target` is somewhere you type text: a text field, a text area or editable content. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: boolean; type?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return !NOT_TEXT.has(typeof el.type === 'string' ? el.type.toLowerCase() : 'text');
}

/**
 * Whether a push-to-talk key press is really someone typing, so it must reach
 * the text field and not open the microphone. That is a key that writes a
 * character (the default key, `, does) into a text field; keys that write
 * nothing (F-keys, Ctrl, mouse-side buttons) keep working while you type.
 */
export function pttKeyIsTyping(e: {
  target: EventTarget | null;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): boolean {
  if (!isTypingTarget(e.target)) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1 || e.key === 'Dead';
}
