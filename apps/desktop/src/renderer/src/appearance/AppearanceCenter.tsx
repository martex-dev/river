import { useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  COLOR_ROLES,
  DEFAULT_DESIGN,
  DEFAULT_DESIGN_PREFS,
  designExportSchema,
  type ColorRole,
  type DesignPrefs,
  type DesignProfile,
  type DesignSettings,
} from '../../../shared/design.ts';
import type { Settings } from '../../../shared/settings.ts';
import { Toggle } from '../community/ui/common.tsx';
import { play } from '../community/sound.ts';
import { useRiver } from '../store.ts';
import { contrast } from './color.ts';
import { applyTheme, commitDesign, newId, setPrefs, useEditedDesign } from './editor.ts';
import { resolveDesign } from './engine.ts';
import { THEMES, themeById } from './themes.ts';
import { ThemeBrowser, ThemePreview } from './ThemeBrowser.tsx';

const SECTIONS = [
  ['themes', 'Themes'],
  ['colors', 'Colours'],
  ['type', 'Typography'],
  ['layout', 'Layout'],
  ['components', 'Components'],
  ['effects', 'Effects'],
  ['background', 'Background'],
  ['motion', 'Motion'],
  ['profiles', 'Profiles'],
  ['general', 'General'],
] as const;
type Section = (typeof SECTIONS)[number][0];

/**
 * The appearance and personalisation centre (1.0.45): skins and themes, colours,
 * type, layout, components, effects, background, motion and saved profiles.
 * Every control changes the live app immediately and is saved automatically.
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
          <ThemePreview themeId={resolved.theme.id} design={design} withPrefs />
          <div>
            <div className="eyebrow">Now using</div>
            <h2 className="panel__title">{nameOf(design)}</h2>
            <p className="muted small">
              {resolved.skin.name} skin · {resolved.theme.mode} ·{' '}
              {design.activeProfile
                ? `profile “${design.profiles.find((x) => x.id === design.activeProfile)?.name ?? ''}”`
                : 'your settings'}
            </p>
          </div>
        </div>
        <nav className="design__tabs" role="tablist" aria-label="Appearance sections">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={section === id}
              className={`design__tab ${section === id ? 'is-active' : ''}`}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {section === 'themes' && <ThemeBrowser design={design} />}
      {section === 'colors' && <Colors design={design} />}
      {section === 'type' && (
        <Group>
          <Row label="Interface font">
            <Choice
              value={p.uiFont}
              onChange={(uiFont) => set({ uiFont })}
              options={[
                ['skin', 'Skin'],
                ['inter', 'Inter'],
                ['manrope', 'Manrope'],
                ['plex', 'IBM Plex'],
                ['exo', 'Exo 2'],
                ['grotesk', 'Space Grotesk'],
                ['hyperlegible', 'Hyperlegible'],
                ['mono', 'Monospace'],
              ]}
            />
          </Row>
          <Row label="Heading font">
            <Choice
              value={p.displayFont}
              onChange={(displayFont) => set({ displayFont })}
              options={[
                ['skin', 'Skin'],
                ['same', 'Same as text'],
                ['grotesk', 'Space Grotesk'],
                ['orbitron', 'Orbitron'],
                ['playfair', 'Playfair'],
                ['exo', 'Exo 2'],
                ['plex', 'IBM Plex'],
                ['vt323', 'VT323'],
              ]}
            />
          </Row>
          <Row label="Code font">
            <Choice
              value={p.monoFont}
              onChange={(monoFont) => set({ monoFont })}
              options={[
                ['skin', 'Skin'],
                ['jetbrains', 'JetBrains Mono'],
                ['fira', 'Fira Code'],
                ['plex-mono', 'IBM Plex Mono'],
                ['vt323', 'VT323'],
              ]}
            />
          </Row>
          <Row label="Headings">
            <Choice
              value={p.headings}
              onChange={(headings) => set({ headings })}
              options={[
                ['skin', 'Skin'],
                ['normal', 'Normal'],
                ['uppercase', 'Uppercase'],
                ['display', 'Display font'],
              ]}
            />
          </Row>
          <Slider
            label="Text weight"
            value={p.textWeight}
            min={300}
            max={600}
            step={50}
            onChange={(textWeight) => set({ textWeight })}
          />
          <Slider
            label="Line height"
            value={p.lineHeight}
            min={1.2}
            max={1.9}
            step={0.05}
            onChange={(lineHeight) => set({ lineHeight })}
          />
          <Slider
            label="Letter spacing"
            value={p.letterSpacing}
            min={-0.03}
            max={0.08}
            step={0.005}
            format={(v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`}
            onChange={(letterSpacing) => set({ letterSpacing })}
          />
          <Toggle
            label="Table numbers"
            help="Digits of equal width, so times and counts line up."
            checked={p.tabularNumbers}
            onChange={(tabularNumbers) => set({ tabularNumbers })}
          />
          <p className="muted small">Message text size and the interface size are under General.</p>
        </Group>
      )}
      {section === 'layout' && (
        <Group>
          <Row label="Messages look like">
            <Choice
              value={p.messageStyle}
              onChange={(messageStyle) => set({ messageStyle })}
              options={[
                ['skin', 'Skin'],
                ['flat', 'Classic'],
                ['bubbles', 'Bubbles'],
                ['cards', 'Cards'],
                ['compact', 'Compact'],
                ['terminal', 'Terminal'],
              ]}
            />
          </Row>
          <Row label="Your messages (bubbles)">
            <Choice
              value={p.ownMessages}
              onChange={(ownMessages) => set({ ownMessages })}
              options={[
                ['right', 'On the right'],
                ['left', 'On the left'],
              ]}
            />
          </Row>
          <Row label="Pictures">
            <Choice
              value={p.avatarShape}
              onChange={(avatarShape) => set({ avatarShape })}
              options={[
                ['skin', 'Skin'],
                ['circle', 'Circle'],
                ['rounded', 'Rounded'],
                ['square', 'Square'],
                ['hexagon', 'Hexagon'],
              ]}
            />
          </Row>
          <Row label="Navigation side">
            <Choice
              value={p.navSide}
              onChange={(navSide) => set({ navSide })}
              options={[
                ['left', 'Left'],
                ['right', 'Right'],
              ]}
            />
          </Row>
          <Row label="Community rail">
            <Choice
              value={p.railSize}
              onChange={(railSize) => set({ railSize })}
              options={[
                ['normal', 'Normal'],
                ['compact', 'Compact'],
              ]}
            />
          </Row>
          <Slider
            label="Sidebar width"
            value={p.sidebarWidth}
            min={200}
            max={340}
            step={10}
            format={(v) => `${v}px`}
            onChange={(sidebarWidth) => set({ sidebarWidth })}
          />
          <Row label="Member list">
            <Choice
              value={p.memberList}
              onChange={(memberList) => set({ memberList })}
              options={[
                ['show', 'Show'],
                ['hide', 'Hide'],
              ]}
            />
          </Row>
          <Slider
            label="Member list width"
            value={p.memberWidth}
            min={180}
            max={320}
            step={10}
            format={(v) => `${v}px`}
            onChange={(memberWidth) => set({ memberWidth })}
          />
          <Row label="Conversation width">
            <Choice
              value={p.chatWidth}
              onChange={(chatWidth) => set({ chatWidth })}
              options={[
                ['full', 'Full'],
                ['readable', 'Readable column'],
              ]}
            />
          </Row>
          <Slider
            label="Spacing"
            value={p.spacing}
            min={0.7}
            max={1.4}
            step={0.05}
            format={pct}
            onChange={(spacing) => set({ spacing })}
          />
          <Row label="Title bar">
            <Choice
              value={p.titlebar}
              onChange={(titlebar) => set({ titlebar })}
              options={[
                ['show', 'Name and place'],
                ['minimal', 'Minimal'],
              ]}
            />
          </Row>
          <Toggle
            label="Focus mode"
            help="Hides the community rail and member list: just channels and the conversation."
            checked={p.focusMode}
            onChange={(focusMode) => set({ focusMode })}
          />
        </Group>
      )}
      {section === 'components' && (
        <Group>
          <Row label="Buttons">
            <Choice
              value={p.buttonShape}
              onChange={(buttonShape) => set({ buttonShape })}
              options={[
                ['skin', 'Skin'],
                ['pill', 'Pill'],
                ['rounded', 'Rounded'],
                ['square', 'Square'],
                ['cut', 'Cut corners'],
              ]}
            />
          </Row>
          <Row label="Tabs">
            <Choice
              value={p.tabs}
              onChange={(tabs) => set({ tabs })}
              options={[
                ['skin', 'Skin'],
                ['pill', 'Pill'],
                ['underline', 'Underline'],
                ['block', 'Block'],
              ]}
            />
          </Row>
          <Row label="Unread badges">
            <Choice
              value={p.badges}
              onChange={(badges) => set({ badges })}
              options={[
                ['filled', 'Filled'],
                ['outline', 'Outline'],
                ['dot', 'Dot'],
              ]}
            />
          </Row>
          <Row label="Scrollbars">
            <Choice
              value={p.scrollbars}
              onChange={(scrollbars) => set({ scrollbars })}
              options={[
                ['thin', 'Thin'],
                ['normal', 'Normal'],
                ['hidden', 'Hidden'],
              ]}
            />
          </Row>
          <Slider
            label="Corner rounding"
            value={p.radius}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(radius) => set({ radius })}
          />
          <Slider
            label="Border thickness"
            value={p.borderWidth}
            min={0}
            max={2}
            step={0.25}
            format={pct}
            onChange={(borderWidth) => set({ borderWidth })}
          />
          <Slider
            label="Border visibility"
            value={p.borders}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(borders) => set({ borders })}
          />
          <Slider
            label="Icon size"
            value={p.iconSize}
            min={16}
            max={26}
            step={1}
            format={(v) => `${v}px`}
            onChange={(iconSize) => set({ iconSize })}
          />
          <Slider
            label="Icon stroke"
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
            label="Overall intensity"
            value={p.intensity}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(intensity) => set({ intensity })}
          />
          <Slider
            label="Contrast"
            value={p.contrast}
            min={0.8}
            max={1.5}
            step={0.05}
            format={pct}
            onChange={(contrast) => set({ contrast })}
          />
          <Slider
            label="Colour saturation"
            value={p.saturation}
            min={0}
            max={1.5}
            step={0.05}
            format={pct}
            onChange={(saturation) => set({ saturation })}
          />
          <Slider
            label="Surface depth"
            value={p.surfaceDepth}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(surfaceDepth) => set({ surfaceDepth })}
          />
          <Slider
            label="Glass (transparency)"
            value={p.glass}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(glass) => set({ glass })}
          />
          <Slider
            label="Blur"
            value={p.blur}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(blur) => set({ blur })}
          />
          <Slider
            label="Glow"
            value={p.glow}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(glow) => set({ glow })}
          />
          <Slider
            label="Gradients"
            value={p.gradient}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(gradient) => set({ gradient })}
          />
          <Slider
            label="Shadows"
            value={p.shadows}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(shadows) => set({ shadows })}
          />
          <Row label="Pattern">
            <Choice
              value={p.pattern}
              onChange={(pattern) => set({ pattern })}
              options={[
                ['skin', 'Skin'],
                ['none', 'None'],
                ['grid', 'Grid'],
                ['blueprint', 'Blueprint'],
                ['dots', 'Dots'],
                ['lines', 'Lines'],
                ['scanlines', 'Scanlines'],
                ['noise', 'Grain'],
                ['stars', 'Stars'],
                ['waves', 'Waves'],
              ]}
            />
          </Row>
          <Slider
            label="Pattern strength"
            value={p.patternStrength}
            min={0}
            max={2}
            step={0.1}
            format={pct}
            onChange={(patternStrength) => set({ patternStrength })}
          />
          <p className="muted small">
            Glass and blur cost graphics power: on a slow computer, set them to 0%. Text always keeps a
            readable contrast, whatever you choose here.
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

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function nameOf(design: DesignSettings): string {
  return (
    design.customThemes.find((c) => c.id === design.theme)?.name ??
    themeById(design.theme)?.name ??
    'Deep Current'
  );
}

function Group(props: { children: ReactNode }): ReactElement {
  return <div className="design-group">{props.children}</div>;
}

function Row(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="design-row">
      <span className="design-row__label">{props.label}</span>
      {props.children}
    </div>
  );
}

function Choice<T extends string>(props: {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange(v: T): void;
}): ReactElement {
  return (
    <div className="seg seg--wrap" role="radiogroup">
      {props.options.map(([id, label]) => (
        <button
          key={id}
          role="radio"
          aria-checked={props.value === id}
          className={`seg__item ${props.value === id ? 'is-active' : ''}`}
          onClick={() => props.onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange(v: number): void;
}): ReactElement {
  return (
    <label className="design-slider">
      <span className="design-row__label">
        {props.label}{' '}
        <span className="muted small">{props.format ? props.format(props.value) : props.value}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-label={props.label}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

const ROLE_LABEL: Record<ColorRole, string> = {
  bg: 'Frame and rail',
  surface: 'Sidebars',
  base: 'Conversation',
  raised: 'Cards and inputs',
  text: 'Text',
  muted: 'Secondary text',
  accent: 'Accent',
  accent2: 'Second accent',
  selection: 'Selection',
  border: 'Borders',
  focus: 'Focus outline',
  ok: 'Success',
  warn: 'Warning',
  danger: 'Error',
  info: 'Information',
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
    ['Text on conversation', contrast(current.text, base), 7],
    ['Secondary text', contrast(current.muted, base), 4.5],
    ['Accent on conversation', contrast(current.accent, base), 3],
    ['Text on buttons', contrast(r.vars['--accent-solid-ink']!, current.accent), 4.5],
  ];
  const setColor = (role: ColorRole, value: string | null): void => {
    const next = { ...colors };
    if (value) next[role] = value;
    else delete next[role];
    setPrefs(design, { colors: next });
  };
  const saveAsTheme = (): void => {
    const label = name.trim() || `My ${r.theme.name}`;
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
  };
  const isCustom = design.customThemes.some((c) => c.id === design.theme);
  return (
    <div className="design-group">
      <p className="muted small">
        Change any colour of the current theme. River keeps text readable: if a colour would make text too
        faint, it is adjusted automatically (shown below).
      </p>
      <div className="design-colors">
        {COLOR_ROLES.map((role) => (
          <label key={role} className={`design-color ${colors[role] ? 'is-set' : ''}`}>
            <input
              type="color"
              value={current[role].slice(0, 7)}
              aria-label={ROLE_LABEL[role]}
              onChange={(e) => setColor(role, e.target.value)}
            />
            <span className="design-color__name">{ROLE_LABEL[role]}</span>
            {colors[role] ? (
              <button className="btn btn--link btn--small" onClick={() => setColor(role, null)}>
                Reset
              </button>
            ) : (
              <span className="muted small">theme</span>
            )}
          </label>
        ))}
      </div>
      <div className="design-checks" aria-label="Contrast checks">
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
          Reset all colours
        </button>
        <input
          className="search design-actions__name"
          placeholder={`My ${r.theme.name}`}
          aria-label="Name for your theme"
          maxLength={48}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn--primary btn--small" onClick={saveAsTheme}>
          Save as my theme
        </button>
      </div>
      {isCustom && (
        <div className="design-actions">
          <span className="muted small">“{nameOf(design)}” is one of your themes.</span>
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
            Delete this theme
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
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setError('Choose a PNG, JPEG or WebP picture.');
    if (f.size > 2_000_000) return setError('That picture is larger than 2 MB. Choose a smaller one.');
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(url))
        return setError('That picture could not be read.');
      set({ background: 'image', backgroundImage: url });
    };
    reader.readAsDataURL(f);
  };
  return (
    <Group>
      <Row label="Background">
        <Choice
          value={p.background}
          onChange={(background) => set({ background })}
          options={[
            ['skin', 'Skin'],
            ['solid', 'Solid'],
            ['gradient', 'Gradient'],
            ['aurora', 'Aurora'],
            ['mesh', 'Mesh'],
            ['image', 'My picture'],
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
          Choose a picture…
        </button>
        {p.backgroundImage && (
          <button
            className="btn btn--link btn--small"
            onClick={() => set({ backgroundImage: null, background: 'skin' })}
          >
            Remove picture
          </button>
        )}
        <span className="muted small">Stays on this computer. PNG, JPEG or WebP up to 2 MB.</span>
      </div>
      {error && <p className="field__error">{error}</p>}
      <Slider
        label="Darken picture"
        value={p.backgroundDim}
        min={0}
        max={1}
        step={0.05}
        format={pct}
        onChange={(backgroundDim) => set({ backgroundDim })}
      />
      <Slider
        label="Blur background"
        value={p.backgroundBlur}
        min={0}
        max={24}
        step={1}
        format={(v) => `${v}px`}
        onChange={(backgroundBlur) => set({ backgroundBlur })}
      />
      <Toggle
        label="Slowly moving background"
        help="A gentle drift of the background colours. Off when motion is reduced."
        checked={p.animatedBackground}
        onChange={(animatedBackground) => set({ animatedBackground })}
      />
      <p className="muted small">
        The background shows around the panels; turn up Glass under Effects to see it behind them too.
      </p>
    </Group>
  );
}

function Motion({ design }: { design: DesignSettings }): ReactElement {
  const p = { ...DEFAULT_DESIGN_PREFS, ...design.prefs };
  const motion = useRiver((r) => r.settings?.appearance.motion ?? 'system');
  const update = useRiver((r) => r.updateSettings);
  const set = (patch: Partial<DesignPrefs>): void => setPrefs(design, patch);
  return (
    <Group>
      <Row label="Animations">
        <Choice
          value={motion}
          onChange={(m) => void update({ appearance: { motion: m } })}
          options={[
            ['system', 'Follow system'],
            ['full', 'Full'],
            ['reduced', 'Reduced'],
          ]}
        />
      </Row>
      <Slider
        label="Animation speed"
        value={p.motionSpeed}
        min={0.5}
        max={2}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={(motionSpeed) => set({ motionSpeed })}
      />
      <Toggle
        label="Highlight on hover"
        help="Rows and messages light up under the pointer."
        checked={p.hoverEffects}
        onChange={(hoverEffects) => set({ hoverEffects })}
      />
      <Toggle
        label="Ambient effects"
        help="Allows the moving background (Background → Slowly moving background)."
        checked={p.ambient}
        onChange={(ambient) => set({ ambient })}
      />
      <p className="muted small">
        Reduced motion turns off every non-essential animation, whatever the skin.
      </p>
    </Group>
  );
}

/** One-click starting points for common workflows. */
const STARTERS: Array<{ name: string; theme: string; prefs: Partial<DesignPrefs>; text: string }> = [
  { name: 'Daily work', theme: 'river-current', prefs: {}, text: 'River’s signature look.' },
  {
    name: 'Deep focus',
    theme: 'minimal-graphite',
    prefs: { focusMode: true, memberList: 'hide', chatWidth: 'readable', glow: 0 },
    text: 'Quiet graphite, no rail or member list.',
  },
  {
    name: 'Night session',
    theme: 'river-riverbed',
    prefs: { saturation: 0.8, glow: 0.5, intensity: 0.8 },
    text: 'Warm and low-key for late hours.',
  },
  {
    name: 'Office',
    theme: 'corporate-professional-light',
    prefs: { messageStyle: 'flat' },
    text: 'Bright, neutral, business-like.',
  },
  {
    name: 'Presentation',
    theme: 'corporate-enterprise-blue',
    prefs: { spacing: 1.25, contrast: 1.2, iconSize: 22 },
    text: 'Large spacing and strong contrast for sharing your screen.',
  },
  {
    name: 'High contrast',
    theme: 'accessible-high-contrast-dark',
    prefs: { contrast: 1.4 },
    text: 'Maximum legibility.',
  },
  {
    name: 'Night city',
    theme: 'cyberpunk-neon-district',
    prefs: { glow: 1.3, pattern: 'scanlines' },
    text: 'Full cyberpunk, all lights on.',
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
      prefs: { ...design.prefs, backgroundImage: null },
      customThemes: design.customThemes,
      profiles: design.profiles.map((x) => ({ ...x, prefs: { ...x.prefs, backgroundImage: null } })),
    };
    const text = JSON.stringify(data);
    setIo(text);
    void navigator.clipboard
      .writeText(text)
      .then(() => setMessage('Copied. Paste it anywhere to keep or share it.'));
  };
  const importJson = (): void => {
    setMessage(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(io);
    } catch {
      return setMessage('That is not an appearance export (not valid JSON).');
    }
    const result = designExportSchema.safeParse(parsed);
    if (!result.success)
      return setMessage('That file is not a River appearance export, or it is damaged. Nothing changed.');
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
    setMessage('Imported. Your existing themes and profiles were kept.');
    play('success');
  };
  return (
    <div className="design-group">
      <h3 className="design-sub">Your profiles</h3>
      <p className="muted small">
        A profile saves everything about how River looks — theme, colours, type, layout and effects — so you
        can switch between them in one click.
      </p>
      <div className="design-actions">
        <input
          className="search design-actions__name"
          placeholder="e.g. Night session"
          aria-label="Profile name"
          maxLength={48}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="btn btn--primary btn--small"
          disabled={design.profiles.length >= 30}
          onClick={() => {
            const profile = snapshot(name.trim() || `Profile ${design.profiles.length + 1}`);
            commitDesign({ ...design, profiles: [...design.profiles, profile], activeProfile: profile.id });
            setName('');
            play('success');
          }}
        >
          Save current look
        </button>
      </div>
      {design.profiles.length === 0 ? (
        <p className="muted small">No profiles yet.</p>
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
                  aria-label="New name"
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: profile.id, name: e.target.value })}
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
              <span className="muted small">{themeById(profile.theme)?.name ?? 'Custom theme'}</span>
              <span className="design-profiles__actions">
                <button className="btn btn--primary btn--small" onClick={() => apply(profile)}>
                  {design.activeProfile === profile.id ? 'In use' : 'Use'}
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  title="Save the current look into this profile"
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
                  Update
                </button>
                <button
                  className="btn btn--link btn--small"
                  onClick={() => setRenaming({ id: profile.id, name: profile.name })}
                >
                  Rename
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
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="design-sub">Starting points</h3>
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
            <strong>{s.name}</strong>
            <span className="muted small">{s.text}</span>
          </button>
        ))}
      </div>

      <h3 className="design-sub">Import and export</h3>
      <p className="muted small">
        Export copies your theme, colours, layout, your own themes and profiles as text (without a background
        picture). Paste such text below to import it — nothing in it can run code.
      </p>
      <textarea
        className="design-io"
        aria-label="Appearance export"
        placeholder='{"kind":"river-appearance", …}'
        value={io}
        onChange={(e) => setIo(e.target.value)}
        spellCheck={false}
      />
      <div className="design-actions">
        <button className="btn btn--ghost btn--small" onClick={exportJson}>
          Export (copy)
        </button>
        <button className="btn btn--ghost btn--small" disabled={!io.trim()} onClick={importJson}>
          Import
        </button>
        {message && <span className="small">{message}</span>}
      </div>

      <h3 className="design-sub">Reset</h3>
      <div className="design-actions">
        <button className="btn btn--ghost btn--small" onClick={() => setPrefs(design, DEFAULT_DESIGN_PREFS)}>
          Reset adjustments (keep theme)
        </button>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => applyTheme({ ...design, prefs: DEFAULT_DESIGN_PREFS }, DEFAULT_DESIGN.theme)}
        >
          Back to River’s default look
        </button>
      </div>
      <p className="muted small">Resetting keeps your own themes and profiles.</p>
    </div>
  );
}

export type { Settings };
