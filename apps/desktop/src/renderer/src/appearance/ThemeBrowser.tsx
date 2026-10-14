import { memo, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { DEFAULT_DESIGN_PREFS, type DesignSettings } from '../../../shared/design.ts';
import { commitDesign, applyTheme, tryTheme } from './editor.ts';
import { catalog, resolveDesign, type CatalogEntry } from './engine.ts';
import { SKINS } from './skins.ts';

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
            <span>See you in voice at nine</span>
          </div>
        </div>
        <div className="tp__msg tp__msg--mine">
          <i className="tp__av tp__av--me" />
          <div className="tp__body">
            <b>You</b>
            <span>On my way ✨</span>
          </div>
        </div>
        <div className="tp__bar">
          <span className="tp__input" />
          <span className="tp__btn">Send</span>
        </div>
      </div>
    </div>
  );
});

type Filter = 'all' | 'expressive' | 'professional' | 'favorites' | 'mine';

export function ThemeBrowser(props: { design: DesignSettings }): ReactElement {
  const { design } = props;
  const [query, setQuery] = useState('');
  const [skin, setSkin] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [mode, setMode] = useState<'any' | 'dark' | 'light'>('any');
  const entries = useMemo(() => catalog(design.customThemes), [design.customThemes]);
  const q = query.trim().toLowerCase();
  const shown = entries.filter(
    (e) =>
      (skin === 'all' || e.skin.id === skin) &&
      (mode === 'any' || e.theme.mode === mode) &&
      (filter === 'all' ||
        (filter === 'favorites' && design.favorites.includes(e.id)) ||
        (filter === 'mine' && e.custom) ||
        e.skin.direction === filter) &&
      (!q || `${e.name} ${e.skin.name} ${e.description}`.toLowerCase().includes(q)),
  );
  const toggleFavorite = (id: string): void => {
    const favorites = design.favorites.includes(id)
      ? design.favorites.filter((f) => f !== id)
      : [...design.favorites, id];
    commitDesign({ ...design, favorites });
  };
  return (
    <div className="design-browser">
      <div className="design-browser__filters">
        <input
          className="search"
          placeholder={`Search ${entries.length} themes`}
          aria-label="Search themes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="seg" role="radiogroup" aria-label="Show">
          {(
            [
              ['all', 'All'],
              ['expressive', 'Expressive'],
              ['professional', 'Professional'],
              ['favorites', '★ Favourites'],
              ['mine', 'Mine'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={filter === id}
              className={`seg__item ${filter === id ? 'is-active' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="Light or dark">
          {(
            [
              ['any', 'Any'],
              ['dark', 'Dark'],
              ['light', 'Light'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              className={`seg__item ${mode === id ? 'is-active' : ''}`}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="design-skins" role="radiogroup" aria-label="Skin">
        <button
          role="radio"
          aria-checked={skin === 'all'}
          className={`design-skin ${skin === 'all' ? 'is-active' : ''}`}
          onClick={() => setSkin('all')}
        >
          <strong>All skins</strong>
          <span>{SKINS.length} design languages</span>
        </button>
        {SKINS.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={skin === s.id}
            className={`design-skin ${skin === s.id ? 'is-active' : ''}`}
            onClick={() => setSkin(s.id)}
            title={s.description}
          >
            <strong>{s.name}</strong>
            <span>{s.tagline}</span>
          </button>
        ))}
      </div>
      {skin !== 'all' && (
        <p className="muted small design-browser__about">{SKINS.find((s) => s.id === skin)?.description}</p>
      )}
      {shown.length === 0 ? (
        <p className="muted design-browser__empty">No themes match. Clear the search or pick another skin.</p>
      ) : (
        <div className="design-grid">
          {shown.map((e) => (
            <ThemeCard
              key={e.id}
              entry={e}
              design={design}
              selected={design.theme === e.id}
              favorite={design.favorites.includes(e.id)}
              onFavorite={() => toggleFavorite(e.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeCard(props: {
  entry: CatalogEntry;
  design: DesignSettings;
  selected: boolean;
  favorite: boolean;
  onFavorite(): void;
}): ReactElement {
  const { entry, design } = props;
  return (
    <article
      className={`theme-card ${props.selected ? 'is-selected' : ''}`}
      aria-label={`${entry.name} theme`}
    >
      <button
        className="theme-card__preview"
        onClick={() => applyTheme(design, entry.id)}
        aria-label={`Use ${entry.name}`}
        aria-pressed={props.selected}
      >
        <ThemePreview themeId={entry.id} design={design} />
      </button>
      <div className="theme-card__info">
        <div className="theme-card__name">
          <strong>{entry.name}</strong>
          <span className="theme-card__skin">
            {entry.skin.name}
            {entry.custom ? ' · yours' : ''} · {entry.theme.mode}
          </span>
        </div>
        <button
          className={`theme-card__fav ${props.favorite ? 'is-on' : ''}`}
          aria-label={
            props.favorite ? `Remove ${entry.name} from favourites` : `Add ${entry.name} to favourites`
          }
          aria-pressed={props.favorite}
          onClick={props.onFavorite}
        >
          {props.favorite ? '★' : '☆'}
        </button>
      </div>
      <p className="theme-card__desc">{entry.description}</p>
      <div className="theme-card__actions">
        {props.selected ? (
          <span className="theme-card__current">✓ In use</span>
        ) : (
          <>
            <button className="btn btn--ghost btn--small" onClick={() => tryTheme(design, entry.id)}>
              Try
            </button>
            <button className="btn btn--primary btn--small" onClick={() => applyTheme(design, entry.id)}>
              Apply
            </button>
          </>
        )}
      </div>
    </article>
  );
}
