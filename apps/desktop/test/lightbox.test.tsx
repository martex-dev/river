import { describe, expect, it } from 'vitest';
import { stepZoom } from '../src/renderer/src/community/ui/Attachments.tsx';

describe('image viewer zoom', () => {
  it('steps by a quarter and stays between 100 % and 800 %', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.25, -1)).toBe(1);
    expect(stepZoom(1, -1)).toBe(1);
    let s = 1;
    for (let i = 0; i < 20; i++) s = stepZoom(s, 1);
    expect(s).toBe(8);
  });
});
