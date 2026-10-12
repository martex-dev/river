import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Link previews (1.0.23), made by the sender only and only when they turned
 * them on: River fetches the page you are linking to from your computer,
 * takes its title and description, and puts them in your (encrypted)
 * message. People reading it never contact the site.
 *
 * Only public http(s) addresses are fetched (no LAN or localhost), at most
 * 512 KB of HTML, three redirects and a few seconds.
 */
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  site: string;
}

const MAX_HTML = 512 * 1024;
const MAX_REDIRECTS = 3;

/** True for loopback, private, link-local, carrier-grade NAT and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (
      s.startsWith('fc') ||
      s.startsWith('fd') ||
      s.startsWith('fe8') ||
      s.startsWith('fe9') ||
      s.startsWith('fea') ||
      s.startsWith('feb')
    )
      return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    return mapped ? isPrivateAddress(mapped[1]!) : false;
  }
  return true;
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

export const defaultPreviewDeps: PreviewDeps = {
  fetch: (input, init) => fetch(input, init),
  resolve: async (host) => (await lookup(host, { all: true })).map((r) => r.address),
};

async function publicUrl(raw: string, deps: PreviewDeps): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  const addresses = isIP(host) ? [host] : await deps.resolve(host).catch(() => []);
  if (!addresses.length || addresses.some(isPrivateAddress)) return null;
  return url;
}

/** Fetches a preview for a link, or null when there is none (or it is not allowed). */
export async function fetchPreview(
  raw: string,
  deps: PreviewDeps = defaultPreviewDeps,
): Promise<LinkPreview | null> {
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
