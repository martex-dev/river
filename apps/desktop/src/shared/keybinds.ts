import { msg } from './i18n/index.ts';

/**
 * Customisable keyboard shortcuts (1.0.22). A combo is written like
 * "Ctrl+Shift+KeyM": modifiers in a fixed order, then a KeyboardEvent.code.
 * An empty string means "no shortcut". Pure, so it is shared and tested.
 */

export const KEYBIND_ACTIONS = ['toggleMute', 'toggleDeafen', 'toggleCamera', 'leaveVoice'] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];
export type Keybinds = Record<KeybindAction, string>;

export const DEFAULT_KEYBINDS: Keybinds = {
  toggleMute: 'Ctrl+Shift+KeyM',
  toggleDeafen: 'Ctrl+Shift+KeyD',
  toggleCamera: '',
  leaveVoice: '',
};

export const KEYBIND_LABELS: Record<KeybindAction, string> = {
  toggleMute: msg('Mute / unmute'),
  toggleDeafen: msg('Deafen / undeafen'),
  toggleCamera: msg('Camera on / off'),
  leaveVoice: msg('Leave voice'),
};

/** Shortcuts River already uses; a custom one that equals these would clash. */
export const BUILT_IN: Array<[string, string]> = [
  ['Ctrl+KeyK', msg('Quick switcher')],
  ['Ctrl+Slash', msg('Keyboard shortcuts')],
  ['Ctrl+KeyF', msg('Search')],
  ['Ctrl+Equal', msg('Bigger interface')],
  ['Ctrl+Minus', msg('Smaller interface')],
  ['Ctrl+Digit0', msg('Normal size')],
  ['Alt+ArrowUp', msg('Previous channel')],
  ['Alt+ArrowDown', msg('Next channel')],
  ['Alt+ArrowLeft', msg('Back')],
  ['Alt+ArrowRight', msg('Forward')],
  ['Ctrl+Alt+ArrowUp', msg('Previous community')],
  ['Ctrl+Alt+ArrowDown', msg('Next community')],
  ['Escape', msg('Mark as read / close')],
];

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

interface KeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** The combo for a key press, or null while only modifiers are held. Ctrl and ⌘ count as the same. */
export function comboOf(e: KeyLike): string | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.code);
  return parts.join('+');
}

export const matches = (combo: string, e: KeyLike): boolean => !!combo && comboOf(e) === combo;

/** A safe combo for a shortcut: needs Ctrl or Alt unless it is a function key, so typing never triggers it. */
export function usable(combo: string): boolean {
  if (!combo) return true;
  const code = combo.split('+').at(-1)!;
  return combo.includes('Ctrl+') || combo.includes('Alt+') || /^F\d{1,2}$/.test(code);
}

/** What else a combo is already used for, if anything. */
export function clashOf(combo: string, binds: Keybinds, self: KeybindAction): string | null {
  if (!combo) return null;
  const builtIn = BUILT_IN.find(([c]) => c === combo);
  if (builtIn) return builtIn[1];
  const other = KEYBIND_ACTIONS.find((a) => a !== self && binds[a] === combo);
  return other ? KEYBIND_LABELS[other] : null;
}

/** "Ctrl+Shift+M" for people, from "Ctrl+Shift+KeyM". */
export function comboLabel(combo: string, mac = false): string {
  if (!combo) return msg('Not set');
  return combo
    .split('+')
    .map((p) =>
      p === 'Ctrl'
        ? mac
          ? '⌘'
          : 'Ctrl'
        : p === 'Alt'
          ? mac
            ? '⌥'
            : 'Alt'
          : p === 'Shift'
            ? mac
              ? '⇧'
              : 'Shift'
            : keyName(p),
    )
    .join(mac ? '' : '+');
}

export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    Backquote: '`',
    Minus: '−',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
  };
  return names[code] ?? code;
}

/** Fills in missing actions from older settings files. */
export function withDefaults(raw: Partial<Keybinds> | undefined): Keybinds {
  return { ...DEFAULT_KEYBINDS, ...(raw ?? {}) };
}
