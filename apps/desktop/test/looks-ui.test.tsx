// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WALLPAPER } from '../src/shared/design.ts';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  settingsPatchSchema,
  type Settings,
} from '../src/shared/settings.ts';
import { AppearanceCenter } from '../src/renderer/src/appearance/AppearanceCenter.tsx';
import { ChatWallpaperDialog, useChatWallpaper } from '../src/renderer/src/appearance/ChatWallpaper.tsx';
import { Bursts, burstParticles, quiet } from '../src/renderer/src/appearance/delight.tsx';
import { resolveDesign } from '../src/renderer/src/appearance/engine.ts';
import { parseThemeCode, themeCode } from '../src/renderer/src/appearance/share.ts';
import { publishLook, useLook } from '../src/renderer/src/appearance/use-wallpaper.ts';
import { channelKey, dmKey } from '../src/renderer/src/appearance/wallpaper.ts';
import { celebrate, Celebrations } from '../src/renderer/src/community/fx.tsx';
import { useRiver } from '../src/renderer/src/store.ts';

let settings: Settings;
const update = vi.fn(async (patch: unknown) => {
  settings = applySettingsPatch(settings, settingsPatchSchema.parse(patch));
  return settings;
});
const haptic = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  settings = structuredClone(DEFAULT_SETTINGS);
  update.mockClear();
  haptic.mockClear();
  (window as unknown as { river: unknown }).river = {
    settings: { update },
    security: { status: async () => ({ items: [], releaseKeys: [] }) },
    app: { haptic },
  };
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  useRiver.setState({ settings, designPreview: null, designTrying: false, info: null });
  const r = resolveDesign(settings.design);
  publishLook(r.vars, r.mode);
  document.documentElement.dataset.motion = 'full';
  document.documentElement.dataset.calm = 'off';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const edited = () => useRiver.getState().designPreview ?? useRiver.getState().settings!.design;

describe('Appearance: live preview and Chat section', () => {
  it('shows a sample chat that follows wallpaper and bubble choices at once', () => {
    const { container } = render(<AppearanceCenter general={<p>general</p>} />);
    const preview = container.querySelector('.lp')!;
    expect(preview.getAttribute('aria-hidden')).toBe('true');
    expect(preview.getAttribute('data-bubbles')).toBe('rounded');
    expect(preview.getAttribute('data-wp')).toBe('none');
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Space doodles' }));
    expect(edited().prefs.wallpaper).toMatchObject({ kind: 'pattern', pattern: 'space' });
    expect(container.querySelector('.lp')!.getAttribute('data-wp')).toBe('pattern');
    expect((container.querySelector('.lp') as HTMLElement).style.getPropertyValue('--lp-wp')).toContain(
      'data:image/svg+xml',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Dusk' }));
    expect(edited().prefs.wallpaper.gradient).toBe('dusk');
    fireEvent.click(screen.getByRole('radio', { name: 'Outlined' }));
    expect(edited().prefs.bubbles).toBe('outlined');
    expect(container.querySelector('.lp')!.getAttribute('data-bubbles')).toBe('outlined');
    fireEvent.click(screen.getByRole('radio', { name: 'Ocean gradient' }));
    expect(edited().prefs.wallpaper).toMatchObject({ kind: 'gradient', gradient: 'ocean' });
  });

  it('changes chat text size and density from the Chat section', async () => {
    render(<AppearanceCenter general={<p>general</p>} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Chat text size'), { target: { value: '18' } });
    });
    expect(update).toHaveBeenCalledWith({ appearance: { fontSize: 18 } });
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('radiogroup', { name: 'Density' })).getByRole('radio', { name: 'Compact' }),
      );
    });
    expect(update).toHaveBeenCalledWith({ appearance: { density: 'compact' } });
  });

  it('keeps the e2e entry points: Themes first, skins and palettes by name', () => {
    render(<AppearanceCenter general={<p>general</p>} />);
    expect(screen.getByRole('tab', { name: 'Themes' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('radio', { name: /Specter skin/ })).toHaveLength(1);
    // Nothing new is named like a skin or a palette.
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.queryAllByRole('radio', { name: / skin| palette/ })).toHaveLength(0);
  });
});

describe('Appearance: accent and theme codes', () => {
  it('sets any accent with readable text on it', () => {
    render(<AppearanceCenter general={<p>general</p>} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Colours' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Pink accent' }));
    expect(edited().prefs.colors.accent).toBe('#e05297');
    expect(edited().prefs.colors.accent2).toBeDefined();
    expect(screen.getByText(/Text on the accent: \d+\.\d:1 — readable \(WCAG AA\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Any accent colour'), { target: { value: '#ffff00' } });
    expect(edited().prefs.colors.accent).toBe('#ffff00');
    expect(screen.getByText(/readable \(WCAG AA\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Theme accent' }));
    expect(edited().prefs.colors.accent).toBeUndefined();
  });

  it('copies the theme as a code and adds a pasted one', () => {
    render(<AppearanceCenter general={<p>general</p>} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Colours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy theme code' }));
    const box = screen.getByLabelText('Theme code') as HTMLTextAreaElement;
    expect(parseThemeCode(box.value).ok).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(box.value);

    const shared = themeCode(
      {
        ...settings.design,
        theme: 'paper-ivory',
        prefs: { ...settings.design.prefs, colors: { accent: '#e05297' } },
      },
      'Pink paper',
    );
    fireEvent.change(box, { target: { value: shared } });
    fireEvent.click(screen.getByRole('button', { name: 'Add pasted theme' }));
    expect(edited().customThemes).toHaveLength(1);
    expect(edited().customThemes[0]).toMatchObject({ name: 'Pink paper', base: 'paper-ivory' });
    expect(edited().theme).toBe(edited().customThemes[0]!.id);
    expect(screen.getByRole('status').textContent).toContain('Pink paper');

    fireEvent.change(box, { target: { value: 'river-theme:garbage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add pasted theme' }));
    expect(screen.getByRole('status').textContent).toMatch(/damaged/);
    expect(edited().customThemes).toHaveLength(1);
  });

  it('starts the editor from any theme', () => {
    render(<AppearanceCenter general={<p>general</p>} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Colours' }));
    fireEvent.change(screen.getByLabelText('Start from theme'), { target: { value: 'paper-ivory' } });
    expect(edited().theme).toBe('paper-ivory');
  });
});

describe('Calm mode', () => {
  it('is a toggle under Motion', async () => {
    render(<AppearanceCenter general={<p>general</p>} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Motion' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: /Calm mode/ }));
    });
    expect(update).toHaveBeenCalledWith({ appearance: { calm: true } });
  });

  it('keeps celebrations and bursts away, but phones still buzz', () => {
    const { container } = render(<Celebrations />);
    document.documentElement.dataset.calm = 'on';
    expect(quiet()).toBe(true);
    act(() => celebrate('You and Ana are now friends'));
    expect(haptic).toHaveBeenCalledWith('success');
    expect(container.querySelector('.celebrations')).toBeNull();
    document.documentElement.dataset.calm = 'off';
    document.documentElement.dataset.motion = 'reduced';
    expect(quiet()).toBe(true);
    document.documentElement.dataset.motion = 'full';
    act(() => celebrate('Welcome'));
    expect(container.querySelector('.celebrations')).not.toBeNull();
    // Confetti in the theme's accent among River's colours.
    const accent = document.documentElement.style.getPropertyValue('--accent');
    expect(accent === '' || container.innerHTML.includes(accent)).toBe(true);
  });
});

describe('reaction bursts', () => {
  const chip = (mine: boolean): HTMLElement => {
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.innerHTML = `<button class="reaction ${mine ? 'is-mine' : ''}"><span class="reaction__emoji">🔥</span><span class="reaction__count">1</span></button>`;
    document.body.append(msg);
    return msg.querySelector('.reaction')!;
  };

  it('bursts out of a reaction as you add it, not as you take it back', () => {
    const { container } = render(<Bursts />);
    act(() => chip(true).click());
    expect(container.querySelector('.burst-fx')).toBeNull();
    act(() => chip(false).click());
    const fx = container.querySelector('.burst-fx')!;
    expect(fx.textContent).toContain('🔥');
    expect(fx.querySelectorAll('.burst-fx__piece').length).toBeGreaterThanOrEqual(6);
    expect(container.querySelector('.bursts')!.getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(2000));
    expect(container.querySelector('.burst-fx')).toBeNull();
    document.documentElement.dataset.calm = 'on';
    act(() => chip(false).click());
    expect(container.querySelector('.burst-fx')).toBeNull();
  });

  it('flies pieces in a ring, upwards', () => {
    let n = 0;
    const pieces = burstParticles(8, true, () => (n += 0.37) % 1);
    expect(pieces).toHaveLength(8);
    expect(pieces.reduce((s, p) => s + p.dy, 0) / 8).toBeLessThan(0);
    expect(new Set(pieces.map((p) => Math.sign(p.dx))).size).toBeGreaterThan(1);
  });
});

describe('chat wallpapers', () => {
  function Messages(props: { chat: string }): ReactElement {
    return <div className="chat__messages" data-testid="msgs" {...useChatWallpaper(props.chat)} />;
  }

  it('sets one chat’s wallpaper from its menu dialog and shows it only there', () => {
    const key = dmKey('3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e4b71');
    const onClose = vi.fn();
    render(<ChatWallpaperDialog chatKey={key} name="Ana" onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Wallpaper for Ana' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Hearts doodles' }));
    fireEvent.change(screen.getByLabelText('Doodle strength'), { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set wallpaper' }));
    expect(onClose).toHaveBeenCalled();
    expect(edited().chatWallpapers[key]).toMatchObject({ kind: 'pattern', pattern: 'hearts', strength: 0.8 });
    expect(edited().prefs.wallpaper.kind).toBe('none');
    cleanup();

    render(
      <>
        <Messages chat={key} />
        <Messages chat={channelKey('other')} />
      </>,
    );
    const [own, other] = screen.getAllByTestId('msgs');
    expect(own!.getAttribute('data-wp')).toBe('pattern');
    expect(own!.style.getPropertyValue('--wp-bg')).toContain('data:image/svg+xml');
    expect(other!.getAttribute('data-wp')).toBeNull();
  });

  it('goes back to the app’s wallpaper', () => {
    const key = channelKey('c-1');
    useRiver.setState({
      designPreview: {
        ...settings.design,
        chatWallpapers: { [key]: { ...DEFAULT_WALLPAPER, kind: 'solid', color: '#334455' } },
      },
    });
    render(<ChatWallpaperDialog chatKey={key} name="#general" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use the app’s wallpaper' }));
    expect(edited().chatWallpapers).toEqual({});
  });

  it('needs the look’s colours before it draws anything', () => {
    useLook.setState({ colors: null });
    const key = channelKey('c-2');
    useRiver.setState({
      designPreview: {
        ...settings.design,
        chatWallpapers: { [key]: { ...DEFAULT_WALLPAPER, kind: 'gradient' } },
      },
    });
    render(<Messages chat={key} />);
    expect(screen.getByTestId('msgs').getAttribute('data-wp')).toBeNull();
  });
});
