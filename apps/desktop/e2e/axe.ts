import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Fails on serious or critical WCAG 2.1 A/AA problems on the current screen. */
export async function auditA11y(page: Page, where: string): Promise<void> {
  // Measure the settled screen, not text halfway through fading in.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  // Legacy mode runs axe inside the page (Electron cannot open the extra page the default mode needs).
  const results = await new AxeBuilder({ page })
    .setLegacyMode(true)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = serious.map(
    (v) =>
      `${where}: ${v.id} (${v.impact}) — ${v.help}\n   ${v.nodes
        .slice(0, 4)
        .map((n) => `${n.target.join(' ')} ${process.env.RIVER_AXE_DEBUG ? (n.any[0]?.message ?? '') : ''}`)
        .join('\n   ')}`,
  );
  expect(report, report.join('\n')).toEqual([]);
}
