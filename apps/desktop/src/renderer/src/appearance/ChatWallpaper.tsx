import { useState, type ReactElement } from 'react';
import { DEFAULT_WALLPAPER, MAX_WALLPAPER_PHOTOS, type Wallpaper } from '../../../shared/design.ts';
import { Modal } from '../community/ui/common.tsx';
import { play } from '../community/sound.ts';
import { commitDesign, useEditedDesign } from './editor.ts';
import { useActiveDesign } from './use-design.ts';
import { useLook, useWallpaperLayers, wallpaperProps, type WallpaperProps } from './use-wallpaper.ts';
import { withChatWallpaper } from './wallpaper.ts';
import { WallpaperPicker } from './WallpaperPicker.tsx';
import { tr } from '../i18n.ts';

/**
 * Per-chat wallpapers (2.18): the props for a chat's messages area. A chat without a wallpaper
 * of its own gets nothing here and shows the app's (set on <html>).
 */
export function useChatWallpaper(key: string | null): WallpaperProps {
  const design = useActiveDesign();
  const own = key ? design.chatWallpapers?.[key] : undefined;
  const layers = useWallpaperLayers(design, own ?? null);
  return own ? wallpaperProps(layers) : {};
}

/** Distinct photos the chats hold (each is kept once). */
export function chatPhotoCount(chatWallpapers: Record<string, Wallpaper>, except?: string): number {
  return new Set(
    Object.entries(chatWallpapers)
      .filter(([k, w]) => k !== except && w.kind === 'photo' && w.photo)
      .map(([, w]) => w.photo),
  ).size;
}

/** "Wallpaper" for one conversation or channel: its own, or back to the app's. */
export function ChatWallpaperDialog(props: { chatKey: string; name: string; onClose(): void }): ReactElement {
  const design = useEditedDesign();
  const colors = useLook((s) => s.colors);
  const own = design.chatWallpapers?.[props.chatKey];
  const [draft, setDraft] = useState<Wallpaper>(own ?? design.prefs.wallpaper ?? DEFAULT_WALLPAPER);
  const layers = useWallpaperLayers(design, draft, colors);
  const preview = wallpaperProps(layers);
  const save = (w: Wallpaper | null): void => {
    commitDesign(withChatWallpaper(design, props.chatKey, w));
    play('success');
    props.onClose();
  };
  return (
    <Modal
      title={tr('Wallpaper for {name}', { name: props.name })}
      onClose={props.onClose}
      className="wp-dialog"
    >
      <div className="wp-dialog__preview" {...preview} aria-hidden="true">
        <span className="wp-dialog__bubble">{tr('Hi! How do I look? 🌊')}</span>
        <span className="wp-dialog__bubble wp-dialog__bubble--mine">{tr('Lovely.')}</span>
      </div>
      <WallpaperPicker
        value={draft}
        colors={colors}
        design={design}
        onChange={setDraft}
        photosLeft={MAX_WALLPAPER_PHOTOS - chatPhotoCount(design.chatWallpapers ?? {}, props.chatKey)}
      />
      <p className="muted small">
        {tr('Only on this device. The other people in this chat see their own wallpaper.')}
      </p>
      <div className="modal__foot">
        {own && (
          <button className="btn btn--ghost" onClick={() => save(null)}>
            {tr('Use the app’s wallpaper')}
          </button>
        )}
        <button className="btn btn--ghost" onClick={props.onClose}>
          {tr('Cancel')}
        </button>
        <button className="btn btn--primary" onClick={() => save(draft)}>
          {tr('Set wallpaper')}
        </button>
      </div>
    </Modal>
  );
}
