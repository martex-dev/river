import { isIP } from 'node:net';

/** Hosts that only forward to somewhere else, so the real destination is hidden. */
const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
  'tiny.cc',
  'rb.gy',
]);

/**
 * Plain-language warnings for a link before River opens it (1.0.28). They
 * never block: the person decides, with the real address in front of them.
 */
export function linkWarnings(url: URL): string[] {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const out: string[] = [];
  if (host.split('.').some((label) => label.startsWith('xn--')))
    out.push('⚠ This address uses unusual characters that can imitate another site.');
  if (isIP(host)) out.push('⚠ This link goes to a raw IP address, not a named website.');
  if (SHORTENERS.has(host.replace(/^www\./, '')))
    out.push('⚠ This is a short link: it hides where it really goes.');
  if (url.protocol === 'http:') out.push('This link is not encrypted (http).');
  return out;
}
