import { describe, expect, it } from 'vitest';
import { deepLinkInArgs, parseDeepLink } from '../src/main/deep-link.ts';

const invite = `https://crew.trycloudflare.com/join#c=${'a'.repeat(22)}&k=${'b'.repeat(43)}`;
const friend = 'https://crew.trycloudflare.com/add#75b7293c-e0a9-44c8-95ef-9eaec50e701c';
const signup = `https://crew.trycloudflare.com/add#s=${'C'.repeat(22)}`;
const wrap = (link: string): string => `river://open?link=${encodeURIComponent(link)}`;

describe('river:// links (Open in River)', () => {
  it('reads invites, friend links and sign-up links', () => {
    expect(parseDeepLink(wrap(invite))).toEqual({ kind: 'invite', link: invite });
    expect(parseDeepLink(wrap(friend))).toEqual({ kind: 'friend', link: friend });
    expect(parseDeepLink(wrap(signup))).toEqual({ kind: 'signup', link: signup });
  });

  it('refuses anything else', () => {
    for (const bad of [
      'https://crew.trycloudflare.com/join#c=x',
      'river://open',
      'river://open?link=',
      wrap('https://evil.example/whatever'),
      wrap('javascript:alert(1)'),
      wrap('file:///C:/Windows/system32/calc.exe'),
      'river://other?link=' + encodeURIComponent(invite).slice(0, 10),
      'x'.repeat(5000),
    ]) {
      expect(parseDeepLink(bad)).toBeNull();
    }
  });

  it('finds the link among the arguments Windows and Linux start River with', () => {
    expect(deepLinkInArgs(['River.exe', '--hidden', wrap(invite)])).toEqual({ kind: 'invite', link: invite });
    expect(deepLinkInArgs(['River.exe', '--hidden'])).toBeNull();
  });
});
