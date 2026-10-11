/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichText, formatTimestamp, parseLines } from '../src/renderer/src/community/ui/common.tsx';
import { highlight, languageOf } from '../src/renderer/src/community/ui/highlight.ts';

const openUrl = vi.fn(async () => true);
beforeEach(() => {
  (window as unknown as { river: unknown }).river = { links: { openUrl } };
  openUrl.mockClear();
});
afterEach(cleanup);

const show = (text: string) => render(<RichText text={text} names={['Alice Smith', 'Bob']} me="Bob" />);

describe('message formatting', () => {
  it('bold, italic, underline, strike, nested', () => {
    const { container } = show('**bold *and italic*** __under__ ~~gone~~');
    expect(container.querySelector('strong em')?.textContent).toBe('and italic');
    expect(container.querySelector('u')?.textContent).toBe('under');
    expect(container.querySelector('s')?.textContent).toBe('gone');
  });

  it('escapes make markers literal', () => {
    const { container } = show('\\*not italic\\* and \\|\\|not hidden\\|\\|');
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe('*not italic* and ||not hidden||');
  });

  it('spoilers stay hidden from sight and screen readers until revealed', () => {
    const { container } = show('the end: ||it was a dream||');
    const spoiler = screen.getByRole('button', { name: 'Spoiler, press to reveal' });
    expect(spoiler.querySelector('[aria-hidden="true"]')?.textContent).toBe('it was a dream');
    fireEvent.click(spoiler);
    expect(container.querySelector('.md-spoiler.is-shown [aria-hidden="false"]')).not.toBeNull();
  });

  it('headings, subtext, quotes and lists', () => {
    const { container } = show(
      '# Big\n## Medium\n-# small print\n> quoted\n- one\n- two\n3. three\n4. four\nplain',
    );
    expect(screen.getByRole('heading', { name: 'Big' })).toHaveProperty('className', 'md-h md-h1');
    expect(screen.getByRole('heading', { name: 'Medium' })).toBeTruthy();
    expect(container.querySelector('.md-subtext')?.textContent).toBe('small print');
    expect(container.querySelector('blockquote')?.textContent).toBe('quoted');
    expect([...container.querySelectorAll('ul li')].map((l) => l.textContent)).toEqual(['one', 'two']);
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('3');
  });

  it('a # without a space is a channel reference, not a heading', () => {
    expect(parseLines('#general is quiet')[0]).toEqual({ kind: 'text', text: '#general is quiet' });
  });

  it('links open only through the confirmed path, with the real address', () => {
    show('see https://example.org/a?b=1. and [docs](https://docs.example.org/x)');
    const plain = screen.getByRole('link', { name: 'https://example.org/a?b=1' });
    fireEvent.click(plain);
    expect(openUrl).toHaveBeenLastCalledWith('https://example.org/a?b=1');
    const masked = screen.getByRole('link', { name: 'docs' });
    expect(masked.getAttribute('title')).toBe('https://docs.example.org/x');
    fireEvent.click(masked);
    expect(openUrl).toHaveBeenLastCalledWith('https://docs.example.org/x');
  });

  it('only web links become links', () => {
    const { container } = show('javascript:alert(1) and [x](javascript:alert(1)) and file:///etc/passwd');
    expect(container.querySelector('a')).toBeNull();
  });

  it('code blocks keep text exactly, highlight it and can be copied', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = show('```js\nconst x = "**not bold**"; // note\n```');
    expect(container.querySelector('pre')?.textContent).toBe('const x = "**not bold**"; // note');
    expect(container.querySelector('.hl-keyword')?.textContent).toBe('const');
    expect(container.querySelector('.hl-string')?.textContent).toBe('"**not bold**"');
    expect(container.querySelector('.hl-comment')?.textContent).toBe('// note');
    expect(container.querySelector('strong')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('const x = "**not bold**"; // note');
  });

  it('mentions still work, including inside formatting', () => {
    const { container } = show('hey **@Bob** and @Alice Smith');
    expect(container.querySelector('strong .mention--me')?.textContent).toBe('@Bob');
    expect([...container.querySelectorAll('.mention')].map((m) => m.textContent)).toEqual([
      '@Bob',
      '@Alice Smith',
    ]);
  });

  it('timestamps render in the reader’s locale', () => {
    const { container } = show('party at <t:1790000000:R>');
    const time = container.querySelector('time')!;
    expect(time.getAttribute('datetime')).toBe(new Date(1790000000 * 1000).toISOString());
    expect(formatTimestamp(1000, 'R', 1000 * 1000 + 3600 * 1000)).toMatch(/hour/);
  });
});

describe('syntax highlighting', () => {
  it('knows common language names and leaves unknown ones plain', () => {
    expect(languageOf('TypeScript')).toBe('js');
    expect(languageOf('python')).toBe('py');
    expect(languageOf('klingon')).toBeNull();
    expect(highlight('a b', null)).toEqual([{ kind: 'plain', text: 'a b' }]);
  });

  it('does not treat digits inside names as numbers', () => {
    expect(
      highlight('x1 = 42', 'py')
        .filter((t) => t.kind === 'number')
        .map((t) => t.text),
    ).toEqual(['42']);
  });

  it('round-trips the exact text', () => {
    const code = 'def f(x):\n  return "s#" + str(x) # c\n';
    expect(
      highlight(code, 'py')
        .map((t) => t.text)
        .join(''),
    ).toBe(code);
  });
});
