import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { create } from 'zustand';
import { designImage, type DesignSettings, type Wallpaper } from '../../../shared/design.ts';
import { blurPhoto } from './photo.ts';
import { colorsOf, wallpaperLayers, type WallpaperColors, type WallpaperLayers } from './wallpaper.ts';

/** The colours of the look in effect (set by the design engine), for wallpapers drawn outside it. */
export const useLook = create<{ colors: WallpaperColors | null }>(() => ({ colors: null }));

export function publishLook(vars: Record<string, string>, mode: 'light' | 'dark'): void {
  const colors = colorsOf(vars, mode);
  const now = useLook.getState().colors;
  if (now && JSON.stringify(now) === JSON.stringify(colors)) return;
  useLook.setState({ colors });
}

/** A wallpaper's photo, blurred as asked (the sharp photo shows until the blurred one is ready). */
function usePhoto(design: Pick<DesignSettings, 'images'>, w: Wallpaper | null | undefined): string | null {
  const src = w?.kind === 'photo' ? designImage(design, w.photo) : null;
  const blur = w?.blur ?? 0;
  const [ready, setReady] = useState<{ key: string; url: string } | null>(null);
  const key = src ? `${blur}:${src.length}:${src.slice(-48)}` : '';
  useEffect(() => {
    if (!src || blur <= 0) return;
    let live = true;
    blurPhoto(src, blur)
      .then((url) => live && setReady({ key, url }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [src, blur, key]);
  if (!src) return null;
  if (blur <= 0) return src;
  return ready?.key === key ? ready.url : src;
}

/** The layers of a wallpaper in the given colours (the live look's when none are given). */
export function useWallpaperLayers(
  design: Pick<DesignSettings, 'images'>,
  w: Wallpaper | null | undefined,
  colors?: WallpaperColors | null,
): WallpaperLayers | null {
  const live = useLook((s) => s.colors);
  const c = colors ?? live;
  const photo = usePhoto(design, w);
  return useMemo(() => (c ? wallpaperLayers(w, c, photo) : null), [c, w, photo]);
}

/** What the messages area of a chat carries: its own wallpaper, if it has one. */
export interface WallpaperProps {
  'data-wp'?: string;
  'data-wp-plate'?: string;
  style?: CSSProperties;
}

export function wallpaperProps(layers: WallpaperLayers | null): WallpaperProps {
  if (!layers) return {};
  return {
    'data-wp': layers.kind,
    ...(layers.plate ? { 'data-wp-plate': '' } : {}),
    style: { '--wp-bg': layers.background } as CSSProperties,
  };
}

/** Writes the app's wallpaper onto <html> (every chat without one of its own shows it). */
export function applyAppWallpaper(layers: WallpaperLayers | null, root: HTMLElement): void {
  root.style.setProperty('--wp-bg', layers?.background ?? 'none');
  root.dataset.wallpaper = layers?.kind ?? 'none';
  if (layers?.plate) root.dataset.wpPlate = 'on';
  else delete root.dataset.wpPlate;
}
