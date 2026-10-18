import type { Dictionary } from '../types.ts';

/**
 * English needs no dictionary — its texts are the keys — except for counted texts, whose key is the
 * "other" form: here are the singular forms ("1 member"). A counted text missing here reads the
 * same for every count.
 */
export const EN_PLURALS: Dictionary = {
  '{count} days ago': { one: '{count} day ago', other: '{count} days ago' },
  '{count} members': { one: '{count} member', other: '{count} members' },
  '{count} new direct messages': { one: '{count} new direct message', other: '{count} new direct messages' },
  '{count} new messages': { one: '{count} new message', other: '{count} new messages' },
};
