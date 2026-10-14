import { DEFAULT_DESIGN, type DesignPrefs, type DesignSettings } from '../../../shared/design.ts';
import { useRiver } from '../store.ts';
import { themeById } from './themes.ts';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** The saved design (or River's default before settings load). */
export function savedDesign(): DesignSettings {
  return useRiver.getState().settings?.design ?? DEFAULT_DESIGN;
}

/**
 * Changes the design: shown at once (live preview), saved a moment later so a
 * dragged slider does not write the settings file on every step.
 */
export function commitDesign(next: DesignSettings): void {
  const { setDesignPreview, updateSettings } = useRiver.getState();
  setDesignPreview(next, false);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void updateSettings({ design: next }).finally(() => {
      if (useRiver.getState().designPreview === next) useRiver.getState().setDesignPreview(null);
    });
  }, 300);
}

/** The design being edited: a live change not yet saved, else the saved one (never a try-on). */
export function useEditedDesign(): DesignSettings {
  const saved = useRiver((r) => r.settings?.design) ?? DEFAULT_DESIGN;
  const preview = useRiver((r) => r.designPreview);
  const trying = useRiver((r) => r.designTrying);
  return preview && !trying ? preview : saved;
}

export function setPrefs(design: DesignSettings, patch: Partial<DesignPrefs>): void {
  commitDesign({ ...design, prefs: { ...design.prefs, ...patch }, activeProfile: null });
}

export function applyTheme(design: DesignSettings, themeId: string): void {
  const custom = design.customThemes.find((c) => c.id === themeId);
  const skin = custom
    ? (themeById(custom.base)?.skin ?? design.skin)
    : (themeById(themeId)?.skin ?? design.skin);
  // A new theme starts from its own colours: personal colour overrides belong to the old one.
  commitDesign({
    ...design,
    skin,
    theme: themeId,
    prefs: { ...design.prefs, colors: {}, mode: 'theme' },
    activeProfile: null,
  });
}

/** Try a theme on the whole app until Apply or Cancel. */
export function tryTheme(design: DesignSettings, themeId: string): void {
  const custom = design.customThemes.find((c) => c.id === themeId);
  const skin = custom
    ? (themeById(custom.base)?.skin ?? design.skin)
    : (themeById(themeId)?.skin ?? design.skin);
  useRiver
    .getState()
    .setDesignPreview(
      { ...design, skin, theme: themeId, prefs: { ...design.prefs, colors: {}, mode: 'theme' } },
      true,
    );
}

export function applyTry(): void {
  const preview = useRiver.getState().designPreview;
  if (!preview) return;
  useRiver.getState().setDesignPreview(null);
  commitDesign({ ...preview, activeProfile: null });
}

export function cancelTry(): void {
  useRiver.getState().setDesignPreview(null);
}

export const newId = (prefix: string): string =>
  `${prefix}-${crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), '')}`.slice(
    0,
    40,
  );
