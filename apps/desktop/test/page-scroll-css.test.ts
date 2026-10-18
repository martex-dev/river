import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 2.13.1: the page column (<main class="content">) is what scrolls Admin, Friends, Social, Calls
// and Files. A skin rule with `overflow: hidden` on it (the floating frame did) outranks app.css's
// `overflow-y: auto` and leaves long pages unreachable. The e2e scroll test wheels it for real;
// this catches the rule itself in every stylesheet, without starting River.
const STYLES = join(__dirname, '../src/renderer/src/styles');

/** Every innermost `selectors { declarations }` block of a stylesheet, comments removed. */
function rules(css: string): Array<{ selectors: string[]; body: string }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.trim()),
    body: m[2]!,
  }));
}

/** The last compound of a selector names the page column (`.content`, not `.content--full`). */
const isPageColumn = (selector: string): boolean => {
  const last = selector.split(/[\s>+~]+/).pop() ?? '';
  return /\.content(?![\w-])/.test(last) && !last.includes(':not(');
};

describe('the page column scrolls in every skin', () => {
  const sheets = readdirSync(STYLES).filter((f) => f.endsWith('.css'));

  it('finds the stylesheets', () => {
    expect(sheets).toEqual(expect.arrayContaining(['app.css', 'discord.css', 'skins.css', 'design.css']));
  });

  it('app.css lets it scroll', () => {
    const own = rules(readFileSync(join(STYLES, 'app.css'), 'utf8')).find((r) =>
      r.selectors.includes('.content'),
    );
    expect(own?.body).toMatch(/overflow-y:\s*auto/);
  });

  it('no rule clips it', () => {
    const clipping: string[] = [];
    for (const sheet of sheets) {
      for (const rule of rules(readFileSync(join(STYLES, sheet), 'utf8'))) {
        if (!/(^|;|\s)overflow(-y)?:\s*(hidden|clip)/.test(rule.body)) continue;
        for (const s of rule.selectors) if (isPageColumn(s)) clipping.push(`${sheet}: ${s}`);
      }
    }
    expect(clipping).toEqual([]);
  });
});
