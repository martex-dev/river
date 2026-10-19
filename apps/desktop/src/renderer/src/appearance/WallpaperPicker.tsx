import { useRef, useState, type ReactElement } from 'react';
import {
  DEFAULT_WALLPAPER,
  designImage,
  WALLPAPER_GRADIENTS,
  WALLPAPER_PATTERNS,
  type DesignSettings,
  type Wallpaper,
} from '../../../shared/design.ts';
import { isHex } from './color.ts';
import { pct, Slider } from './controls.tsx';
import { preparePhoto } from './photo.ts';
import { tr } from '../i18n.ts';
import {
  GRADIENT_NAMES,
  PATTERN_NAMES,
  readableBehindText,
  wallpaperLayers,
  type WallpaperColors,
} from './wallpaper.ts';

/** One choice in the wallpaper grid. */
interface Option {
  id: string;
  name: string;
  value: Wallpaper;
}

function options(current: Wallpaper): Option[] {
  const base = { ...DEFAULT_WALLPAPER, ...current };
  return [
    { id: 'none', name: tr('No wallpaper'), value: { ...base, kind: 'none' } },
    ...WALLPAPER_PATTERNS.map((pattern) => ({
      id: `pattern:${pattern}`,
      name: tr('{name} doodles', { name: tr(PATTERN_NAMES[pattern]) }),
      value: { ...base, kind: 'pattern' as const, pattern },
    })),
    ...WALLPAPER_GRADIENTS.map((gradient) => ({
      id: `gradient:${gradient}`,
      name: tr('{name} gradient', { name: tr(GRADIENT_NAMES[gradient]) }),
      value: { ...base, kind: 'gradient' as const, gradient },
    })),
    { id: 'solid', name: tr('One colour'), value: { ...base, kind: 'solid' } },
    { id: 'photo', name: tr('My photo'), value: { ...base, kind: 'photo' } },
  ];
}

const idOf = (w: Wallpaper): string =>
  w.kind === 'pattern' ? `pattern:${w.pattern}` : w.kind === 'gradient' ? `gradient:${w.gradient}` : w.kind;

/**
 * Wallpapers to pick from, drawn in the current theme's colours, and the settings of the one
 * picked: doodle colour and strength, the colours under the doodles, a solid colour, or a photo
 * with blur and dimming. `onChange` gets every change at once (the live preview follows).
 */
export function WallpaperPicker(props: {
  value: Wallpaper;
  colors: WallpaperColors | null;
  design: Pick<DesignSettings, 'images'>;
  onChange(w: Wallpaper): void;
  /** How many more photos may be kept (a picked photo is refused beyond that). */
  photosLeft?: number;
}): ReactElement {
  const w = { ...DEFAULT_WALLPAPER, ...props.value };
  const c = props.colors;
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = options(w);
  const photo = designImage(props.design, w.photo);
  const set = (patch: Partial<Wallpaper>): void => props.onChange({ ...w, ...patch });
  const pickPhoto = (f: File | undefined): void => {
    setError(null);
    if (!f) return;
    if (props.photosLeft !== undefined && props.photosLeft <= 0 && !w.photo)
      return setError(tr('You have many chat photos already. Remove one from another chat first.'));
    setBusy(true);
    preparePhoto(f)
      .then((url) => set({ kind: 'photo', photo: url }))
      .catch((e: unknown) => setError(tr(e instanceof Error ? e.message : 'That picture could not be read.')))
      .finally(() => setBusy(false));
  };
  const swatch = (o: Option): string =>
    c ? wallpaperLayers(o.value, c, o.value.kind === 'photo' ? photo : null, 120).background : 'none';
  const solidShown = c ? readableBehindText(w.color ?? c.base, c) : null;
  return (
    <div className="wp-picker">
      <div className="wp-grid" role="radiogroup" aria-label={tr('Wallpaper')}>
        {all.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={idOf(w) === o.id}
            aria-label={o.name}
            title={o.name}
            className={`wp-tile ${idOf(w) === o.id ? 'is-selected' : ''} wp-tile--${o.value.kind}`}
            style={{ background: swatch(o) }}
            onClick={() => {
              if (o.value.kind === 'photo' && !photo) return file.current?.click();
              props.onChange(o.value);
            }}
          >
            {o.value.kind === 'none' && <span aria-hidden="true">∅</span>}
            {o.value.kind === 'photo' && !photo && <span aria-hidden="true">＋</span>}
          </button>
        ))}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          pickPhoto(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {w.kind === 'pattern' && (
        <>
          <div className="design-row">
            <span className="design-row__label">{tr('Colours under the doodles')}</span>
            <div className="wp-chips" role="radiogroup" aria-label={tr('Colours under the doodles')}>
              {WALLPAPER_GRADIENTS.map((g) => (
                <button
                  key={g}
                  role="radio"
                  aria-checked={w.gradient === g}
                  aria-label={tr(GRADIENT_NAMES[g])}
                  title={tr(GRADIENT_NAMES[g])}
                  className={`wp-chip ${w.gradient === g ? 'is-selected' : ''}`}
                  style={{
                    background: c
                      ? wallpaperLayers({ ...w, kind: 'gradient', gradient: g }, c).background
                      : '',
                  }}
                  onClick={() => set({ gradient: g })}
                />
              ))}
            </div>
          </div>
          <div className="design-row">
            <span className="design-row__label">{tr('Doodle colour')}</span>
            <span className="design-actions">
              <input
                type="color"
                aria-label={tr('Doodle colour')}
                value={w.color && isHex(w.color) ? w.color : (c?.accent ?? '#5865f2')}
                onChange={(e) => set({ color: e.target.value })}
              />
              {w.color ? (
                <button className="btn btn--link btn--small" onClick={() => set({ color: null })}>
                  {tr('Use the accent')}
                </button>
              ) : (
                <span className="muted small">{tr('the accent')}</span>
              )}
            </span>
          </div>
          <Slider
            label={tr('Doodle strength')}
            value={w.strength}
            min={0}
            max={1}
            step={0.05}
            format={pct}
            onChange={(strength) => set({ strength })}
          />
        </>
      )}
      {w.kind === 'solid' && (
        <div className="design-row">
          <span className="design-row__label">{tr('Colour')}</span>
          <span className="design-actions">
            <input
              type="color"
              aria-label={tr('Wallpaper colour')}
              value={w.color && isHex(w.color) ? w.color : (c?.base ?? '#202225')}
              onChange={(e) => set({ color: e.target.value })}
            />
            {w.color && solidShown && solidShown !== w.color.toLowerCase() && (
              <span className="muted small">{tr('Softened so text stays readable.')}</span>
            )}
          </span>
        </div>
      )}
      {w.kind === 'photo' && (
        <>
          <div className="design-actions">
            <button
              className="btn btn--ghost btn--small"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              {busy ? tr('Preparing…') : photo ? tr('Choose another photo…') : tr('Choose a photo…')}
            </button>
            <span className="muted small">{tr('Stays on this device and is never uploaded.')}</span>
          </div>
          <Slider
            label={tr('Blur photo')}
            value={w.blur}
            min={0}
            max={24}
            step={1}
            format={(v) => `${v}px`}
            onChange={(blur) => set({ blur })}
          />
          <Slider
            label={tr('Dim photo')}
            value={w.dim}
            min={0.15}
            max={0.85}
            step={0.05}
            format={pct}
            onChange={(dim) => set({ dim })}
          />
          <p className="muted small">{tr('Messages get a backing over a photo, so they stay readable.')}</p>
        </>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
