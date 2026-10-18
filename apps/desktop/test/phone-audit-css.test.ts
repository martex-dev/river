import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phone layout bugs found at 360x800 and 390x844 (2.16.1) that live in the stylesheets
// (the rest are in phone-audit.test.tsx).
describe("the phone's styles", () => {
  const css = (file: string): string =>
    readFileSync(join(__dirname, '../src/renderer/src', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('make menu items thumb-sized (the rule once named a class no menu has)', () => {
    expect(css('phone/phone.css')).toMatch(/\.popover\.menu \.menu-item \{[^}]*min-height: 44px/);
  });

  it('keep the full-screen incoming call opaque over the chat list', () => {
    // community.css's plain .incoming-call (a dim backdrop) comes later: the phone's needs two classes.
    expect(css('styles/app.css')).toMatch(
      /\.incoming-call\.incoming-call--full \{\s*background: linear-gradient/,
    );
  });

  it('let picture-in-picture fill the little window', () => {
    expect(css('styles/app.css')).toMatch(/\[data-pip='on'\] \.dm-call__stage \{[^}]*height: auto/);
  });
});
