import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { startServer } from './helpers.ts';

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
      const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
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
    });
  }
});
