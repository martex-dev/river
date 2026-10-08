import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, isAllowedAppUrl, resolveAppPath } from '../src/main/url-policy.ts';

const root = resolve('/srv/river/renderer');

describe('resolveAppPath', () => {
  it('serves files inside the renderer directory', () => {
    expect(resolveAppPath(root, 'river://app/index.html')).toBe(join(root, 'index.html'));
    expect(resolveAppPath(root, 'river://app/')).toBe(join(root, 'index.html'));
    expect(resolveAppPath(root, 'river://app/assets/a.js?x=1#y')).toBe(join(root, 'assets', 'a.js'));
  });

  it('never resolves outside the renderer directory, in any encoding', () => {
    for (const url of [
      'river://app/../secret.txt',
      'river://app/%2e%2e/secret.txt',
      'river://app/%2E%2E%2Fsecret.txt',
      'river://app/assets/..%2f..%2fsecret.txt',
      'river://app/..%5c..%5csecret.txt',
      'river://app/%00index.html',
    ]) {
      const resolved = resolveAppPath(root, url);
      // Either refused outright or normalised to a path that is still inside root.
      if (resolved !== null) expect(resolved.startsWith(root + sep), url).toBe(true);
    }
  });

  it('refuses encoded separators and NUL bytes outright', () => {
    expect(resolveAppPath(root, 'river://app/..%2f..%2fsecret.txt')).toBeNull();
    expect(resolveAppPath(root, 'river://app/..%5c..%5csecret.txt')).toBeNull();
    expect(resolveAppPath(root, 'river://app/%00index.html')).toBeNull();
    expect(resolveAppPath(root, 'river://app/assets/a%5Cb.js')).toBeNull();
    expect(resolveAppPath(root, 'river://app/assets\\a.js')).toBeNull();
  });

  it('only answers for river://app', () => {
    expect(resolveAppPath(root, 'river://other/index.html')).toBeNull();
    expect(resolveAppPath(root, 'file:///etc/passwd')).toBeNull();
    expect(resolveAppPath(root, 'not a url')).toBeNull();
    expect(resolveAppPath(root, 'river://app/%E0%A4%A')).toBeNull();
  });
});

describe('isAllowedAppUrl', () => {
  it('allows only River UI URLs in packaged builds', () => {
    expect(isAllowedAppUrl('river://app/index.html', undefined, true)).toBe(true);
    expect(isAllowedAppUrl('river://evil/index.html', undefined, true)).toBe(false);
    expect(isAllowedAppUrl('https://example.com/', undefined, true)).toBe(false);
    expect(isAllowedAppUrl('http://localhost:5173/', 'http://localhost:5173', true)).toBe(false);
  });

  it('allows the dev server only in development', () => {
    expect(isAllowedAppUrl('http://localhost:5173/x', 'http://localhost:5173', false)).toBe(true);
    expect(isAllowedAppUrl('http://localhost:5174/x', 'http://localhost:5173', false)).toBe(false);
  });

  it('fails closed on malformed input', () => {
    expect(isAllowedAppUrl('::::', undefined, false)).toBe(false);
    expect(isAllowedAppUrl('https://example.com/', '', false)).toBe(false);
    expect(isAllowedAppUrl('https://example.com/', 'not a url', false)).toBe(false);
    expect(isAllowedAppUrl('data:text/html,hi', 'data:text/html,hi', false)).toBe(false);
  });
});

describe('content security policy', () => {
  it('forbids inline and eval script execution and remote content', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-(inline|eval)/);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:/);
  });
});
