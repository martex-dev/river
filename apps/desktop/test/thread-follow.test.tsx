/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { alertForReply, isFollowing, setFollowing } from '../src/renderer/src/community/thread-follow.ts';

describe('followed threads', () => {
  it('follows, unfollows and decides when a reply alerts', () => {
    localStorage.clear();
    expect(isFollowing('t1')).toBe(false);
    setFollowing('t1', true);
    expect(isFollowing('t1')).toBe(true);
    expect(alertForReply('t1', false, false)).toBe(true);
    expect(alertForReply('t1', true, false)).toBe(false);
    expect(alertForReply('t1', false, true)).toBe(false);
    setFollowing('t1', false);
    expect(alertForReply('t1', false, false)).toBe(false);
  });
});
