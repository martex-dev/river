import { describe, expect, it } from 'vitest';
import { stageGroups } from '../src/renderer/src/community/ui/Stage.tsx';

const st = (serverMuted: boolean, handRaised = false) => ({
  muted: false,
  deafened: false,
  serverMuted,
  streaming: false,
  handRaised,
});

describe('stage groups', () => {
  it('splits speakers from the audience and finds raised hands', () => {
    expect(
      stageGroups(['a', 'b', 'c', 'd'], { a: st(false), b: st(true, true), c: st(true), d: undefined }),
    ).toEqual({
      speakers: ['a', 'd'],
      audience: ['b', 'c'],
      hands: ['b'],
    });
  });
});
