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
  'Gave {role} to {done} of {count} members.': {
    one: 'Gave {role} to {done} of {count} member.',
    other: 'Gave {role} to {done} of {count} members.',
  },
  'Took {role} from {done} of {count} members.': {
    one: 'Took {role} from {done} of {count} member.',
    other: 'Took {role} from {done} of {count} members.',
  },
  'Copied {count} entries.': { one: 'Copied {count} entry.', other: 'Copied {count} entries.' },
  '{count} synced channels follow these permissions. Channels with their own permissions keep them.': {
    one: '{count} synced channel follows these permissions. Channels with their own permissions keep them.',
    other: '{count} synced channels follow these permissions. Channels with their own permissions keep them.',
  },
  '{count} people': { one: '{count} person', other: '{count} people' },
  'last {count} days': { one: 'last {count} day', other: 'last {count} days' },
  'messages, last {count} days': { one: 'messages, last {count} day', other: 'messages, last {count} days' },
  '{count} days': { one: '{count} day', other: '{count} days' },
  'Messages per day over the last {count} days': {
    one: 'Messages per day over the last {count} day',
    other: 'Messages per day over the last {count} days',
  },
  '{count} weeks ago': { one: '{count} week ago', other: '{count} weeks ago' },
  '{count} communities': { one: '{count} community', other: '{count} communities' },
  '{count} devices': { one: '{count} device', other: '{count} devices' },
  '{count} channels': { one: '{count} channel', other: '{count} channels' },
  'The community, its channels and its messages are deleted for all {count} members. This cannot be undone.':
    {
      one: 'The community, its channels and its messages are deleted for its {count} member. This cannot be undone.',
      other:
        'The community, its channels and its messages are deleted for all {count} members. This cannot be undone.',
    },
  '{count} mutual communities': { one: '{count} mutual community', other: '{count} mutual communities' },
  'shared with {count} people': { one: 'shared with {count} person', other: 'shared with {count} people' },
  'View all {count} comments': { one: 'View {count} comment', other: 'View all {count} comments' },
  '{count} weeks': { one: '{count} week', other: '{count} weeks' },
  '{count} hours': { one: '{count} hour', other: '{count} hours' },
  '{count} minutes': { one: '{count} minute', other: '{count} minutes' },
  '{count} seconds': { one: '{count} second', other: '{count} seconds' },
};
