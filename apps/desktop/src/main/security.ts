import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { app, protocol, session, type Session, type WebContents } from 'electron';
import {
  APP_SCHEME,
  CONTENT_SECURITY_POLICY,
  isAllowedAppUrl as isAllowedUrl,
  resolveAppPath,
  safeOrigin,
  UI_PARTITION,
} from './url-policy.ts';

export { APP_ORIGIN, APP_SCHEME, UI_PARTITION } from './url-policy.ts';

export function isAllowedAppUrl(url: string, devServerUrl: string | undefined): boolean {
  return isAllowedUrl(url, devServerUrl, app.isPackaged);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Must run before `app.ready`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export function serveAppScheme(uiSession: Session, rendererDir: string): void {
  uiSession.protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppPath(rendererDir, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: {
          'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Security-Policy': CONTENT_SECURITY_POLICY,
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Opener-Policy': 'same-origin',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/**
 * Locks down the UI session: no permissions (camera, mic, notifications, …)
 * until features explicitly need them, and no network requests from the
 * renderer except to the dev server during development.
 */
export function hardenSession(uiSession: Session, devServerUrl: string | undefined): void {
  // Only what features need, and only for River's own UI: microphone/camera and screen capture
  // for calls, and writing (never reading) the clipboard for "Copy link".
  const CALL_PERMISSIONS = new Set(['media', 'display-capture', 'clipboard-sanitized-write']);
  uiSession.setPermissionRequestHandler((wc, permission, callback) =>
    callback(CALL_PERMISSIONS.has(permission) && isAllowedAppUrl(wc.getURL(), devServerUrl)),
  );
  uiSession.setPermissionCheckHandler(
    (_wc, permission, origin) =>
      CALL_PERMISSIONS.has(permission) && isAllowedAppUrl(`${origin}/`, devServerUrl),
  );
  uiSession.setDevicePermissionHandler(() => false);
  const devOrigin = devServerUrl ? safeOrigin(devServerUrl) : null;
  uiSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, cb) => {
      const origin = safeOrigin(details.url);
      const devSocket = devOrigin?.replace(/^http/, 'ws');
      cb({ cancel: !(origin && (origin === devOrigin || origin === devSocket)) });
    },
  );
}

/** Applies navigation guards to every web contents River creates. */
export function guardWebContents(contents: WebContents, devServerUrl: string | undefined): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url, devServerUrl)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedAppUrl(url, devServerUrl)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

export function uiSession(): Session {
  return session.fromPartition(UI_PARTITION);
}
