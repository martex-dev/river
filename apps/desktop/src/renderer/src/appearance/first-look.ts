import type { DesignSettings } from '../../../shared/design.ts';
import { isPhone } from '../../../shared/platform.ts';
import { useRiver } from '../store.ts';
import { themeById } from './themes.ts';

/**
 * River's look before anyone picks one (2.14). The first run no longer stops to ask: computers
 * keep River's usual look (Specter), phones start with a Telegram-like one — blue on white,
 * and dark when the phone is dark. Settings → Appearance changes it any time.
 */
export const PHONE_FIRST_THEME = 'corporate-enterprise-blue';

export function firstRunDesign(platform: string | undefined, design: DesignSettings): DesignSettings {
  if (design.chosen || !isPhone(platform)) return design;
  const theme = themeById(PHONE_FIRST_THEME);
  if (!theme) return design;
  return {
    ...design,
    skin: theme.skin,
    theme: theme.id,
    prefs: { ...design.prefs, colors: {}, mode: 'system' },
    activeProfile: null,
  };
}

/** Gives a phone its first look, once, right after the first screen (computers keep theirs). */
export async function applyFirstRunLook(): Promise<void> {
  const { info, settings, updateSettings } = useRiver.getState();
  if (!settings) return;
  const next = firstRunDesign(info?.platform ?? document.documentElement.dataset.platform, settings.design);
  if (next !== settings.design) await updateSettings({ design: next });
}

/** The "Pick your look" card was answered (either way): it does not come back. */
export async function markLookChosen(): Promise<void> {
  const { settings, updateSettings } = useRiver.getState();
  if (!settings || settings.design.chosen) return;
  await updateSettings({ design: { ...settings.design, chosen: true } });
}
