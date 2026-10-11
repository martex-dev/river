import { describe, expect, it } from 'vitest';
import { isVote, readPoll, tally, voteEmoji, voteOption, type Poll } from '../src/shared/poll.ts';

const poll: Poll = {
  question: 'Tonight?',
  options: ['Chess', 'Racing', 'Movie'],
  multi: false,
  endsAt: '2030-01-01T00:00:00Z',
};

describe('polls', () => {
  it('reads only valid polls', () => {
    expect(readPoll(poll)).toEqual(poll);
    expect(readPoll({ ...poll, options: ['only one'] })).toBeNull();
    expect(readPoll({ ...poll, endsAt: 'soon' })).toBeNull();
    expect(readPoll({ ...poll, options: Array(11).fill('x') })).toBeNull();
    expect(readPoll('nope')).toBeNull();
    expect(readPoll({ ...poll, multi: 'yes' })!.multi).toBe(false);
  });

  it('marks votes so they never look like typed emoji', () => {
    expect(voteOption(voteEmoji(2))).toBe(2);
    expect(isVote('👍')).toBe(false);
    expect(isVote('poll:1')).toBe(false);
    expect(voteOption(voteEmoji(99))).toBeNull();
  });

  it('counts votes, and one person counts once in a single-choice poll', () => {
    const reactions = [
      { emoji: voteEmoji(0), users: ['ana', 'bo'] },
      { emoji: voteEmoji(1), users: ['bo', 'cy'] }, // bo voted twice through a modified app
      { emoji: '🔥', users: ['ana'] },
    ];
    const single = tally(poll, reactions, 'bo');
    expect(single.counts).toEqual([2, 1, 0]);
    expect(single.voters).toBe(3);
    expect(single.mine).toEqual([0]);
    const multi = tally({ ...poll, multi: true }, reactions, 'bo');
    expect(multi.counts).toEqual([2, 2, 0]);
    expect(multi.mine).toEqual([0, 1]);
  });
});
