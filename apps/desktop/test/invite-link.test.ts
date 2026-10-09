import { describe, expect, it } from 'vitest';
import { formatInvite } from '../src/main/community/sealed.ts';
import { friendLink, inviteHost, looksLikeInvite, parseFriend } from '../src/shared/invite-link.ts';

describe('invite link detection', () => {
  const key = new Uint8Array(32).fill(7);
  const code = 'abcdefghijklmnopqrstuv';

  it('recognises links River makes, with and without an epoch', () => {
    expect(looksLikeInvite(formatInvite('https://river.example.org', code, key))).toBe(true);
    expect(looksLikeInvite(formatInvite('http://127.0.0.1:8790', code, key, 3))).toBe(true);
    expect(looksLikeInvite(`  ${formatInvite('https://a.trycloudflare.com', code, key)}\n`)).toBe(true);
  });

  it('ignores ordinary text and malformed links', () => {
    expect(looksLikeInvite('hello')).toBe(false);
    expect(looksLikeInvite('https://river.example.org/join')).toBe(false);
    expect(looksLikeInvite(`https://river.example.org/join#c=short&k=${'A'.repeat(43)}`)).toBe(false);
    expect(looksLikeInvite(`${formatInvite('https://x.org', code, key)} and more`)).toBe(false);
  });

  it('shows where the invite points', () => {
    expect(inviteHost(formatInvite('https://river.example.org', code, key))).toBe('river.example.org');
    expect(inviteHost('not a url')).toBe('');
  });
});

describe('friend links', () => {
  const id = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
  it('round-trips a friend link and accepts a bare River ID', () => {
    const link = friendLink('https://river.example.org/', id);
    expect(link).toBe(`https://river.example.org/add#${id}`);
    expect(parseFriend(link)).toEqual({ riverId: id, serverUrl: 'https://river.example.org' });
    expect(parseFriend(` ${id.toUpperCase()} `)).toEqual({ riverId: id, serverUrl: null });
  });
  it('rejects anything else', () => {
    expect(parseFriend('hello')).toBeNull();
    expect(parseFriend(`https://river.example.org/join#${id}`)).toBeNull();
    expect(parseFriend('https://river.example.org/add#not-an-id')).toBeNull();
    expect(parseFriend(`javascript:alert(1)//add#${id}`)).toBeNull();
  });
});
