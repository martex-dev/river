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
  '{count} scheduled messages · next {when}': {
    one: '{count} scheduled message · next {when}',
    other: '{count} scheduled messages · next {when}',
  },
  'Delete {count} messages for me': {
    one: 'Delete {count} message for me',
    other: 'Delete {count} messages for me',
  },
  '{count} people are typing…': { one: '{count} person is typing…', other: '{count} people are typing…' },
  '{count} new messages since {when}': {
    one: '{count} new message since {when}',
    other: '{count} new messages since {when}',
  },
  '{count} replies': { one: '{count} reply', other: '{count} replies' },
  '{count} results': { one: '{count} result', other: '{count} results' },
  'Delete {count} messages?': { one: 'Delete {count} message?', other: 'Delete {count} messages?' },
  'Deleted {count} messages.': { one: 'Deleted {count} message.', other: 'Deleted {count} messages.' },
  '{count} files': { one: '{count} file', other: '{count} files' },
  '{count} chats have wallpapers of their own.': {
    one: '{count} chat has a wallpaper of its own.',
    other: '{count} chats have wallpapers of their own.',
  },
  'Group video call · {count} people': {
    one: 'Group video call · {count} person',
    other: 'Group video call · {count} people',
  },
  'Group call · {count} people': { one: 'Group call · {count} person', other: 'Group call · {count} people' },
  '{a}, {b} and {count} others': { one: '{a}, {b} and {count} other', other: '{a}, {b} and {count} others' },
  '{count} people · voice through your server, end-to-end encrypted': {
    one: '{count} person · voice through your server, end-to-end encrypted',
    other: '{count} people · voice through your server, end-to-end encrypted',
  },
  '{count} people · end-to-end encrypted': {
    one: '{count} person · end-to-end encrypted',
    other: '{count} people · end-to-end encrypted',
  },
  'Starts in {count} min': { one: 'Starts in {count} min', other: 'Starts in {count} min' },
  '{count} interested · by {name}': {
    one: '{count} interested · by {name}',
    other: '{count} interested · by {name}',
  },
  '{count} min left': { one: '{count} min left', other: '{count} min left' },
  '{count} h left': { one: '{count} h left', other: '{count} h left' },
  '{count} days left': { one: '{count} day left', other: '{count} days left' },
  '{count} votes': { one: '{count} vote', other: '{count} votes' },
  'Folder {name}, {count} communities, open': {
    one: 'Folder {name}, {count} community, open',
    other: 'Folder {name}, {count} communities, open',
  },
  'Folder {name}, {count} communities, closed': {
    one: 'Folder {name}, {count} community, closed',
    other: 'Folder {name}, {count} communities, closed',
  },
  '{count} in channel': { one: '{count} in channel', other: '{count} in channel' },
  '{names} are here.': { one: '{names} is here.', other: '{names} are here.' },
  'deleted {count} messages by {name}': {
    one: 'deleted {count} message by {name}',
    other: 'deleted {count} messages by {name}',
  },
  'deleted {count} messages in {channel}': {
    one: 'deleted {count} message in {channel}',
    other: 'deleted {count} messages in {channel}',
  },
  'sent {count} files': { one: 'sent {count} file', other: 'sent {count} files' },
  '{a}, {b} and {count} others are talking': {
    one: '{a}, {b} and {count} other are talking',
    other: '{a}, {b} and {count} others are talking',
  },
  'You left voice after {count} minutes alone.': {
    one: 'You left voice after {count} minute alone.',
    other: 'You left voice after {count} minutes alone.',
  },
  '{count} events': { one: '{count} event', other: '{count} events' },
  '{count} GIFs': { one: '{count} GIF', other: '{count} GIFs' },
  '{count} photos': { one: '{count} photo', other: '{count} photos' },
  '{count} videos': { one: '{count} video', other: '{count} videos' },
  '{count} audio files': { one: '{count} audio file', other: '{count} audio files' },
  'Sharing {count} files and text. Pick a conversation; it opens with this in the message box, and nothing is sent until you press Send.':
    {
      one: 'Sharing {count} file and text. Pick a conversation; it opens with this in the message box, and nothing is sent until you press Send.',
      other:
        'Sharing {count} files and text. Pick a conversation; it opens with this in the message box, and nothing is sent until you press Send.',
    },
  'Sharing {count} files. Pick a conversation; it opens with this in the message box, and nothing is sent until you press Send.':
    {
      one: 'Sharing {count} file. Pick a conversation; it opens with this in the message box, and nothing is sent until you press Send.',
      other:
        'Sharing {count} files. Pick a conversation; it opens with this in the message box, and nothing is sent until you press Send.',
    },
};
