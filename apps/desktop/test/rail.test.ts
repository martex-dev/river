import { describe, expect, it } from 'vitest';
import {
  folderKey,
  moveCommunity,
  moveFolder,
  normalize,
  railEntries,
  ungroup,
  updateFolder,
  type Rail,
} from '../src/shared/rail.ts';

const ids = ['a', 'b', 'c', 'd'];
const empty: Rail = { order: [], folders: [] };
let n = 0;
const nextId = () => `f${++n}`;
const shown = (r: Rail, list = ids) =>
  railEntries(
    list.map((id) => ({ id })),
    r,
  ).map((e) => (e.kind === 'folder' ? `[${e.communities.map((c) => c.id).join('')}]` : e.id));

describe('community list order and folders', () => {
  it('starts in join order and puts newcomers at the end', () => {
    expect(shown(empty)).toEqual(['a', 'b', 'c', 'd']);
    expect(shown({ order: ['c', 'a'], folders: [] })).toEqual(['c', 'a', 'b', 'd']);
  });

  it('reorders by dragging before or after', () => {
    const r = moveCommunity(empty, ids, 'd', { kind: 'community', id: 'a' }, 'before', nextId);
    expect(shown(r)).toEqual(['d', 'a', 'b', 'c']);
    expect(shown(moveCommunity(r, ids, 'd', { kind: 'community', id: 'c' }, 'after', nextId))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('dropping onto a community makes a folder of the two, in place', () => {
    const r = moveCommunity(empty, ids, 'c', { kind: 'community', id: 'a' }, 'into', nextId);
    expect(shown(r)).toEqual(['[ac]', 'b', 'd']);
    expect(r.folders[0]).toMatchObject({ name: 'New folder', open: true });
  });

  it('adds to folders, moves within them, and moving the last one out removes the folder', () => {
    let r = moveCommunity(empty, ids, 'b', { kind: 'community', id: 'a' }, 'into', nextId);
    const f = r.folders[0]!.id;
    r = moveCommunity(r, ids, 'd', { kind: 'folder', id: f }, 'into', nextId);
    expect(shown(r)).toEqual(['[abd]', 'c']);
    r = moveCommunity(r, ids, 'd', { kind: 'community', id: 'a' }, 'before', nextId);
    expect(shown(r)).toEqual(['[dab]', 'c']);
    for (const x of ['d', 'a', 'b'])
      r = moveCommunity(r, ids, x, { kind: 'community', id: 'c' }, 'after', nextId);
    expect(shown(r)).toEqual(['c', 'b', 'a', 'd']);
    expect(r.folders).toEqual([]);
  });

  it('moves folders, ungroups them and renames them', () => {
    let r = moveCommunity(empty, ids, 'b', { kind: 'community', id: 'a' }, 'into', nextId);
    const f = r.folders[0]!.id;
    r = moveFolder(r, ids, f, 'd', 'after');
    expect(shown(r)).toEqual(['c', 'd', '[ab]']);
    r = updateFolder(r, f, { name: 'Gaming', color: 0xff0000, open: false });
    expect(r.folders[0]).toMatchObject({ name: 'Gaming', color: 0xff0000, open: false });
    expect(shown(ungroup(r, ids, f))).toEqual(['c', 'd', 'a', 'b']);
  });

  it('forgets communities you left and folders that became empty', () => {
    const r: Rail = {
      order: ['x', folderKey('f'), 'b'],
      folders: [{ id: 'f', name: 'F', color: 0, items: ['gone', 'a'], open: true }],
    };
    expect(shown(r, ['a', 'b'])).toEqual(['[a]', 'b']);
    expect(normalize(r, ['b'])).toEqual({ order: ['b'], folders: [] });
  });
});
