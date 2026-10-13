import { describe, expect, it } from 'vitest';
import { DUCKED, priorityFactor } from '../src/renderer/src/community/priority-speaker.ts';

describe('priority speaker', () => {
  const speaking = new Set(['boss', 'amy']);
  it('turns others down while an allowed priority speaker talks', () => {
    expect(priorityFactor('amy', speaking, new Set(['boss']), ['boss'])).toBe(DUCKED);
    expect(priorityFactor('boss', speaking, new Set(['boss']), ['boss'])).toBe(1);
  });
  it('does nothing while the priority speaker is quiet or has it off', () => {
    expect(priorityFactor('amy', new Set(['amy']), new Set(['boss']), ['boss'])).toBe(1);
    expect(priorityFactor('amy', speaking, new Set(), ['boss'])).toBe(1);
  });
  it('ignores people who claim priority without the permission', () => {
    expect(priorityFactor('amy', speaking, new Set(['boss']), [])).toBe(1);
  });
});
