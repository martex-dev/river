import { describe, expect, it } from 'vitest';
import { groupChannels, layoutChanges, moveCategory, moveChannel } from '../src/shared/layout.ts';

const ch = (
  id: string,
  position: number,
  parentId: string | null = null,
  kind: 'text' | 'voice' = 'text',
) => ({
  id,
  kind,
  position,
  parentId,
});
const cat = (id: string, position: number) => ({ id, position });

describe('channel layout', () => {
  const channels = [
    ch('a', 0),
    ch('v', 1, null, 'voice'),
    ch('b', 2, 'K1'),
    ch('c', 3, 'K1'),
    ch('d', 4, 'K2'),
  ];
  const categories = [cat('K2', 1), cat('K1', 0)];

  it('groups loose channels first, then categories in order; unknown parents count as loose', () => {
    const groups = groupChannels([...channels, ch('x', 9, 'gone')], categories);
    expect(groups.map((g) => [g.category?.id ?? null, g.channels.map((c) => c.id)])).toEqual([
      [null, ['a', 'v', 'x']],
      ['K1', ['b', 'c']],
      ['K2', ['d']],
    ]);
  });

  it('an unchanged layout needs no requests', () => {
    expect(layoutChanges(groupChannels(channels, categories))).toEqual({ categories: [], channels: [] });
  });

  it('moving a channel into another category renumbers only what moved', () => {
    const moved = moveChannel(groupChannels(channels, categories), 'a', 'K2', 0);
    expect(moved.map((g) => g.channels.map((c) => c.id))).toEqual([['v'], ['b', 'c'], ['a', 'd']]);
    expect(layoutChanges(moved)).toEqual({
      categories: [],
      channels: [
        { id: 'v', position: 0, parentId: null },
        { id: 'b', position: 1, parentId: 'K1' },
        { id: 'c', position: 2, parentId: 'K1' },
        { id: 'a', position: 3, parentId: 'K2' },
      ],
    });
  });

  it('reorders within a group and clamps the index', () => {
    const moved = moveChannel(groupChannels(channels, categories), 'b', 'K1', 99);
    expect(moved[1]!.channels.map((c) => c.id)).toEqual(['c', 'b']);
    const out = moveChannel(groupChannels(channels, categories), 'd', null, -5);
    expect(out[0]!.channels.map((c) => c.id)).toEqual(['d', 'a', 'v']);
  });

  it('moves categories and reports their new positions', () => {
    const moved = moveCategory(groupChannels(channels, categories), 'K2', 0);
    expect(moved.map((g) => g.category?.id ?? null)).toEqual([null, 'K2', 'K1']);
    const change = layoutChanges(moved);
    expect(change.categories).toEqual([
      { id: 'K2', position: 0 },
      { id: 'K1', position: 1 },
    ]);
    expect(change.channels.map((c) => c.id)).toEqual(['d', 'b', 'c']);
  });
});
