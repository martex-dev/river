import type { ReactElement } from 'react';
import { useRiver } from '../store.ts';
import { applyTry, cancelTry } from './editor.ts';
import { themeById } from './themes.ts';
import { rich, tr } from '../i18n.ts';

/**
 * Shown while a theme is being tried on: Apply keeps it, Cancel restores the
 * saved look exactly. Outside Settings it floats over the app so the whole
 * interface can be judged in the new theme.
 */
export function TryBar(props: { inSettings?: boolean }): ReactElement | null {
  const trying = useRiver((r) => r.designTrying);
  const preview = useRiver((r) => r.designPreview);
  const settingsOpen = useRiver((r) => r.settingsTab !== null);
  const close = useRiver((r) => r.closeSettings);
  const open = useRiver((r) => r.openSettings);
  if (!trying || !preview) return null;
  if (!props.inSettings && settingsOpen) return null;
  const name =
    preview.customThemes.find((c) => c.id === preview.theme)?.name ??
    themeById(preview.theme)?.name ??
    tr('this theme');
  return (
    <div
      className={`try-bar ${props.inSettings ? 'try-bar--inline' : 'try-bar--floating'}`}
      role="region"
      aria-label={tr('Theme preview')}
    >
      <span>{rich(tr('Trying {name}'), { name: <strong>{name}</strong> })}</span>
      {props.inSettings ? (
        <button className="btn btn--ghost btn--small" onClick={close}>
          {tr('Look at River')}
        </button>
      ) : (
        <button className="btn btn--ghost btn--small" onClick={() => open('appearance')}>
          {tr('Back to themes')}
        </button>
      )}
      <button className="btn btn--ghost btn--small" onClick={cancelTry}>
        {tr('Cancel')}
      </button>
      <button className="btn btn--primary btn--small" onClick={applyTry}>
        {tr('Apply')}
      </button>
    </div>
  );
}
