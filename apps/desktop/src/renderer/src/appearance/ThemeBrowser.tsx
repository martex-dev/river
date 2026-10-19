import { memo, useMemo, type CSSProperties, type ReactElement } from 'react';
import { DEFAULT_DESIGN_PREFS, type DesignSettings } from '../../../shared/design.ts';
import { applyTheme, tryTheme } from './editor.ts';
import { resolveDesign } from './engine.ts';
import { SKINS, type Skin } from './skins.ts';
import { themeById, themesOf, type Theme } from './themes.ts';
import { tr } from '../i18n.ts';

/** A miniature River drawn with one theme's real tokens, fonts and shapes. */
export const ThemePreview = memo(function ThemePreview(props: {
  themeId: string;
  design: DesignSettings;
  /** Use the person's adjustments too (current look) instead of the theme as designed. */
  withPrefs?: boolean;
}): ReactElement {
  const r = useMemo(
    () =>
      resolveDesign(
        {
          ...props.design,
          theme: props.themeId,
          prefs: props.withPrefs ? props.design.prefs : { ...DEFAULT_DESIGN_PREFS, mode: 'theme' },
        },
        { systemDark: true, highContrast: false },
      ),
    [props.themeId, props.design, props.withPrefs],
  );
  return (
    <div
      className="tp"
      style={r.vars as CSSProperties}
      data-avatar={r.attrs.avatar}
      data-buttons={r.attrs.buttons}
      data-msg={r.attrs.msg}
      data-decor={r.attrs.decor}
      data-frame={r.attrs.frame}
      aria-hidden="true"
    >
      <div className="tp__rail">
        <i className="tp__dot tp__dot--home" />
        <i className="tp__dot" />
        <i className="tp__dot tp__dot--alt" />
      </div>
      <div className="tp__side">
        <b className="tp__title">{r.skin.name}</b>
        <span className="tp__ch is-active">general</span>
        <span className="tp__ch">voice</span>
        <span className="tp__ch">memes</span>
        <span className="tp__me">
          <i className="tp__av" />
        </span>
      </div>
      <div className="tp__main">
        <div className="tp__msg">
          <i className="tp__av" />
          <div className="tp__body">
            <b>Ana</b>
            <span>{tr('See you in voice at nine')}</span>
          </div>
        </div>
        <div className="tp__msg tp__msg--mine">
          <i className="tp__av tp__av--me" />
          <div className="tp__body">
            <b>{tr('You')}</b>
            <span>{tr('On my way ✨')}</span>
          </div>
        </div>
        <div className="tp__bar">
          <span className="tp__input" />
          <span className="tp__btn">{tr('Send')}</span>
        </div>
      </div>
    </div>
  );
});

/** The skin a design uses (a custom theme counts as its base theme's skin). */
export function skinOf(design: DesignSettings): string {
  const custom = design.customThemes.find((c) => c.id === design.theme);
  return themeById(custom?.base ?? design.theme)?.skin ?? design.skin;
}

/**
 * Skins, then the chosen skin's palettes (1.0.46, after Specter's gallery). Picking a
 * skin keeps the palette's position when it can, so "the third palette" stays third.
 */
export function ThemeBrowser(props: {
  design: DesignSettings;
  /** Called instead of applying (the first-run chooser applies on Continue). */
  onPick?: (themeId: string) => void;
  /** Preview the whole app on click instead of applying (theme browser "Try"). */
  selectedTheme?: string;
}): ReactElement {
  const { design } = props;
  const current = props.selectedTheme ?? design.theme;
  // On the first-run chooser nothing is selected until the person picks.
  const nothingYet = props.selectedTheme === '__none__';
  const currentSkin = nothingYet
    ? null
    : (themeById(design.customThemes.find((c) => c.id === current)?.base ?? current)?.skin ?? skinOf(design));
  const pick = (themeId: string): void =>
    props.onPick ? props.onPick(themeId) : applyTheme(design, themeId);
  const palettes = currentSkin ? themesOf(currentSkin) : [];
  const position = Math.max(
    0,
    palettes.findIndex((t) => t.id === current),
  );
  const mine = design.customThemes.filter((c) => themeById(c.base)?.skin === currentSkin);
  const skinName = SKINS.find((s) => s.id === currentSkin)?.name ?? '';
  return (
    <div className="design-browser">
      <h3 className="design-section">{tr('Skins')}</h3>
      <div className="skin-grid" role="radiogroup" aria-label={tr('Skin')}>
        {SKINS.map((skin) => (
          <SkinCard
            key={skin.id}
            skin={skin}
            design={design}
            selected={skin.id === currentSkin}
            paletteIndex={position}
            onPick={pick}
          />
        ))}
      </div>
      {currentSkin && <h3 className="design-section">{tr('{name} palettes', { name: skinName })}</h3>}
      {currentSkin && (
        <div className="palette-row" role="radiogroup" aria-label={tr('{name} palettes', { name: skinName })}>
          {palettes.map((t) => (
            <PaletteChip key={t.id} theme={t} selected={t.id === current} onPick={() => pick(t.id)} />
          ))}
          {mine.map((c) => {
            const base = themeById(c.base);
            if (!base) return null;
            return (
              <PaletteChip
                key={c.id}
                theme={{
                  ...base,
                  id: c.id,
                  name: c.name,
                  accent: c.colors.accent ?? base.accent,
                  accent2: c.colors.accent2 ?? base.accent2,
                }}
                selected={c.id === current}
                mine
                onPick={() => pick(c.id)}
              />
            );
          })}
        </div>
      )}
      {!props.onPick && palettes.length > 0 && (
        <p className="muted small">
          {tr('Click a skin or palette to use it at once.')}{' '}
          <button
            className="btn btn--link btn--small"
            onClick={() => tryTheme(design, palettes[(position + 1) % palettes.length]!.id)}
          >
            {tr('Try the next palette on the whole app')}
          </button>
        </p>
      )}
    </div>
  );
}

function SkinCard(props: {
  skin: Skin;
  design: DesignSettings;
  selected: boolean;
  paletteIndex: number;
  onPick(themeId: string): void;
}): ReactElement {
  const palettes = themesOf(props.skin.id);
  const theme = palettes[Math.min(props.paletteIndex, palettes.length - 1)] ?? palettes[0]!;
  return (
    <button
      role="radio"
      aria-checked={props.selected}
      aria-label={tr('{name} skin', { name: props.skin.name })}
      className={`skin-card ${props.selected ? 'is-selected' : ''}`}
      onClick={() => props.onPick(theme.id)}
    >
      <ThemePreview themeId={theme.id} design={props.design} />
      <span className="skin-card__name">
        {props.skin.name}
        {props.selected && (
          <span className="skin-card__check" aria-hidden="true">
            ✓
          </span>
        )}
      </span>
      <span className="skin-card__tagline">{tr(props.skin.tagline)}</span>
    </button>
  );
}

function PaletteChip(props: {
  theme: Theme;
  selected: boolean;
  mine?: boolean;
  onPick(): void;
}): ReactElement {
  const t = props.theme;
  return (
    <button
      role="radio"
      aria-checked={props.selected}
      aria-label={
        props.mine ? tr('{name} palette (yours)', { name: t.name }) : tr('{name} palette', { name: t.name })
      }
      className={`palette-chip ${props.selected ? 'is-selected' : ''}`}
      onClick={props.onPick}
      title={`${t.name} · ${t.mode === 'dark' ? tr('dark') : tr('light')}`}
    >
      <span
        className="palette-chip__swatch"
        aria-hidden="true"
        style={{
          background: `linear-gradient(135deg, ${t.accent} 0 50%, ${t.accent2} 50% 100%)`,
          borderColor: t.bg,
        }}
      />
      {t.name}
      {props.mine && <span className="muted small"> · {tr('yours')}</span>}
    </button>
  );
}
