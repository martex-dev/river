import { useState, type ReactElement } from 'react';
import { DEFAULT_DESIGN, type DesignSettings } from '../../../shared/design.ts';
import { useRiver } from '../store.ts';
import { commitDesign } from './editor.ts';
import { ThemeBrowser } from './ThemeBrowser.tsx';
import { themeById } from './themes.ts';

/**
 * The first thing River asks (1.0.46): which skin. There is no built-in default
 * look — everyone chooses one (and a palette), and can change or customise it
 * any time in Settings → Appearance. The whole screen previews each choice live.
 */
export function SkinGate(): ReactElement {
  const saved = useRiver((r) => r.settings?.design) ?? DEFAULT_DESIGN;
  const setPreview = useRiver((r) => r.setDesignPreview);
  const [picked, setPicked] = useState<string | null>(null);
  const design: DesignSettings = picked
    ? { ...saved, theme: picked, skin: themeById(picked)?.skin ?? saved.skin }
    : saved;
  const choose = (themeId: string): void => {
    setPicked(themeId);
    setPreview(
      {
        ...saved,
        theme: themeId,
        skin: themeById(themeId)?.skin ?? saved.skin,
        prefs: { ...saved.prefs, colors: {}, mode: 'theme' },
      },
      true,
    );
  };
  const name = picked ? themeById(picked) : null;
  return (
    <div className="skin-gate" role="dialog" aria-modal="true" aria-labelledby="skin-gate-title">
      <div className="skin-gate__inner">
        <header className="skin-gate__head">
          <div className="eyebrow">Welcome to River</div>
          <h1 id="skin-gate-title" className="page__title">
            Choose your look
          </h1>
          <p className="muted">
            Pick a skin, then a palette. River changes as you click. You can switch or customise it any time
            in Settings → Appearance.
          </p>
        </header>
        <ThemeBrowser design={design} selectedTheme={picked ?? '__none__'} onPick={choose} />
        <footer className="skin-gate__foot">
          <span className="muted">
            {name ? (
              <>
                <strong>{name.name}</strong> palette selected
              </>
            ) : (
              'Choose a skin to continue'
            )}
          </span>
          <button
            className="btn btn--primary"
            disabled={!picked}
            onClick={() => {
              if (!picked) return;
              setPreview(null);
              commitDesign({
                ...saved,
                skin: themeById(picked)?.skin ?? saved.skin,
                theme: picked,
                prefs: { ...saved.prefs, colors: {}, mode: 'theme' },
                activeProfile: null,
                chosen: true,
              });
            }}
          >
            Continue
          </button>
        </footer>
      </div>
    </div>
  );
}
