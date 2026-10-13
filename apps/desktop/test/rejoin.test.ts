import { beforeEach, describe, expect, it } from 'vitest';
import {
  REJOIN_WITHIN_MS,
  forgetCall,
  lastCall,
  rememberCall,
} from '../src/renderer/src/community/rejoin.ts';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as Storage;
});

describe('rejoin call (1.0.34)', () => {
  it('offers a recent call until you leave on purpose', () => {
    rememberCall('voice1', 1000);
    expect(lastCall(2000)).toEqual({ channelId: 'voice1', at: 1000 });
    forgetCall();
    expect(lastCall(2000)).toBeNull();
  });
  it('forgets old calls and never offers direct calls', () => {
    rememberCall('voice1', 0);
    expect(lastCall(REJOIN_WITHIN_MS + 1)).toBeNull();
    rememberCall('dm:abc', 0);
    expect(lastCall(10)).toBeNull();
  });
});
