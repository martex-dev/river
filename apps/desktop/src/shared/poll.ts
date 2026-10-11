/**
 * Polls (1.0.18). A poll lives inside its message's sealed body; each vote is
 * an end-to-end encrypted reaction whose (sealed) emoji is an invisible marker
 * plus the option number. So the server stores votes like reactions — who
 * reacted, under an opaque tag — and never learns the question, the options
 * or which option anyone picked.
 *
 * Closing time is honoured by every app; the server does not know a reaction
 * is a vote, so a modified app could still vote late (it cannot vote twice
 * for one option, or vote as someone else).
 */
export interface Poll {
  question: string;
  options: string[];
  /** People may pick more than one option. */
  multi: boolean;
  /** When voting closes (ISO time). */
  endsAt: string;
}

export const POLL_LIMITS = { question: 300, option: 55, minOptions: 2, maxOptions: 10 } as const;

/** U+2063 (invisible separator) + "poll" + option number: never typed by a person. */
const MARK = '⁣poll:';

export const voteEmoji = (option: number): string => `${MARK}${option}`;

export function voteOption(emoji: string): number | null {
  if (!emoji.startsWith(MARK)) return null;
  const n = Number(emoji.slice(MARK.length));
  return Number.isInteger(n) && n >= 0 && n < POLL_LIMITS.maxOptions ? n : null;
}

export const isVote = (emoji: string): boolean => voteOption(emoji) !== null;

/** A poll from a decrypted message body, if it is a valid one. */
export function readPoll(raw: unknown): Poll | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.question !== 'string' || !Array.isArray(p.options) || typeof p.endsAt !== 'string')
    return null;
  const options = p.options
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.slice(0, POLL_LIMITS.option));
  if (options.length < POLL_LIMITS.minOptions || options.length > POLL_LIMITS.maxOptions) return null;
  if (Number.isNaN(Date.parse(p.endsAt))) return null;
  return {
    question: p.question.slice(0, POLL_LIMITS.question),
    options,
    multi: p.multi === true,
    endsAt: p.endsAt,
  };
}

export interface PollTally {
  counts: number[];
  mine: number[];
  /** People who voted at least once. */
  voters: number;
}

/** Counts votes from a message's reactions. */
export function tally(
  poll: Poll,
  reactions: ReadonlyArray<{ emoji: string; users: string[] }>,
  me: string,
): PollTally {
  const counts = poll.options.map(() => 0);
  const mine: number[] = [];
  const voters = new Set<string>();
  for (const r of reactions) {
    const option = voteOption(r.emoji);
    if (option === null || option >= poll.options.length) continue;
    // Single-choice polls count each person once (their first listed vote) even if a modified app voted twice.
    const users = poll.multi
      ? r.users
      : r.users.filter((u) => {
          const already = voters.has(u);
          return !already;
        });
    counts[option] = (counts[option] ?? 0) + users.length;
    users.forEach((u) => voters.add(u));
    if (users.includes(me)) mine.push(option);
  }
  return { counts, mine, voters: voters.size };
}
