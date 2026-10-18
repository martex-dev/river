// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOIN_GRACE_MS, useJoinGrace } from '../src/renderer/src/community/ui/Voice.tsx';

afterEach(() => vi.useRealTimers());

describe('someone joining a voice channel', () => {
  it('is not shown as "connecting…" during the first seconds, then is if still unreachable', () => {
    vi.useFakeTimers();
    const since = Date.now();
    const { result } = renderHook(() => useJoinGrace(since, false));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(JOIN_GRACE_MS + 50));
    expect(result.current).toBe(false);
  });

  it('a reconnect gets no grace, and an old join none either', () => {
    const now = Date.now();
    expect(renderHook(() => useJoinGrace(now, true)).result.current).toBe(false);
    expect(renderHook(() => useJoinGrace(now - JOIN_GRACE_MS - 1, false)).result.current).toBe(false);
    expect(renderHook(() => useJoinGrace(undefined, false)).result.current).toBe(false);
  });
});
