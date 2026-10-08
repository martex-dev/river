import { resolve, sep } from 'node:path';

/**
 * River serves its UI from a private `river://app/` scheme instead of file://,
 * so every response carries a strict Content-Security-Policy header and the
 * renderer can only ever load River's own files.
 */
export const APP_SCHEME = 'river';
export const APP_ORIGIN = `${APP_SCHEME}://app`;
export const UI_PARTITION = 'river-ui';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

/** Maps a river://app/ URL to a file inside `rootDir`, or null if it escapes it. */
export function resolveAppPath(rootDir: string, url: string): string | null {
  let pathname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== 'app') return null;
    // River's assets never contain encoded separators; refuse them on every OS.
    if (/%2f|%5c/i.test(parsed.pathname)) return null;
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  const root = resolve(rootDir);
  const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  return target.startsWith(root + sep) ? target : null;
}

/** Fails closed: anything unparseable or unexpected is not allowed. */
export function isAllowedAppUrl(url: string, devServerUrl: string | undefined, isPackaged: boolean): boolean {
  const origin = safeOrigin(url);
  if (!origin) return false;
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  if (!devServerUrl || isPackaged) return false;
  return origin === safeOrigin(devServerUrl);
}

export function safeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === `${APP_SCHEME}:`) return `${APP_SCHEME}://${u.host}`;
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}
