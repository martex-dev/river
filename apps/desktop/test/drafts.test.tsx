/** @vitest-environment jsdom */
import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readDraft, useDraft } from '../src/renderer/src/community/drafts.ts';

function Box({ k }: { k: string }) {
  const [text, setText] = useDraft(k);
  return <textarea aria-label="box" value={text} onChange={(e) => setText(e.target.value)} />;
}

describe('drafts', () => {
  it('keeps unsent text per channel and brings it back', () => {
    const { rerender, unmount } = render(<Box k="c:1" />);
    const box = () => screen.getByLabelText<HTMLTextAreaElement>('box');
    fireEvent.change(box(), { target: { value: 'hello one' } });
    act(() => rerender(<Box k="c:2" />));
    expect(box().value).toBe('');
    fireEvent.change(box(), { target: { value: 'two' } });
    act(() => rerender(<Box k="c:1" />));
    expect(box().value).toBe('hello one');
    unmount();
    expect(readDraft('c:1')).toBe('hello one');
    expect(readDraft('c:2')).toBe('two');
  });
});
