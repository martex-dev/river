import { isIP } from 'node:net';

/**
 * Link previews (1.0.23), made by the sender only and only when they turned
 * them on: River fetches the page you are linking to from your computer,
 * takes its title and description, and puts them in your (encrypted)
 * message. People reading it never contact the site.
 *
 * Only public http(s) addresses are fetched (no LAN or localhost), at most
 * 512 KB of HTML, three redirects and a few seconds. The address is checked
 * again when the connection is made, so DNS cannot change its answer between
 * the check and the request (link-preview-net.ts, desktop only).
 */
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  site: string;
}

const MAX_HTML = 512 * 1024;
const MAX_REDIRECTS = 3;

function v4Private(a: number, b: number, c: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** The eight 16-bit groups of an IPv6 address (any spelling Node accepts), or null. */
export function expandIPv6(raw: string): number[] | null {
  let s = raw.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (isIP(s) !== 6) return null;
  // A dotted IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    s = s.slice(0, dotted.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

/** The IPv4 address carried in the last 32 bits of IPv6 groups g6, g7. */
const embedded = (g6: number, g7: number): boolean => v4Private(g6 >> 8, g6 & 0xff, g7 >> 8);

/**
 * True for loopback, private, link-local, carrier-grade NAT, documentation,
 * multicast and other non-public addresses — including IPv4 addresses hidden
 * inside IPv6 ones (mapped, compatible, NAT64, 6to4), however they are spelled.
 * Anything that is not an IP address counts as private.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
    return v4Private(a, b, c);
  }
  const g = expandIPv6(ip);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const zero = (...xs: number[]): boolean => xs.every((x) => x === 0);
  // ::/96 — unspecified, loopback and the deprecated IPv4-compatible form (::7f00:1): never public.
  if (zero(g0, g1, g2, g3, g4, g5)) return true;
  // ::ffff:a.b.c.d (mapped) and ::ffff:0:a.b.c.d (translated).
  if (zero(g0, g1, g2, g3, g4) && g5 === 0xffff) return embedded(g6, g7);
  if (zero(g0, g1, g2, g3) && g4 === 0xffff && g5 === 0) return embedded(g6, g7);
  // NAT64: 64:ff9b::/96 carries an IPv4 address; 64:ff9b:1::/48 is for local use.
  if (g0 === 0x64 && g1 === 0xff9b) return g2 === 1 || !zero(g2, g3, g4, g5) || embedded(g6, g7);
  // 100::/64 discard-only.
  if (g0 === 0x100 && zero(g1, g2, g3)) return true;
  // 2001::/23 IETF special purpose (Teredo, ORCHID, benchmarking …) and 2001:db8::/32 documentation.
  if (g0 === 0x2001 && (g1 < 0x200 || g1 === 0xdb8)) return true;
  // 6to4: 2002:a.b.c.d::/48.
  if (g0 === 0x2002) return v4Private(g1 >> 8, g1 & 0xff, g2 >> 8);
  // 3fff::/20 documentation.
  if (g0 === 0x3fff && g1 < 0x1000) return true;
  // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
  return g0 >= 0xfc00;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!name || !keys.includes(name)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decode(content);
  }
  return null;
}

/** Title, description and site name from a page's HTML (pure). */
export function parsePreview(html: string, url: string): LinkPreview | null {
  const head = html.slice(0, MAX_HTML);
  const title =
    meta(head, ['og:title', 'twitter:title']) ??
    (() => {
      const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
      return t ? decode(t) : null;
    })();
  if (!title) return null;
  const description = meta(head, ['og:description', 'twitter:description', 'description']) ?? '';
  const site = meta(head, ['og:site_name']) ?? new URL(url).hostname.replace(/^www\./, '');
  return {
    url,
    title: title.slice(0, 200),
    description: description.slice(0, 300),
    site: site.slice(0, 80),
  };
}

export interface PreviewDeps {
  fetch: typeof fetch;
  resolve(host: string): Promise<string[]>;
  timeoutMs?: number;
}

async function publicUrl(raw: string, deps: PreviewDeps): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  const addresses = isIP(host) ? [host] : await deps.resolve(host).catch(() => []);
  if (!addresses.length || addresses.some(isPrivateAddress)) return null;
  return url;
}

/** Fetches a preview for a link, or null when there is none (or it is not allowed). */
export async function fetchPreview(raw: string, deps: PreviewDeps): Promise<LinkPreview | null> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 5000);
  let next = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await publicUrl(next, deps);
    if (!url) return null;
    const res = await deps
      .fetch(url, {
        redirect: 'manual',
        signal,
        headers: { accept: 'text/html', 'user-agent': 'River link preview' },
      })
      .catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      next = new URL(location, url).toString();
      continue;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_HTML) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
    void reader.cancel().catch(() => undefined);
    const html = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_HTML));
    return parsePreview(html, raw);
  }
  return null;
}
