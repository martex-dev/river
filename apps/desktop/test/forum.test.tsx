import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../src/shared/ipc.ts';
import { forumPosts } from '../src/renderer/src/community/ui/Forum.tsx';
import { relativeTime } from '../src/renderer/src/time.ts';

const post = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  communityId: 'c',
  channelId: 'ch',
  sender: 'u',
  senderName: 'Ana',
  text: `body ${id}`,
  sentAt: `2026-10-0${id}T10:00:00.000Z`,
  editedAt: null,
  pinned: false,
  reactions: [],
  replyTo: null,
  attachments: [],
  mentionsMe: false,
  mine: false,
  threadId: null,
  thread: { name: `Title ${id}`, count: 0, lastAt: null, archived: false, creator: 'u' },
  ...over,
});

describe('forum posts', () => {
  const list = [
    post('1', {
      tags: ['Help'],
      thread: {
        name: 'How do I host?',
        count: 3,
        lastAt: '2026-10-09T00:00:00.000Z',
        archived: false,
        creator: 'u',
      },
    }),
    post('2', { tags: ['Idea'] }),
    post('3'),
    post('4', { threadId: '1' }),
  ];

  it('lists only posts, by latest activity or newest', () => {
    expect(forumPosts(list, { query: '', tag: null, sort: 'activity' }).map((m) => m.id)).toEqual([
      '1',
      '3',
      '2',
    ]);
    expect(forumPosts(list, { query: '', tag: null, sort: 'newest' }).map((m) => m.id)).toEqual([
      '3',
      '2',
      '1',
    ]);
  });

  it('filters by tag and searches titles, text and authors', () => {
    expect(forumPosts(list, { query: '', tag: 'Idea', sort: 'activity' }).map((m) => m.id)).toEqual(['2']);
    expect(forumPosts(list, { query: 'host', tag: null, sort: 'activity' }).map((m) => m.id)).toEqual(['1']);
    expect(forumPosts(list, { query: 'ana', tag: null, sort: 'newest' })).toHaveLength(3);
  });
});

describe('relative time', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  it('reads naturally', () => {
    expect(relativeTime(now - 20_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 86_400_000, now)).toBe('1 day ago');
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });
});
