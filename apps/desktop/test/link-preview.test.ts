import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  expandIPv6,
  fetchPreview,
  isPrivateAddress,
  parsePreview,
  type PreviewDeps,
} from '../src/main/link-preview.ts';
import { pinnedFetch, publicOnlyLookup } from '../src/main/link-preview-net.ts';

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

  it('sees through IPv4 addresses hidden in IPv6 ones, however they are spelled', () => {
    expect(expandIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(expandIPv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    for (const ip of [
      // How Node's URL parser writes [::ffff:127.0.0.1] and [::127.0.0.1].
      new URL('http://[::ffff:127.0.0.1]/').hostname.slice(1, -1),
      '::ffff:7f00:1',
      '::7f00:1',
      '0:0:0:0:0:ffff:a00:1',
      '::ffff:0:7f00:1',
      '64:ff9b::a00:1',
      '64:ff9b::127.0.0.1',
      '64:ff9b:1::1',
      'fec0::1',
      'ff02::1',
      '2002:7f00:1::1',
      '2002:c0a8:101::1',
      '2001::1',
      '2001:db8::1',
      '::',
      'not an address',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1', '2001:4860:4860::8888'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses IPv6 literals that point at this computer', async () => {
    const d: PreviewDeps = {
      fetch: (async () => {
        throw new Error('must not be fetched');
      }) as typeof fetch,
      resolve: async () => ['93.184.216.34'],
    };
    for (const url of ['http://[::ffff:127.0.0.1]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::10.0.0.1]/'])
      expect(await fetchPreview(url, d), url).toBeNull();
  });

  const lookupWith = (answers: { address: string; family: number }[], all: boolean) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((done) =>
      publicOnlyLookup(
        'rebind.example',
        { all },
        (err, address) => done({ err, address }),
        async () => answers,
      ),
    );

  it('checks the addresses a connection actually uses (no DNS rebinding)', async () => {
    expect((await lookupWith([{ address: '127.0.0.1', family: 4 }], false)).err?.code).toBe('ENOTFOUND');
    // One private answer among public ones is enough to refuse.
    const mixed = [
      { address: '93.184.216.34', family: 4 },
      { address: '::ffff:7f00:1', family: 6 },
    ];
    expect((await lookupWith(mixed, true)).err).not.toBeNull();
    const ok = await lookupWith([{ address: '93.184.216.34', family: 4 }], false);
    expect(ok.err).toBeNull();
    expect(ok.address).toBe('93.184.216.34');
  });

  it('never connects to a local server by name, even if the first check was fooled', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>secret</title>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      // localhost resolves to a loopback address when the connection is made: refused.
      await expect(pinnedFetch(`http://localhost:${port}/`)).rejects.toThrow(/not a public address/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  const deps = (
    routes: Record<string, Response | (() => Response)>,
    dns: Record<string, string[]> = {},
  ): PreviewDeps => ({
    fetch: (async (input: string | URL | Request) => {
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
