import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phone bugs found at 360x800 and 390x844 after 2.17–2.20 that live in the stylesheets
// (the rest are in phone-audit-2.test.tsx).
describe("the phone's styles (2.20 audit)", () => {
  const read = (path: string): string =>
    readFileSync(join(__dirname, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const css = (file: string): string => read(`../src/renderer/src/${file}`);
  const mobile = (): string => read('../../mobile/ui/phone.css');

  it('make big emoji big in the phone shell too (its message text size has four classes)', () => {
    const messaging = css('styles/messaging.css');
    expect(messaging).toMatch(
      /:root \.pshell \.chat__messages \.msg__text\.msg__text--jumbo \{\s*font-size: 40px;/,
    );
    expect(messaging).toMatch(
      /:root \.pshell \.chat__messages \.msg--jumbo-2 \.msg__text\.msg__text--jumbo \{\s*font-size: 36px;/,
    );
    expect(messaging).toMatch(
      /:root \.pshell \.chat__messages \.msg--jumbo-3 \.msg__text\.msg__text--jumbo \{\s*font-size: 32px;/,
    );
    // The rule they must beat.
    expect(css('phone/phone.css')).toMatch(
      /:root \.pshell \.chat__messages \.msg__text \{[^}]*font-size: max\(16px/,
    );
  });

  it('show a group call over a locked phone (only the 1:1 call showed: a blank screen, no hang up)', () => {
    const m = mobile();
    expect(m).toMatch(
      /html\[data-over-lock\] \.dm-call--full,\s*html\[data-over-lock\] \.gcall--full \{\s*visibility: visible !important;/,
    );
    expect(m).toMatch(
      /html\[data-over-lock\] \.gcall--full \.dm-call__min \{\s*visibility: hidden !important;/,
    );
  });

  it('keep a long saved reply inside its menu', () => {
    expect(css('styles/messaging.css')).toMatch(
      /\.saved-replies \.menu-item > span:last-child \{\s*flex: 1;\s*min-width: 0;/,
    );
  });

  it('make tag filters thumb-sized and keep tags as typed (not "#HOME")', () => {
    const messaging = css('styles/messaging.css');
    expect(messaging).toMatch(/\.tag-filter \.chip,\s*\.msg-tags \.chip \{\s*text-transform: none;/);
    expect(messaging).toMatch(/:root \.pshell \.tag-filter \.chip \{[^}]*height: 40px;/);
    expect(messaging).toMatch(/:root \.pshell \.tag-filter \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  });

  it("keep a menu row's value readable while the row is highlighted (a phone keeps it after a tap)", () => {
    expect(css('styles/community.css')).toMatch(
      /\.menu-item:hover:not\(:disabled\) :is\(\.menu__hint, \.menu__indent\),\s*\.menu-item:focus-visible :is\(\.menu__hint, \.menu__indent\) \{\s*color: inherit;/,
    );
  });

  it('keep "Set wallpaper" and the preview in sight in the wallpaper dialog on a phone', () => {
    const looks = css('styles/looks.css');
    expect(looks).toMatch(/\.wp-dialog \.modal__foot \{\s*position: sticky;\s*bottom: -20px;/);
    expect(looks).toMatch(/\.wp-dialog \.wp-dialog__preview \{\s*position: sticky;\s*top: -20px;/);
  });

  it('draw @names and #channels in the theme colours (the fixed pale lilac vanished on light bubbles)', () => {
    expect(css('phone/phone.css')).toMatch(
      /:root \.pshell \.chat__messages \.msg:not\(\.msg--mine\) \.mention:not\(\.mention--role\) \{[^}]*color: var\(--accent-2-text\);/,
    );
  });

  it('give forward destinations and the effect replay button room for a finger', () => {
    expect(mobile()).toMatch(/\.forward__item \{\s*min-height: 44px;/);
    expect(css('styles/messaging.css')).toMatch(
      /:root \.pshell \.msg__effect::after \{[^}]*inset: -14px -10px;/,
    );
  });
});
