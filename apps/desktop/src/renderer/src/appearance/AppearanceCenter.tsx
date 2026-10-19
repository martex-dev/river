import { useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  COLOR_ROLES,
  DEFAULT_DESIGN,
  DEFAULT_DESIGN_PREFS,
  designExportSchema,
  MAX_WALLPAPER_PHOTOS,
  type ColorRole,
  type DesignPrefs,
  type DesignProfile,
  type DesignSettings,
} from '../../../shared/design.ts';
import type { Settings } from '../../../shared/settings.ts';
import { Toggle } from '../community/ui/common.tsx';
import { play } from '../community/sound.ts';
import { celebrate } from '../community/fx.tsx';
import { useRiver } from '../store.ts';
import { contrast } from './color.ts';
import { applyTheme, commitDesign, newId, setPrefs, useEditedDesign } from './editor.ts';
import { resolveDesign } from './engine.ts';
import { THEMES, themeById } from './themes.ts';
import { ThemeBrowser, ThemePreview } from './ThemeBrowser.tsx';
import { Choice, Group, pct, Row, Slider } from './controls.tsx';
import { AccentPicker } from './AccentPicker.tsx';
import { chatPhotoCount } from './ChatWallpaper.tsx';
import { LivePreview } from './LivePreview.tsx';
import { addSharedTheme, parseThemeCode, themeCode } from './share.ts';
import { SKINS } from './skins.ts';
import { colorsOf } from './wallpaper.ts';
import { WallpaperPicker } from './WallpaperPicker.tsx';
import { isPhone } from '../../../shared/platform.ts';
import { msg, tr, trn } from '../i18n.ts';

const SECTIONS = [
  ['themes', msg('Themes')],
  ['colors', msg('Colours')],
  ['chat', msg('Chat')],
  ['type', msg('Typography')],
  ['layout', msg('Layout')],
  ['components', msg('Components')],
  ['effects', msg('Effects')],
  ['background', msg('Background')],
  ['motion', msg('Motion')],
  ['profiles', msg('Profiles')],
  ['general', msg('General')],
] as const;
type Section = (typeof SECTIONS)[number][0];

/**
 * The appearance and personalisation centre (1.0.45): skins and themes, colours,
 * type, layout, components, effects, background, motion and saved profiles.
 * Every control changes the live app immediately and is saved automatically.
 * 2.18: a live sample chat on top, an accent picker, theme codes, and the Chat section
 * (wallpapers, bubbles, text size, density).
 */
export function AppearanceCenter(props: { general: ReactNode }): ReactElement {
  const [section, setSection] = useState<Section>('themes');
  const design = useEditedDesign();
  const resolved = useMemo(() => resolveDesign(design), [design]);
  const p = { ...DEFAULT_DESIGN_PREFS, ...design.prefs };
  const set = (patch: Partial<DesignPrefs>): void => setPrefs(design, patch);
  return (
    <div className="design">
      <header className="design__head">
        <div className="design__now">
          <LivePreview design={design} />
          <div>
            <div className="eyebrow">{tr('Now using')}</div>
            <h2 className="panel__title">{nameOf(design)}</h2>
            <p className="muted small">
              {tr('{name} skin', { name: resolved.skin.name })} · {tr(modeLabel(resolved.theme.mode))} ·{' '}
              {design.activeProfile
                ? tr('profile “{name}”', {
                    name: design.profiles.find((x) => x.id === design.activeProfile)?.name ?? '',
                  })
                : tr('your settings')}
            </p>
          </div>
        </div>
        <nav className="design__tabs" role="tablist" aria-label={tr('Appearance sections')}>
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={section === id}
              className={`design__tab ${section === id ? 'is-active' : ''}`}
              onClick={() => setSection(id)}
            >
              {tr(label)}
            </button>
          ))}
        </nav>
      </header>

      {section === 'themes' && <ThemeBrowser design={design} />}
      {section === 'colors' && <Colors design={design} />}
      {section === 'chat' && <ChatLook design={design} />}
      {section === 'type' && (
        <Group>
          <Row label={tr('Interface font')}>
            <Choice
              value={p.uiFont}
              onChange={(uiFont) => set({ uiFont })}
              options={[
                ['skin', tr('Skin')],
                ['inter', 'Inter'],
                ['manrope', 'Manrope'],
                ['plex', 'IBM Plex'],
                ['exo', 'Exo 2'],
                ['grotesk', 'Space Grotesk'],
                ['hyperlegible', 'Hyperlegible'],
                ['mono', tr('Monospace')],
              ]}
            />
          </Row>
          <Row label={tr('Heading font')}>
            <Choice
              value={p.displayFont}
              onChange={(displayFont) => set({ displayFont })}
              options={[
                ['skin', tr('Skin')],
                ['same', tr('Same as text')],
                ['grotesk', 'Space Grotesk'],
                ['orbitron', 'Orbitron'],
                ['playfair', 'Playfair'],
                ['exo', 'Exo 2'],
                ['plex', 'IBM Plex'],
                ['vt323', 'VT323'],
              ]}
            />
          </Row>
          <Row label={tr('Code font')}>
            <Choice
              value={p.monoFont}
              onChange={(monoFont) => set({ monoFont })}
              options={[
                ['skin', tr('Skin')],
                ['jetbrains', 'JetBrains Mono'],
                ['fira', 'Fira Code'],
                ['plex-mono', 'IBM Plex Mono'],
                ['vt323', 'VT323'],
              ]}
            />
          </Row>
          <Row label={tr('Headings')}>
            <Choice
              value={p.headings}
              onChange={(headings) => set({ headings })}
              options={[
                ['skin', tr('Skin')],
                ['normal', tr('Normal')],
                ['uppercase', tr('Uppercase')],
                ['display', tr('Display font')],
              ]}
            />
          </Row>
          <Slider
            label={tr('Text weight')}
            value={p.textWeight}
            min={300}
            max={600}
            step={50}
            onChange={(textWeight) => set({ textWeight })}
          />
          <Slider
            label={tr('Line height')}
            value={p.lineHeight}
            min={1.2}
            max={1.9}
            step={0.05}
            onChange={(lineHeight) => set({ lineHeight })}
          />
          <Slider
            label={tr('Letter spacing')}
            value={p.letterSpacing}
            min={-0.03}
            max={0.08}
            step={0.005}
            format={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`}
            onChange={(letterSpacing) => set({ letterSpacing })}
          />
          <Toggle
            label={tr('Table numbers')}
            help={tr('Digits of equal width, so times and counts line up.')}
            checked={p.tabularNumbers}
            onChange={(tabularNumbers) => set({ tabularNumbers })}
          />
          <p className="muted small">{tr('Message text size and the interface size are under General.')}</p>
        </Group>
      )}
      {section === 'layout' && (
        <Group>
          <Row label={tr('Messages look like')}>
            <Choice
              value={p.messageStyle}
              onChange={(messageStyle) => set({ messageStyle })}
              options={[
                ['skin', tr('Skin')],
                ['flat', tr('Classic')],
                ['bubbles', tr('Bubbles')],
                ['cards', tr('Cards')],
                ['compact', tr('Compact')],
                ['terminal', tr('Terminal')],
              ]}
            />
          </Row>
          <Row label={tr('Your messages (bubbles)')}>
            <Choice
              value={p.ownMessages}
              onChange={(ownMessages) => set({ ownMessages })}
              options={[
                ['right', tr('On the right')],
                ['left', tr('On the left')],
              ]}
            />
          </Row>
          <Row label={tr('Pictures')}>
            <Choice
              value={p.avatarShape}
              onChange={(avatarShape) => set({ avatarShape })}
              options={[
                ['skin', tr('Skin')],
                ['circle', tr('Circle')],
                ['rounded', tr('Rounded')],
                ['square', tr('Square')],
                ['hexagon', tr('Hexagon')],
              ]}
            />
          </Row>
          <Row label={tr('Navigation side')}>
            <Choice
              value={p.navSide}
              onChange={(navSide) => set({ navSide })}
              options={[
                ['left', tr('Left')],
                ['right', tr('Right')],
              ]}
            />
          </Row>
          <Row label={tr('Community rail')}>
            <Choice
              value={p.railSize}
              onChange={(railSize) => set({ railSize })}
              options={[
                ['normal', tr('Normal')],
                ['compact', tr('Compact')],
              ]}
            />
          </Row>
          <Slider
            label={tr('Sidebar width')}
            value={p.sidebarWidth}
            min={200}
            max={340}
            step={10}
            format={(v) => `${v}px`}
            onChange={(sidebarWidth) => set({ sidebarWidth })}
          />
          <Row label={tr('Member list')}>
            <Choice
              value={p.memberList}
              onChange={(memberList) => set({ memberList })}
              options={[
                ['show', tr('Show')],
                ['hide', tr('Hide')],
              ]}
            />
          </Row>
          <Slider
            label={tr('Member list width')}
            value={p.memberWidth}
            min={180}
            max={320}
            step={10}
            format={(v) => `${v}px`}
            onChange={(memberWidth) => set({ memberWidth })}
          />
          <Row label={tr('Conversation width')}>
            <Choice
              value={p.chatWidth}
              onChange={(chatWidth) => set({ chatWidth })}
              options={[
                ['full', tr('Full')],
                ['readable', tr('Readable column')],
              ]}
            />
          </Row>
          <Slider
            label={tr('Spacing')}
            value={p.spacing}
            min={0.7}
            max={1.4}
            step={0.05}
            format={pct}
            onChange={(spacing) => set({ spacing })}
          />
          <Row label={tr('Title bar')}>
            <Choice
              value={p.titlebar}
              onChange={(titlebar) => set({ titlebar })}
              options={[
                ['show', tr('Name and place')],
                ['minimal', tr('Minimal')],
              ]}
            />
          </Row>
          <Toggle
            label={tr('Focus mode')}
            help={tr('Hides the community rail and member list: just channels and the conversation.')}
            checked={p.focusMode}
            onChange={(focusMode) => set({ focusMode })}
          />
        </Group>
      )}
      {section === 'components' && (
        <Group>
          <Row label={tr('Buttons')}>
            <Choice
              value={p.buttonShape}
              onChange={(buttonShape) => set({ buttonShape })}
              options={[
                ['skin', tr('Skin')],
                ['pill', tr('Pill')],
                ['rounded', tr('Rounded')],
                ['square', tr('Square')],
                ['cut', tr('Cut corners')],
              ]}
            />
          </Row>
          <Row label={tr('Tabs')}>
            <Choice
              value={p.tabs}
              onChange={(tabs) => set({ tabs })}
              options={[
                ['skin', tr('Skin')],
                ['pill', tr('Pill')],
                ['underline', tr('Underline')],
                ['block', tr('Block')],
              ]}
            />
          </Row>
          <Row label={tr('Unread badges')}>
            <Choice
              value={p.badges}
              onChange={(badges) => set({ badges })}
              options={[
                ['filled', tr('Filled')],
                ['outline', tr('Outline')],
                ['dot', tr('Dot')],
              ]}
            />
          </Row>
          <Row label={tr('Scrollbars')}>
            <Choice
              value={p.scrollbars}
              onChange={(scrollbars) => set({ scrollbars })}
              options={[
                ['thin', tr('Thin')],
                ['normal', tr('Normal')],
                ['hidden', tr('Hidden')],
              ]}
            />
          </Row>
          <Slider
            label={tr('Corner rounding')}
            value={p.radius}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(radius) => set({ radius })}
          />
          <Slider
            label={tr('Border thickness')}
            value={p.borderWidth}
            min={0}
            max={2}
            step={0.25}
            format={pct}
            onChange={(borderWidth) => set({ borderWidth })}
          />
          <Slider
            label={tr('Border visibility')}
            value={p.borders}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(borders) => set({ borders })}
          />
          <Slider
            label={tr('Icon size')}
            value={p.iconSize}
            min={16}
            max={26}
            step={1}
            format={(v) => `${v}px`}
            onChange={(iconSize) => set({ iconSize })}
          />
          <Slider
            label={tr('Icon stroke')}
            value={p.iconStroke}
            min={1.2}
            max={2.6}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(iconStroke) => set({ iconStroke })}
          />
        </Group>
      )}
      {section === 'effects' && (
        <Group>
          <Slider
            label={tr('Overall intensity')}
            value={p.intensity}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(intensity) => set({ intensity })}
          />
          <Slider
            label={tr('Contrast')}
            value={p.contrast}
            min={0.8}
            max={1.5}
            step={0.05}
            format={pct}
            onChange={(contrast) => set({ contrast })}
          />
          <Slider
            label={tr('Colour saturation')}
            value={p.saturation}
            min={0}
            max={1.5}
            step={0.05}
            format={pct}
            onChange={(saturation) => set({ saturation })}
          />
          <Slider
            label={tr('Surface depth')}
            value={p.surfaceDepth}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(surfaceDepth) => set({ surfaceDepth })}
          />
          <Slider
            label={tr('Glass (transparency)')}
            value={p.glass}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(glass) => set({ glass })}
          />
          <Slider
            label={tr('Blur')}
            value={p.blur}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(blur) => set({ blur })}
          />
          <Slider
            label={tr('Glow')}
            value={p.glow}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(glow) => set({ glow })}
          />
          <Slider
            label={tr('Gradients')}
            value={p.gradient}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(gradient) => set({ gradient })}
          />
          <Slider
            label={tr('Shadows')}
            value={p.shadows}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(shadows) => set({ shadows })}
          />
          <Row label={tr('Pattern')}>
            <Choice
              value={p.pattern}
              onChange={(pattern) => set({ pattern })}
              options={[
                ['skin', tr('Skin')],
                ['none', tr('None')],
                ['grid', tr('Grid')],
                ['blueprint', tr('Blueprint')],
                ['dots', tr('Dots')],
                ['lines', tr('Lines')],
                ['scanlines', tr('Scanlines')],
                ['noise', tr('Grain')],
                ['stars', tr('Stars')],
                ['waves', tr('Waves')],
              ]}
            />
          </Row>
          <Slider
            label={tr('Pattern strength')}
            value={p.patternStrength}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(patternStrength) => set({ patternStrength })}
          />
          <p className="muted small">
            {tr(
              'Glass and blur cost graphics power: on a slow computer, set them to 0%. Text always keeps a readable contrast, whatever you choose here.',
            )}
          </p>
        </Group>
      )}
      {section === 'background' && <Background design={design} />}
      {section === 'motion' && <Motion design={design} />}
      {section === 'profiles' && <Profiles design={design} />}
      {section === 'general' && props.general}
    </div>
  );
}

/** Exports carry no pictures: no background picture, and a photo wallpaper becomes no wallpaper. */
function noPictures(prefs: DesignPrefs): DesignPrefs {
  const wallpaper = prefs.wallpaper ?? DEFAULT_DESIGN_PREFS.wallpaper;
  return {
    ...prefs,
    backgroundImage: null,
    wallpaper: wallpaper.photo ? { ...wallpaper, kind: 'none', photo: null } : wallpaper,
  };
}

function nameOf(design: DesignSettings): string {
  return (
    design.customThemes.find((c) => c.id === design.theme)?.name ??
    themeById(design.theme)?.name ??
    'Deep Current'
  );
}

/** "dark" or "light", to translate. */
function modeLabel(mode: 'dark' | 'light'): string {
  return mode === 'dark' ? msg('dark') : msg('light');
}

const ROLE_LABEL: Record<ColorRole, string> = {
  bg: msg('Frame and rail'),
  surface: msg('Sidebars'),
  base: msg('Conversation'),
  raised: msg('Cards and inputs'),
  text: msg('Text'),
  muted: msg('Secondary text'),
  accent: msg('Accent'),
  accent2: msg('Second accent'),
  selection: msg('Selection'),
  border: msg('Borders'),
  focus: msg('Focus outline'),
  ok: msg('Success'),
  warn: msg('Warning'),
  danger: msg('Error'),
  info: msg('Information'),
};

function Colors({ design }: { design: DesignSettings }): ReactElement {
  const r = resolveDesign(design);
  const [name, setName] = useState('');
  const colors = design.prefs.colors;
  const current: Record<ColorRole, string> = {
    bg: r.vars['--layer-0']!,
    surface: r.vars['--layer-1']!,
    base: r.vars['--layer-2']!,
    raised: r.vars['--layer-3']!,
    text: r.vars['--text']!,
    muted: r.vars['--text-faint']!,
    accent: r.vars['--accent']!,
    accent2: r.vars['--accent-2']!,
    selection: colors.selection ?? r.vars['--accent']!,
    border: colors.border ?? r.vars['--text']!,
    focus: r.vars['--focus']!,
    ok: r.vars['--ok']!,
    warn: r.vars['--warn']!,
    danger: r.vars['--danger']!,
    info: r.vars['--info']!,
  };
  const base = current.base;
  const checks: Array<[string, number, number]> = [
    [tr('Text on conversation'), contrast(current.text, base), 7],
    [tr('Secondary text'), contrast(current.muted, base), 4.5],
    [tr('Accent on conversation'), contrast(current.accent, base), 3],
    [tr('Text on buttons'), contrast(r.vars['--accent-solid-ink']!, current.accent), 4.5],
  ];
  const setColor = (role: ColorRole, value: string | null): void => {
    const next = { ...colors };
    if (value) next[role] = value;
    else delete next[role];
    setPrefs(design, { colors: next });
  };
  const saveAsTheme = (): void => {
    const label = name.trim() || tr('My {name}', { name: r.theme.name });
    const id = newId('custom');
    const baseId = THEMES.some((t) => t.id === design.theme)
      ? design.theme
      : (design.customThemes.find((c) => c.id === design.theme)?.base ?? r.theme.id);
    const merged = { ...(design.customThemes.find((c) => c.id === design.theme)?.colors ?? {}), ...colors };
    commitDesign({
      ...design,
      theme: id,
      customThemes: [
        ...design.customThemes,
        { id, name: label.slice(0, 48), base: baseId, colors: merged, createdAt: new Date().toISOString() },
      ],
      prefs: { ...design.prefs, colors: {} },
    });
    setName('');
    play('success');
    if (design.customThemes.length === 0) celebrate(tr('Your first theme ✨'));
  };
  const isCustom = design.customThemes.some((c) => c.id === design.theme);
  return (
    <div className="design-group">
      <h3 className="design-sub">{tr('Accent')}</h3>
      <AccentPicker design={design} />
      <h3 className="design-sub">{tr('Theme editor')}</h3>
      <Row label={tr('Start from')}>
        <select
          className="search design-start"
          aria-label={tr('Start from theme')}
          value={THEMES.some((t) => t.id === design.theme) ? design.theme : ''}
          onChange={(e) => e.target.value && applyTheme(design, e.target.value)}
        >
          {!THEMES.some((t) => t.id === design.theme) && <option value="">{nameOf(design)}</option>}
          {SKINS.map((skin) => (
            <optgroup key={skin.id} label={skin.name}>
              {THEMES.filter((t) => t.skin === skin.id).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({tr(modeLabel(t.mode))})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>
      <p className="muted small">
        {tr(
          'Change any colour of the current theme. River keeps text readable: if a colour would make text too faint, it is adjusted automatically (shown below).',
        )}
      </p>
      <div className="design-colors">
        {COLOR_ROLES.map((role) => (
          <label key={role} className={`design-color ${colors[role] ? 'is-set' : ''}`}>
            <input
              type="color"
              value={current[role].slice(0, 7)}
              aria-label={tr(ROLE_LABEL[role])}
              onChange={(e) => setColor(role, e.target.value)}
            />
            <span className="design-color__name">{tr(ROLE_LABEL[role])}</span>
            {colors[role] ? (
              <button className="btn btn--link btn--small" onClick={() => setColor(role, null)}>
                {tr('Reset')}
              </button>
            ) : (
              <span className="muted small">{tr('theme')}</span>
            )}
          </label>
        ))}
      </div>
      <div className="design-checks" aria-label={tr('Contrast checks')}>
        {checks.map(([label, ratio, need]) => (
          <span key={label} className={`design-check ${ratio >= need ? 'is-ok' : 'is-low'}`}>
            {ratio >= need ? '✓' : '!'} {label} {ratio.toFixed(1)}:1
          </span>
        ))}
      </div>
      <div className="design-actions">
        <button
          className="btn btn--ghost btn--small"
          disabled={Object.keys(colors).length === 0}
          onClick={() => setPrefs(design, { colors: {} })}
        >
          {tr('Reset all colours')}
        </button>
        <input
          className="search design-actions__name"
          placeholder={tr('My {name}', { name: r.theme.name })}
          aria-label={tr('Name for your theme')}
          maxLength={48}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn--primary btn--small" onClick={saveAsTheme}>
          {tr('Save as my theme')}
        </button>
      </div>
      <ThemeShare design={design} name={name.trim() || nameOf(design)} />
      {isCustom && (
        <div className="design-actions">
          <span className="muted small">
            {tr('“{name}” is one of your themes.', { name: nameOf(design) })}
          </span>
          <button
            className="btn btn--link btn--small"
            onClick={() => {
              const mine = design.customThemes.find((c) => c.id === design.theme);
              commitDesign({
                ...design,
                theme: mine?.base ?? DEFAULT_DESIGN.theme,
                customThemes: design.customThemes.filter((c) => c.id !== design.theme),
              });
            }}
          >
            {tr('Delete this theme')}
          </button>
        </div>
      )}
    </div>
  );
}

function Background({ design }: { design: DesignSettings }): ReactElement {
  const p = { ...DEFAULT_DESIGN_PREFS, ...design.prefs };
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<DesignPrefs>): void => setPrefs(design, patch);
  const pick = (f: File | undefined): void => {
    setError(null);
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setError(tr('Choose a PNG, JPEG or WebP picture.'));
    if (f.size > 2_000_000) return setError(tr('That picture is larger than 2 MB. Choose a smaller one.'));
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(url))
        return setError(tr('That picture could not be read.'));
      set({ background: 'image', backgroundImage: url });
    };
    reader.readAsDataURL(f);
  };
  return (
    <Group>
      <Row label={tr('Background')}>
        <Choice
          value={p.background}
          onChange={(background) => set({ background })}
          options={[
            ['skin', tr('Skin')],
            ['solid', tr('Solid')],
            ['gradient', tr('Gradient')],
            ['aurora', tr('Aurora')],
            ['mesh', tr('Mesh')],
            ['image', tr('My picture')],
          ]}
        />
      </Row>
      <div className="design-actions">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <button className="btn btn--ghost btn--small" onClick={() => file.current?.click()}>
          {tr('Choose a picture…')}
        </button>
        {p.backgroundImage && (
          <button
            className="btn btn--link btn--small"
            onClick={() => set({ backgroundImage: null, background: 'skin' })}
          >
            {tr('Remove picture')}
          </button>
        )}
        <span className="muted small">{tr('Stays on this computer. PNG, JPEG or WebP up to 2 MB.')}</span>
      </div>
      {error && <p className="field__error">{error}</p>}
      <Slider
        label={tr('Darken picture')}
        value={p.backgroundDim}
        min={0}
        max={1}
        step={0.05}
        format={pct}
        onChange={(backgroundDim) => set({ backgroundDim })}
      />
      <Slider
        label={tr('Blur background')}
        value={p.backgroundBlur}
        min={0}
        max={24}
        step={1}
        format={(v) => `${v}px`}
        onChange={(backgroundBlur) => set({ backgroundBlur })}
      />
      <Toggle
        label={tr('Slowly moving background')}
        help={tr('A gentle drift of the background colours. Off when motion is reduced.')}
        checked={p.animatedBackground}
        onChange={(animatedBackground) => set({ animatedBackground })}
      />
      <p className="muted small">
        {tr('The background shows around the panels; turn up Glass under Effects to see it behind them too.')}
      </p>
    </Group>
  );
}

function Motion({ design }: { design: DesignSettings }): ReactElement {
  const p = { ...DEFAULT_DESIGN_PREFS, ...design.prefs };
  const motion = useRiver((r) => r.settings?.appearance.motion ?? 'system');
  const calm = useRiver((r) => r.settings?.appearance.calm ?? false);
  const update = useRiver((r) => r.updateSettings);
  const set = (patch: Partial<DesignPrefs>): void => setPrefs(design, patch);
  return (
    <Group>
      <Row label={tr('Animations')}>
        <Choice
          value={motion}
          onChange={(m) => void update({ appearance: { motion: m } })}
          options={[
            ['system', tr('Follow system')],
            ['full', tr('Full')],
            ['reduced', tr('Reduced')],
          ]}
        />
      </Row>
      <Toggle
        label={tr('Calm mode')}
        help={tr(
          'No confetti, reaction bursts or bouncing: messages and reactions simply appear. Phones still give a small buzz.',
        )}
        checked={calm}
        onChange={(on) => void update({ appearance: { calm: on } })}
      />
      <Slider
        label={tr('Animation speed')}
        value={p.motionSpeed}
        min={0.5}
        max={2}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={(motionSpeed) => set({ motionSpeed })}
      />
      <Toggle
        label={tr('Highlight on hover')}
        help={tr('Rows and messages light up under the pointer.')}
        checked={p.hoverEffects}
        onChange={(hoverEffects) => set({ hoverEffects })}
      />
      <Toggle
        label={tr('Ambient effects')}
        help={tr('Allows the moving background (Background → Slowly moving background).')}
        checked={p.ambient}
        onChange={(ambient) => set({ ambient })}
      />
      <p className="muted small">
        {tr('Reduced motion turns off every non-essential animation, whatever the skin.')}
      </p>
    </Group>
  );
}

/** One-click starting points for common workflows. */
const STARTERS: Array<{ name: string; theme: string; prefs: Partial<DesignPrefs>; text: string }> = [
  { name: msg('Daily work'), theme: 'specter-specter', prefs: {}, text: msg('River’s signature look.') },
  {
    name: msg('Deep focus'),
    theme: 'specter-void',
    prefs: { focusMode: true, memberList: 'hide', chatWidth: 'readable', glow: 0 },
    text: msg('Quiet graphite, no rail or member list.'),
  },
  {
    name: msg('Night session'),
    theme: 'specter-ember',
    prefs: { saturation: 0.8, glow: 0.5, intensity: 0.8 },
    text: msg('Warm and low-key for late hours.'),
  },
  {
    name: msg('Office'),
    theme: 'corporate-professional-light',
    prefs: { messageStyle: 'flat' },
    text: msg('Bright, neutral, business-like.'),
  },
  {
    name: msg('Presentation'),
    theme: 'corporate-enterprise-blue',
    prefs: { spacing: 1.25, contrast: 1.2, iconSize: 22 },
    text: msg('Large spacing and strong contrast for sharing your screen.'),
  },
  {
    name: msg('High contrast'),
    theme: 'retro-contrast',
    prefs: { contrast: 1.4 },
    text: msg('Maximum legibility.'),
  },
  {
    name: msg('Night city'),
    theme: 'neon-cyber',
    prefs: { glow: 1.3, pattern: 'scanlines' },
    text: msg('Full cyberpunk, all lights on.'),
  },
];

function Profiles({ design }: { design: DesignSettings }): ReactElement {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [io, setIo] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const snapshot = (label: string): DesignProfile => ({
    id: newId('profile'),
    name: label.slice(0, 48),
    skin: design.skin,
    theme: design.theme,
    prefs: design.prefs,
  });
  const apply = (profile: DesignProfile): void =>
    commitDesign({
      ...design,
      skin: profile.skin,
      theme: profile.theme,
      prefs: profile.prefs,
      activeProfile: profile.id,
    });
  const exportJson = (): void => {
    const data = {
      kind: 'river-appearance',
      version: 1,
      skin: design.skin,
      theme: design.theme,
      prefs: noPictures(design.prefs),
      customThemes: design.customThemes,
      profiles: design.profiles.map((x) => ({ ...x, prefs: noPictures(x.prefs) })),
    };
    const text = JSON.stringify(data);
    setIo(text);
    void navigator.clipboard
      .writeText(text)
      .then(() => setMessage(tr('Copied. Paste it anywhere to keep or share it.')));
  };
  const importJson = (): void => {
    setMessage(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(io);
    } catch {
      return setMessage(tr('That is not an appearance export (not valid JSON).'));
    }
    const result = designExportSchema.safeParse(parsed);
    if (!result.success)
      return setMessage(tr('That file is not a River appearance export, or it is damaged. Nothing changed.'));
    const d = result.data;
    const known = (id: string): boolean =>
      THEMES.some((t) => t.id === id) ||
      d.customThemes.some((c) => c.id === id) ||
      design.customThemes.some((c) => c.id === id);
    const customThemes = [
      ...design.customThemes,
      ...d.customThemes.filter((c) => !design.customThemes.some((m) => m.id === c.id)),
    ].slice(0, 100);
    const profiles = [
      ...design.profiles,
      ...d.profiles.filter((x) => !design.profiles.some((m) => m.id === x.id)),
    ].slice(0, 30);
    commitDesign({
      ...design,
      skin: d.skin,
      theme: known(d.theme) ? d.theme : DEFAULT_DESIGN.theme,
      prefs: d.prefs,
      customThemes,
      profiles,
      activeProfile: null,
    });
    setMessage(tr('Imported. Your existing themes and profiles were kept.'));
    play('success');
  };
  return (
    <div className="design-group">
      <h3 className="design-sub">{tr('Your profiles')}</h3>
      <p className="muted small">
        {tr(
          'A profile saves everything about how River looks — theme, colours, type, layout and effects — so you can switch between them in one click.',
        )}
      </p>
      <div className="design-actions">
        <input
          className="search design-actions__name"
          placeholder={tr('e.g. Night session')}
          aria-label={tr('Profile name')}
          maxLength={48}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn btn--primary btn--small"
          disabled={design.profiles.length >= 30}
          onClick={() => {
            const profile = snapshot(
              name.trim() || tr('Profile {count}', { count: design.profiles.length + 1 }),
            );
            commitDesign({ ...design, profiles: [...design.profiles, profile], activeProfile: profile.id });
            setName('');
            play('success');
          }}
        >
          {tr('Save current look')}
        </button>
      </div>
      {design.profiles.length === 0 ? (
        <p className="muted small">{tr('No profiles yet.')}</p>
      ) : (
        <ul className="design-profiles">
          {design.profiles.map((profile) => (
            <li key={profile.id} className={design.activeProfile === profile.id ? 'is-active' : ''}>
              <span className="design-profiles__swatch">
                <ThemePreview
                  themeId={profile.theme}
                  design={{ ...design, prefs: profile.prefs }}
                  withPrefs
                />
              </span>
              {renaming?.id === profile.id ? (
                <input
                  className="search"
                  autoFocus
                  maxLength={48}
                  aria-label={tr('New name')}
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: profile.id, name: e.target.value })}
                  data-own-escape=""
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renaming.name.trim()) {
                      commitDesign({
                        ...design,
                        profiles: design.profiles.map((x) =>
                          x.id === profile.id ? { ...x, name: renaming.name.trim().slice(0, 48) } : x,
                        ),
                      });
                      setRenaming(null);
                    }
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <strong>{profile.name}</strong>
              )}
              <span className="muted small">{themeById(profile.theme)?.name ?? tr('Custom theme')}</span>
              <span className="design-profiles__actions">
                <button className="btn btn--primary btn--small" onClick={() => apply(profile)}>
                  {design.activeProfile === profile.id ? tr('In use') : tr('Use')}
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  title={tr('Save the current look into this profile')}
                  onClick={() =>
                    commitDesign({
                      ...design,
                      profiles: design.profiles.map((x) =>
                        x.id === profile.id
                          ? { ...x, skin: design.skin, theme: design.theme, prefs: design.prefs }
                          : x,
                      ),
                      activeProfile: profile.id,
                    })
                  }
                >
                  {tr('Update')}
                </button>
                <button
                  className="btn btn--link btn--small"
                  onClick={() => setRenaming({ id: profile.id, name: profile.name })}
                >
                  {tr('Rename')}
                </button>
                <button
                  className="btn btn--link btn--small"
                  onClick={() =>
                    commitDesign({
                      ...design,
                      profiles: design.profiles.filter((x) => x.id !== profile.id),
                      activeProfile: design.activeProfile === profile.id ? null : design.activeProfile,
                    })
                  }
                >
                  {tr('Delete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="design-sub">{tr('Starting points')}</h3>
      <div className="design-starters">
        {STARTERS.map((s) => (
          <button
            key={s.name}
            className="design-starter"
            onClick={() =>
              commitDesign({
                ...design,
                theme: s.theme,
                skin: themeById(s.theme)?.skin ?? design.skin,
                prefs: { ...DEFAULT_DESIGN_PREFS, ...s.prefs },
                activeProfile: null,
              })
            }
          >
            <ThemePreview
              themeId={s.theme}
              design={{ ...design, prefs: { ...DEFAULT_DESIGN_PREFS, ...s.prefs } }}
              withPrefs
            />
            <strong>{tr(s.name)}</strong>
            <span className="muted small">{tr(s.text)}</span>
          </button>
        ))}
      </div>

      <h3 className="design-sub">{tr('Import and export')}</h3>
      <p className="muted small">
        {tr(
          'Export copies your theme, colours, layout, your own themes and profiles as text (without a background picture). Paste such text below to import it — nothing in it can run code.',
        )}
      </p>
      <textarea
        className="design-io"
        aria-label={tr('Appearance export')}
        placeholder='{"kind":"river-appearance", …}'
        value={io}
        onChange={(e) => setIo(e.target.value)}
        spellCheck={false}
      />
      <div className="design-actions">
        <button className="btn btn--ghost btn--small" onClick={exportJson}>
          {tr('Export (copy)')}
        </button>
        <button className="btn btn--ghost btn--small" disabled={!io.trim()} onClick={importJson}>
          {tr('Import')}
        </button>
        {message && <span className="small">{message}</span>}
      </div>

      <h3 className="design-sub">{tr('Reset')}</h3>
      <div className="design-actions">
        <button className="btn btn--ghost btn--small" onClick={() => setPrefs(design, DEFAULT_DESIGN_PREFS)}>
          {tr('Reset adjustments (keep theme)')}
        </button>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => applyTheme({ ...design, prefs: DEFAULT_DESIGN_PREFS }, DEFAULT_DESIGN.theme)}
        >
          {tr('Back to Specter’s default look')}
        </button>
      </div>
      <p className="muted small">{tr('Resetting keeps your own themes and profiles.')}</p>
    </div>
  );
}

/** Theme codes: copy the theme in use as a short code, or paste one someone shared. */
function ThemeShare({ design, name }: { design: DesignSettings; name: string }): ReactElement {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const copy = (): void => {
    const text = themeCode(design, name);
    setCode(text);
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setMessage(tr('Theme code copied. Send it to anyone with River.')))
      .catch(() => setMessage(tr('Select the code above and copy it.')));
  };
  const add = (): void => {
    const result = parseThemeCode(code);
    if (!result.ok) return setMessage(tr(result.error));
    const { design: next, theme } = addSharedTheme(
      design,
      result.theme,
      newId('custom'),
      new Date().toISOString(),
    );
    commitDesign(next);
    setCode('');
    setMessage(tr('Added “{name}” to your themes and switched to it.', { name: theme.name }));
    play('success');
  };
  return (
    <>
      <h3 className="design-sub">{tr('Share a theme')}</h3>
      <p className="muted small">
        {tr(
          'A theme code is the theme’s name and colours as a short line of text. Paste one here to add it — River checks every colour, and nothing in a code can run.',
        )}
      </p>
      <textarea
        className="design-io design-io--code"
        aria-label={tr('Theme code')}
        placeholder="river-theme:…"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setMessage(null);
        }}
        spellCheck={false}
      />
      <div className="design-actions">
        <button className="btn btn--ghost btn--small" onClick={copy}>
          {tr('Copy theme code')}
        </button>
        <button className="btn btn--ghost btn--small" disabled={!code.trim()} onClick={add}>
          {tr('Add pasted theme')}
        </button>
        {message && (
          <span className="small" role="status">
            {message}
          </span>
        )}
      </div>
    </>
  );
}

/** Chat (2.18): the wallpaper behind every chat, bubble shape, text size and density. */
function ChatLook({ design }: { design: DesignSettings }): ReactElement {
  const p = { ...DEFAULT_DESIGN_PREFS, ...design.prefs };
  const appearance = useRiver((r) => r.settings?.appearance);
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const update = useRiver((r) => r.updateSettings);
  const colors = useMemo(() => {
    const r = resolveDesign(design);
    return colorsOf(r.vars, r.mode);
  }, [design]);
  const own = Object.keys(design.chatWallpapers ?? {}).length;
  const fontSize = appearance?.fontSize ?? 14;
  return (
    <Group>
      <h3 className="design-sub">{tr('Wallpaper')}</h3>
      <p className="muted small">
        {tr(
          'Behind the messages of every conversation and channel. A chat can have its own: open the chat’s menu and choose Wallpaper. Wallpapers stay on this device (they are not copied to your other devices).',
        )}
      </p>
      <WallpaperPicker
        value={p.wallpaper}
        colors={colors}
        design={design}
        onChange={(wallpaper) => setPrefs(design, { wallpaper })}
        photosLeft={MAX_WALLPAPER_PHOTOS - chatPhotoCount(design.chatWallpapers ?? {})}
      />
      {own > 0 && (
        <div className="design-actions">
          <span className="muted small">{trn('{count} chats have wallpapers of their own.', own)}</span>
          <button
            className="btn btn--link btn--small"
            onClick={() => commitDesign({ ...design, chatWallpapers: {} })}
          >
            {tr('Use this wallpaper everywhere')}
          </button>
        </div>
      )}
      <h3 className="design-sub">{tr('Bubbles')}</h3>
      <Row label={tr('Bubble shape')}>
        <Choice
          label={tr('Bubble shape')}
          value={p.bubbles}
          onChange={(bubbles) => setPrefs(design, { bubbles })}
          options={[
            ['rounded', tr('Rounded')],
            ['square', tr('Square-ish')],
            ['outlined', tr('Outlined')],
          ]}
        />
      </Row>
      {!phone && (
        <Row label={tr('Message style')}>
          <Choice
            label={tr('Message style')}
            value={p.messageStyle}
            onChange={(messageStyle) => setPrefs(design, { messageStyle })}
            options={[
              ['skin', tr('Skin')],
              ['flat', tr('Classic')],
              ['bubbles', tr('Bubbles')],
              ['cards', tr('Cards')],
              ['compact', tr('Compact')],
              ['terminal', tr('Terminal')],
            ]}
          />
        </Row>
      )}
      {!phone && (
        <p className="muted small">
          {tr('On computers, bubble shapes show with the Bubbles message style.')}
        </p>
      )}
      <h3 className="design-sub">{tr('Text and spacing')}</h3>
      <label className="design-slider">
        <span className="design-row__label">
          {tr('Chat text size')} <span className="muted small">{phone ? fontSize + 2 : fontSize}px</span>
        </span>
        <input
          type="range"
          min={12}
          max={22}
          step={1}
          value={fontSize}
          aria-label={tr('Chat text size')}
          onChange={(e) => void update({ appearance: { fontSize: Number(e.target.value) } })}
        />
      </label>
      {!phone && (
        <Row label={tr('Density')}>
          <Choice
            label={tr('Density')}
            value={appearance?.density ?? 'cozy'}
            onChange={(density) => void update({ appearance: { density } })}
            options={[
              ['cozy', tr('Cozy')],
              ['compact', tr('Compact')],
            ]}
          />
        </Row>
      )}
      <p className="muted small">{tr('The sample chat at the top shows every change at once.')}</p>
    </Group>
  );
}

export type { Settings };
