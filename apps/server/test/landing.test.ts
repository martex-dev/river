import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { startServer } from './helpers.ts';

/** The page's one inline script, exactly as served (the page has no other script tags). */
function scriptOf(html: string): string {
  const open = '<script>';
  const start = html.indexOf(open);
  if (start === -1) return '';
  return html.slice(start + open.length, html.indexOf('</script>', start));
}

describe('invite landing page', () => {
  for (const path of ['/join', '/add']) {
    it(`${path}: a page that gets River and opens the link in it`, async () => {
      const { app } = await startServer();
      const res = await app.inject({ method: 'GET', url: path });
      await app.close();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      const html = res.body;
      // The inline script is exactly the one the security policy allows (else the buttons do nothing).
      const script = scriptOf(html);
      // It must be valid JavaScript (escapes inside the template are easy to get wrong).
      expect(() => new Script(script)).not.toThrow();
      const hash = createHash('sha256').update(script).digest('base64');
      const csp = String(res.headers['content-security-policy']);
      expect(csp).toContain(`'sha256-${hash}'`);
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('unsafe-eval');
      // Version-less installers from the latest release, and the hand-off to the app.
      expect(html).toContain('releases/latest/download/River-Setup.exe');
      expect(html).toContain('River-mac-apple-silicon.dmg');
      expect(html).toContain('river://open?link=');
      expect(html).toContain('Run anyway');
      // Phones too (2.14): one download each, with what Android or iPhone asks for.
      expect(html).toContain('releases/latest/download/River-android.apk');
      expect(html).toContain('River-ios-unsigned.ipa');
      expect(html).toContain('install unknown apps');
      expect(html).not.toContain('phones are coming');
    });
  }
});

describe('static copy for the permanent link address', () => {
  it('carries the same script with its policy in a meta tag', async () => {
    const { staticLandingPage } = await import('../src/routes/landing.ts');
    const html = staticLandingPage();
    const script = scriptOf(html);
    const hash = createHash('sha256').update(script).digest('base64');
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain(`'sha256-${hash}'`);
    expect(html).not.toContain('frame-ancestors');
  });
});
