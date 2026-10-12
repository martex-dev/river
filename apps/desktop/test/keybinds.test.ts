import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDS,
  clashOf,
  comboLabel,
  comboOf,
  matches,
  usable,
  withDefaults,
} from '../src/shared/keybinds.ts';

const key = (
  code: string,
  mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {},
) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('keybinds', () => {
  it('writes combos in a fixed order and ignores lone modifiers', () => {
    expect(comboOf(key('KeyM', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+KeyM');
    expect(comboOf(key('KeyM', { metaKey: true, altKey: true }))).toBe('Ctrl+Alt+KeyM');
    expect(comboOf(key('ShiftLeft', { shiftKey: true }))).toBeNull();
  });

  it('matches only the exact combo, and never an empty one', () => {
    expect(matches('Ctrl+Shift+KeyM', key('KeyM', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('Ctrl+Shift+KeyM', key('KeyM', { ctrlKey: true }))).toBe(false);
    expect(matches('', key('KeyM'))).toBe(false);
  });

  it('refuses combos that typing would set off', () => {
    expect(usable('KeyM')).toBe(false);
    expect(usable('Shift+KeyM')).toBe(false);
    expect(usable('Alt+KeyM')).toBe(true);
    expect(usable('F9')).toBe(true);
    expect(usable('')).toBe(true);
  });

  it('finds clashes with built-in and other custom shortcuts', () => {
    expect(clashOf('Ctrl+KeyK', DEFAULT_KEYBINDS, 'toggleMute')).toBe('Quick switcher');
    expect(clashOf('Ctrl+Shift+KeyD', DEFAULT_KEYBINDS, 'toggleMute')).toBe('Deafen / undeafen');
    expect(clashOf('Ctrl+Shift+KeyM', DEFAULT_KEYBINDS, 'toggleMute')).toBeNull();
    expect(clashOf('', DEFAULT_KEYBINDS, 'leaveVoice')).toBeNull();
  });

  it('labels combos for people', () => {
    expect(comboLabel('Ctrl+Shift+KeyM')).toBe('Ctrl+Shift+M');
    expect(comboLabel('Ctrl+Shift+KeyM', true)).toBe('⌘⇧M');
    expect(comboLabel('Alt+Backquote')).toBe('Alt+`');
    expect(comboLabel('')).toBe('Not set');
  });

  it('fills in actions missing from older settings', () => {
    expect(withDefaults({ toggleMute: 'F9' })).toEqual({ ...DEFAULT_KEYBINDS, toggleMute: 'F9' });
  });
});
