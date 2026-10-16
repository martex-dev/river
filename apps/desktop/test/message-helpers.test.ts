import { describe, expect, it, vi } from 'vitest';
import { BlobUrlCache } from '../src/renderer/src/community/blob-cache.ts';
import { composing, enterSends } from '../src/renderer/src/components/keys.ts';
import { localDay, newSince } from '../src/renderer/src/components/unread.ts';

describe('jump to latest', () => {
  it('counts messages from others after the newest one you saw, not older pages loaded above', () => {
    const at = (min: number, mine = false) => ({
      mine,
      sentAt: `2026-10-16T10:${String(min).padStart(2, '0')}:00.000Z`,
    });
    const seen = at(10).sentAt;
    // Older history arrived above (a jump back): none of it is new.
    const list = [at(1), at(2), at(3), at(10), at(11), at(12, true), at(13)];
    expect(newSince(list, seen)).toBe(2);
    expect(newSince([at(1)], '')).toBe(1);
  });

  it('gives today as the device shows it', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('Enter in the message box', () => {
  it('sends on a computer, not on a phone, never with Shift or while an input method composes', () => {
    expect(enterSends({ key: 'Enter', shiftKey: false }, false)).toBe(true);
    expect(enterSends({ key: 'Enter', shiftKey: false }, true)).toBe(false);
    expect(enterSends({ key: 'Enter', shiftKey: true }, false)).toBe(false);
    expect(enterSends({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true } }, false)).toBe(
      false,
    );
    expect(enterSends({ key: 'Enter', shiftKey: false, keyCode: 229 }, false)).toBe(false);
    expect(composing({ key: 'a', shiftKey: false, nativeEvent: { isComposing: false } })).toBe(false);
  });
});

describe('decrypted file URLs', () => {
  const blob = (n: number) => new Blob([new Uint8Array(n)]);
  const cache = () => {
    let i = 0;
    const revoked: string[] = [];
    const c = new BlobUrlCache({
      maxEntries: 2,
      maxBytes: 100,
      create: () => `blob:${++i}`,
      revoke: (u) => void revoked.push(u),
    });
    return { c, revoked };
  };

  it('decrypt a file once even when asked for it twice at the same time', async () => {
    const { c } = cache();
    const make = vi.fn(async () => blob(1));
    const [a, b] = await Promise.all([c.load('x', make), c.load('x', make)]);
    expect(a).toBe(b);
    expect(make).toHaveBeenCalledOnce();
    expect(await c.load('x', make)).toBe(a);
    expect(make).toHaveBeenCalledOnce();
  });

  it('revoke the least recently used, but never one still on screen', async () => {
    const { c, revoked } = cache();
    const a = await c.load('a', async () => blob(1));
    const release = c.retain('a');
    await c.load('b', async () => blob(1));
    await c.load('c', async () => blob(1));
    // Over two entries: "a" is the oldest but shown, so "b" goes.
    expect(revoked).toEqual(['blob:2']);
    expect(c.get('a')).toBe(a);
    release();
    await c.load('d', async () => blob(1));
    expect(revoked).toEqual(['blob:2', 'blob:3']);
    // "a" was used more recently than "c" (get), so "c" went first.
    expect(c.size).toBe(2);
  });

  it('keep within the size limit', async () => {
    const { c, revoked } = cache();
    await c.load('big', async () => blob(80));
    await c.load('bigger', async () => blob(60));
    expect(revoked).toEqual(['blob:1']);
    expect(c.bytes).toBe(60);
  });

  it('forget a failed decryption so it can be tried again', async () => {
    const { c } = cache();
    await expect(c.load('x', async () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(await c.load('x', async () => blob(1))).toBe('blob:1');
  });
});
