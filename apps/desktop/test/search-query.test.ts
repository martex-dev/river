import { describe, expect, it } from 'vitest';
import { hasCriteria, matchesSearch, parseSearch, type Searchable } from '../src/shared/search-query.ts';

const msg = (over: Partial<Searchable> = {}): Searchable => ({
  text: 'see you at the party',
  sentAt: new Date(2026, 8, 15, 12).toISOString(),
  senderName: 'Alice',
  sender: 'u-alice',
  pinned: false,
  mentionsMe: false,
  attachments: [],
  ...over,
});

describe('search filters', () => {
  it('splits filters from text', () => {
    const q = parseSearch('from:@Alice in:#general has:image party  time');
    expect(q).toMatchObject({ from: ['alice'], in: ['general'], has: ['image'], text: 'party time' });
  });

  it('keeps unknown filters and bad has: values as text', () => {
    expect(parseSearch('foo:bar has:banana').text).toBe('foo:bar has:banana');
  });

  it('understands quoted values', () => {
    expect(parseSearch('in:"game night" hi').in).toEqual(['game night']);
  });

  it('matches by person, channel, attachments, links, pins and mentions', () => {
    expect(matchesSearch(msg(), parseSearch('from:ali party'))).toBe(true);
    expect(matchesSearch(msg(), parseSearch('from:bob'))).toBe(false);
    expect(matchesSearch(msg(), parseSearch('in:general'), 'General')).toBe(true);
    expect(matchesSearch(msg(), parseSearch('in:random'), 'general')).toBe(false);
    const pic = msg({ attachments: [{ name: 'cat.png', mime: 'image/png' }] });
    expect(matchesSearch(pic, parseSearch('has:image'))).toBe(true);
    expect(matchesSearch(pic, parseSearch('has:video'))).toBe(false);
    expect(matchesSearch(pic, parseSearch('has:file cat'))).toBe(true);
    expect(matchesSearch(msg({ text: 'look https://example.com' }), parseSearch('has:link'))).toBe(true);
    expect(matchesSearch(msg(), parseSearch('pinned:true'))).toBe(false);
    expect(matchesSearch(msg({ mentionsMe: true }), parseSearch('mentions:me'))).toBe(true);
    expect(matchesSearch(msg({ poll: {} }), parseSearch('has:poll'))).toBe(true);
  });

  it('filters by local calendar day', () => {
    const m = msg();
    expect(matchesSearch(m, parseSearch('during:2026-09-15'))).toBe(true);
    expect(matchesSearch(m, parseSearch('during:2026-09-16'))).toBe(false);
    expect(matchesSearch(m, parseSearch('before:2026-09-16'))).toBe(true);
    expect(matchesSearch(m, parseSearch('before:2026-09-15'))).toBe(false);
    expect(matchesSearch(m, parseSearch('after:2026-09-14'))).toBe(true);
    expect(matchesSearch(m, parseSearch('after:2026-09-15'))).toBe(false);
    expect(parseSearch('before:yesterday').before).toBeNull();
  });

  it('needs at least one criterion', () => {
    expect(hasCriteria(parseSearch('  '))).toBe(false);
    expect(hasCriteria(parseSearch('pinned:true'))).toBe(true);
  });
});
