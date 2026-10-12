/** @vitest-environment jsdom */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { muteLength, parseSlash, slashText, suggestCommands } from '../src/renderer/src/community/slash.ts';
import { RichText } from '../src/renderer/src/community/ui/common.tsx';

describe('slash commands', () => {
  it('only recognises known commands', () => {
    expect(parseSlash('/shrug ok then')).toEqual({ command: 'shrug', arg: 'ok then' });
    expect(parseSlash('/ME waves')).toEqual({ command: 'me', arg: 'waves' });
    expect(parseSlash('/r/rivers is great')).toBeNull();
    expect(parseSlash('hello /shrug')).toBeNull();
  });

  it('turns text commands into text', () => {
    expect(slashText({ command: 'me', arg: 'waves' })).toBe('_waves_');
    expect(slashText({ command: 'spoiler', arg: 'it was him' })).toBe('||it was him||');
    expect(slashText({ command: 'tableflip', arg: '' })).toBe('(╯°□°)╯︵ ┻━┻');
    expect(slashText({ command: 'poll', arg: '' })).toBeNull();
  });

  it('shows the shrug with its arms', () => {
    const { container } = render(<RichText text={slashText({ command: 'shrug', arg: 'fine' })!} />);
    expect(container.textContent).toBe(String.raw`fine ¯\_(ツ)_/¯`);
  });

  it('reads mute lengths and suggests commands', () => {
    expect(muteLength('15m')).toBe(15 * 60_000);
    expect(muteLength('8h')).toBe(8 * 3_600_000);
    expect(muteLength('')).toBeNull();
    expect(muteLength('forever-ish')).toBeUndefined();
    expect(suggestCommands('s').map((c) => c.name)).toEqual(['shrug', 'spoiler', 'status']);
  });
});
