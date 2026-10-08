import { describe, expect, it } from 'vitest';
import type { FetchBytes } from '../src/main/http.ts';
import { checkServer } from '../src/main/server-check.ts';
import { serverUrlSchema } from '../src/shared/settings.ts';

const respond =
  (body: unknown, requested: string[] = []): FetchBytes =>
  async (url) => {
    requested.push(url);
    return Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  };

const fail =
  (message: string): FetchBytes =>
  async () => {
    throw new Error(message);
  };

const RIVER = { product: 'river-server', version: '0.0.2', protocol: { current: 1, min: 1 } };

describe('serverUrlSchema', () => {
  it('accepts https and normalises', () => {
    expect(serverUrlSchema.parse('https://river.example.org/')).toBe('https://river.example.org');
    expect(serverUrlSchema.parse('  https://River.Example.org/base//  ')).toBe(
      'https://river.example.org/base',
    );
    expect(serverUrlSchema.parse('https://river.example.org:8443')).toBe('https://river.example.org:8443');
  });

  it('allows plain http only for this computer', () => {
    expect(serverUrlSchema.parse('http://localhost:8787')).toBe('http://localhost:8787');
    expect(serverUrlSchema.parse('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
    expect(serverUrlSchema.parse('http://[::1]:8787')).toBe('http://[::1]:8787');
    expect(serverUrlSchema.safeParse('http://river.example.org').success).toBe(false);
    expect(serverUrlSchema.safeParse('http://192.168.1.10:8787').success).toBe(false);
  });

  it('refuses credentials, queries, fragments, other schemes and junk', () => {
    for (const bad of [
      'https://user:pw@river.example.org',
      'https://river.example.org/?x=1',
      'https://river.example.org/#frag',
      'ftp://river.example.org',
      'javascript:alert(1)',
      'river.example.org',
      '',
      `https://${'a'.repeat(2100)}.org`,
    ]) {
      expect(serverUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('checkServer', () => {
  it('reports a compatible River server', async () => {
    const requested: string[] = [];
    const res = await checkServer('https://river.example.org/', respond(RIVER, requested));
    expect(res).toEqual({ ok: true, url: 'https://river.example.org', version: '0.0.2', protocol: 1 });
    expect(requested).toEqual(['https://river.example.org/v1/version']);
  });

  it('never contacts an invalid address', async () => {
    const requested: string[] = [];
    const res = await checkServer('http://evil.example', respond(RIVER, requested));
    expect(res).toMatchObject({ ok: false, reason: 'invalid-url' });
    expect(requested).toEqual([]);
    expect(await checkServer(42, respond(RIVER))).toMatchObject({ ok: false, reason: 'invalid-url' });
  });

  it('recognises things that are not River servers', async () => {
    expect(await checkServer('https://x.org', respond('<html>hello</html>'))).toMatchObject({
      reason: 'not-river',
    });
    expect(await checkServer('https://x.org', respond({ ...RIVER, product: 'other' }))).toMatchObject({
      reason: 'not-river',
    });
    expect(await checkServer('https://x.org', fail('HTTP 404 fetching'))).toMatchObject({
      reason: 'not-river',
    });
    expect(await checkServer('https://x.org', fail('Response too large'))).toMatchObject({
      reason: 'not-river',
    });
  });

  it('reports unreachable servers without leaking internals', async () => {
    const res = await checkServer('https://x.org', fail('getaddrinfo ENOTFOUND x.org'));
    expect(res).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(JSON.stringify(res)).not.toContain('ENOTFOUND');
  });

  it('detects protocol incompatibility in both directions', async () => {
    const newer = await checkServer('https://x.org', respond({ ...RIVER, protocol: { current: 5, min: 4 } }));
    expect(newer).toMatchObject({ ok: false, reason: 'incompatible' });
    expect(!newer.ok && newer.message).toMatch(/newer version of River/);
  });
});
