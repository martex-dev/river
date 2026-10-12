import { describe, expect, it } from 'vitest';
import { NavHistory, navKey, samePlace, type Place } from '../src/renderer/src/nav-history.ts';

const ch = (id: string): Place => ({ section: 'communities', communityId: 'c', channelId: id });

describe('back / forward history', () => {
  it('goes back and forward and drops the forward branch on a new visit', () => {
    const h = new NavHistory();
    h.visit(ch('a'));
    h.visit(ch('b'));
    h.visit(ch('b'));
    h.visit(ch('c'));
    expect(h.go(-1)).toEqual(ch('b'));
    expect(h.go(-1)).toEqual(ch('a'));
    expect(h.go(-1)).toBeNull();
    expect(h.go(1)).toEqual(ch('b'));
    h.visit({ section: 'settings' });
    expect(h.canGo(1)).toBe(false);
    expect(h.go(-1)).toEqual(ch('b'));
  });

  it('skips and forgets places that are gone', () => {
    const h = new NavHistory();
    ['a', 'b', 'c', 'd'].forEach((x) => h.visit(ch(x)));
    const gone = (p: Place): boolean => p.channelId !== 'b' && p.channelId !== 'c';
    expect(h.go(-1, gone)).toEqual(ch('a'));
    expect(h.go(1, gone)).toEqual(ch('d'));
    expect(h.go(-1)).toEqual(ch('a'));
  });

  it('keeps at most 50 places', () => {
    const h = new NavHistory();
    for (let i = 0; i < 80; i++) h.visit(ch(String(i)));
    let n = 0;
    while (h.go(-1)) n++;
    expect(n).toBe(49);
  });

  it('compares places field by field', () => {
    expect(samePlace({ section: 'home' }, { section: 'home', peer: null })).toBe(true);
    expect(samePlace(ch('a'), ch('b'))).toBe(false);
  });

  it('maps keys per platform', () => {
    const k = (
      key: string,
      mods: Partial<Record<'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey', boolean>> = {},
    ) => ({
      key,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(navKey(k('ArrowLeft', { altKey: true }), false)).toBe(-1);
    expect(navKey(k('ArrowRight', { altKey: true }), false)).toBe(1);
    expect(navKey(k('ArrowLeft', { altKey: true, shiftKey: true }), false)).toBe(0);
    expect(navKey(k('[', { metaKey: true }), true)).toBe(-1);
    expect(navKey(k(']', { metaKey: true }), true)).toBe(1);
    expect(navKey(k('ArrowLeft', { altKey: true }), true)).toBe(0);
  });
});
