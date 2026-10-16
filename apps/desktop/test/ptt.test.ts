import { describe, expect, it } from 'vitest';
import { isTypingTarget, pttKeyIsTyping } from '../src/renderer/src/community/ptt.ts';

const input = (type = 'text') => ({ tagName: 'INPUT', type, isContentEditable: false });
const textarea = { tagName: 'TEXTAREA', isContentEditable: false };
const editable = { tagName: 'DIV', isContentEditable: true };
const button = { tagName: 'BUTTON', isContentEditable: false };

const press = (target: unknown, key: string, mods: { ctrlKey?: boolean } = {}) => ({
  target: target as EventTarget,
  key,
  ...mods,
});

describe('push-to-talk while typing', () => {
  it('knows where you type text', () => {
    expect(isTypingTarget(input() as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(input('search') as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(textarea as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(editable as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(input('checkbox') as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(input('range') as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(button as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('the default key (`) typed into the composer is typing, not talking', () => {
    expect(pttKeyIsTyping(press(textarea, '`'))).toBe(true);
    expect(pttKeyIsTyping(press(input(), '`'))).toBe(true);
    expect(pttKeyIsTyping(press(editable, ' '))).toBe(true);
  });

  it('keys that write nothing, and presses outside text fields, still talk', () => {
    expect(pttKeyIsTyping(press(textarea, 'F13'))).toBe(false);
    expect(pttKeyIsTyping(press(textarea, 'Control'))).toBe(false);
    expect(pttKeyIsTyping(press(textarea, '`', { ctrlKey: true }))).toBe(false);
    expect(pttKeyIsTyping(press(button, '`'))).toBe(false);
    expect(pttKeyIsTyping(press(null, '`'))).toBe(false);
  });
});
