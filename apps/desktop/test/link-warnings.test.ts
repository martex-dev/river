import { describe, expect, it } from 'vitest';
import { linkWarnings } from '../src/main/link-warnings.ts';

describe('link warnings', () => {
  it('flags look-alike names, raw IPs, short links and plain http', () => {
    expect(linkWarnings(new URL('https://xn--pple-43d.com/login'))[0]).toMatch(/imitate/);
    expect(linkWarnings(new URL('https://203.0.113.9/x'))[0]).toMatch(/raw IP/);
    expect(linkWarnings(new URL('https://bit.ly/abc'))[0]).toMatch(/short link/);
    expect(linkWarnings(new URL('http://example.com'))).toEqual(['This link is not encrypted (http).']);
    expect(linkWarnings(new URL('https://example.com/page'))).toEqual([]);
  });
});
