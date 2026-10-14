import { useEffect, useState } from 'react';
import { DEFAULT_DESIGN, type DesignSettings } from '../../../shared/design.ts';
import { useRiver } from '../store.ts';
import { mix } from './color.ts';
import { applyDesign, resolveDesign, type Resolved } from './engine.ts';

const CACHE_KEY = 'river.design.v1';

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const change = (e: MediaQueryListEvent): void => setOn(e.matches);
    mql.addEventListener('change', change);
    return () => mql.removeEventListener('change', change);
  }, [query]);
  return on;
}

/** The design in effect: a preview being tried on, else the saved one. */
export function useActiveDesign(): DesignSettings {
  const saved = useRiver((r) => r.settings?.design);
  const preview = useRiver((r) => r.designPreview);
  return preview ?? saved ?? DEFAULT_DESIGN;
}

/** Resolves and applies the design whenever it (or the system's light/dark/contrast) changes. */
export function useDesignEngine(): Resolved {
  const design = useActiveDesign();
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const contrastSetting = useRiver((r) => r.settings?.appearance.contrast ?? 'system');
  const systemMore = useMedia('(prefers-contrast: more)');
  const highContrast = contrastSetting === 'high' || (contrastSetting === 'system' && systemMore);
  const resolved = resolveDesign(design, { systemDark, highContrast });
  const key = JSON.stringify([resolved.vars, resolved.attrs]);
  useEffect(() => {
    applyDesign(resolved, document.documentElement);
    // The window buttons (Windows) sit on the title bar: same colour, readable symbols.
    void window.river?.app
      ?.setTitleBar({
        color: resolved.vars['--layer-0']!,
        symbol: mix(resolved.vars['--text']!, resolved.vars['--layer-0']!, 0.35),
      })
      .catch(() => undefined);
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ vars: resolved.vars, attrs: resolved.attrs, mode: resolved.mode }),
      );
    } catch {
      // storage unavailable: the fallback look shows briefly on the next start
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return resolved;
}

/** Called before React renders: paints the last applied design at once. */
export function restoreCachedDesign(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw) as {
      vars: Record<string, string>;
      attrs: Record<string, string>;
      mode: 'light' | 'dark';
    };
    const root = document.documentElement;
    for (const [k, v] of Object.entries(cached.vars))
      if (k.startsWith('--')) root.style.setProperty(k, String(v));
    for (const [k, v] of Object.entries(cached.attrs))
      if (/^[a-z]+$/.test(k)) root.setAttribute(`data-${k}`, String(v));
    root.style.colorScheme = cached.mode === 'light' ? 'light' : 'dark';
  } catch {
    // a broken cache is simply ignored
  }
}
