import { describe, expect, it } from 'vitest';
import { fetchPreview, isPrivateAddress, parsePreview, type PreviewDeps } from '../src/main/link-preview.ts';

const page = (head: string): string => `<!doctype html><html><head>${head}</head><body>x</body></html>`;

describe('link previews', () => {
  it('reads Open Graph tags, falling back to <title> and the host name', () => {
    expect(
      parsePreview(
        page(
          '<meta property="og:title" content="River &amp; friends"><meta name="description" content="Chat, privately.">',
        ),
        'https://www.example.com/a',
      ),
    ).toEqual({
      url: 'https://www.example.com/a',
      title: 'River & friends',
      description: 'Chat, privately.',
      site: 'example.com',
    });
    expect(parsePreview(page('<title> Plain\n title </title>'), 'https://x.org')?.title).toBe('Plain title');
    expect(parsePreview(page(''), 'https://x.org')).toBeNull();
  });

  it('treats LAN, loopback and similar addresses as private', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.5',
      '172.20.0.1',
      '169.254.1.1',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:192.168.1.1',
    ])
      expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['93.184.216.34', '2606:4700::1111', '172.32.0.1'])
      expect(isPrivateAddress(ip)).toBe(false);
  });

  const deps = (
    routes: Record<string, Response | (() => Response)>,
    dns: Record<string, string[]> = {},
  ): PreviewDeps => ({
    fetch: (async (input: RequestInfo | URL) => {
      const r = routes[String(input)];
      if (!r) throw new Error(`unexpected ${String(input)}`);
      return typeof r === 'function' ? r() : r;
    }) as typeof fetch,
    resolve: async (host) => dns[host] ?? ['93.184.216.34'],
  });
  const html = (body: string) =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

  it('fetches public pages and follows a redirect', async () => {
    const d = deps({
      'https://a.example/': new Response(null, {
        status: 301,
        headers: { location: 'https://b.example/page' },
      }),
      'https://b.example/page': html(page('<meta property="og:title" content="Hello">')),
    });
    expect((await fetchPreview('https://a.example/', d))?.title).toBe('Hello');
  });

  it('never fetches private addresses, even after a redirect', async () => {
    expect(await fetchPreview('http://127.0.0.1/', deps({}))).toBeNull();
    expect(await fetchPreview('http://localhost:3000/', deps({}))).toBeNull();
    expect(
      await fetchPreview('https://intranet.example/', deps({}, { 'intranet.example': ['10.0.0.5'] })),
    ).toBeNull();
    const d = deps({
      'https://a.example/': new Response(null, {
        status: 302,
        headers: { location: 'http://192.168.1.1/admin' },
      }),
    });
    expect(await fetchPreview('https://a.example/', d)).toBeNull();
  });

  it('ignores non-HTML and failed responses', async () => {
    const d = deps({
      'https://a.example/img': new Response('x', { status: 200, headers: { 'content-type': 'image/png' } }),
      'https://a.example/missing': new Response('no', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    });
    expect(await fetchPreview('https://a.example/img', d)).toBeNull();
    expect(await fetchPreview('https://a.example/missing', d)).toBeNull();
    expect(await fetchPreview('ftp://a.example/', d)).toBeNull();
  });
});
