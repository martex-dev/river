import { useEffect, useState, type ReactElement } from 'react';
import type { AttachmentPointer, FavoriteMediaView } from '../../../../shared/community-actions.ts';
import { create } from 'zustand';
import { useCommunity } from '../store.ts';
import { Popover } from './common.tsx';

/** Favourite GIFs and pictures (1.0.25): kept in your encrypted database, never sent to a GIF service. */
interface FavoritesState {
  list: FavoriteMediaView[] | null;
  load(): Promise<void>;
  toggle(pointer: AttachmentPointer, on: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useFavorites = create<FavoritesState>((set, get) => ({
  list: null,
  load: async () => {
    const res = await window.river.community.action({ a: 'favoriteMediaList' });
    if (res.ok) set({ list: res.value });
  },
  toggle: async (pointer, on) => {
    const res = await useCommunity
      .getState()
      .run(on ? { a: 'favoriteMedia', pointer, on: true } : { a: 'removeFavorite', id: pointer.id });
    if (res === null) return;
    await get().load();
    useCommunity.getState().notify(on ? 'Added to your GIFs.' : 'Removed from your GIFs.');
  },
  remove: async (id) => {
    await useCommunity.getState().run({ a: 'removeFavorite', id });
    await get().load();
  },
}));

const urls = new Map<string, string>();

function useFavoriteUrl(id: string): string | null {
  const [url, setUrl] = useState(() => urls.get(id) ?? null);
  useEffect(() => {
    if (url) return;
    let alive = true;
    void window.river.community.action({ a: 'favoriteMediaBytes', id }).then((res) => {
      if (!res.ok || !alive) return;
      const list = useFavorites.getState().list;
      const mime = list?.find((f) => f.id === id)?.mime ?? 'image/gif';
      const made = URL.createObjectURL(new Blob([res.value as BlobPart], { type: mime }));
      urls.set(id, made);
      setUrl(made);
    });
    return () => {
      alive = false;
    };
  }, [id, url]);
  return url;
}

/** The ☆ on a picture in a message. */
export function FavoriteStar({ pointer }: { pointer: AttachmentPointer }): ReactElement | null {
  const list = useFavorites((s) => s.list);
  useEffect(() => {
    if (list === null) void useFavorites.getState().load();
  }, [list]);
  if (!pointer.mime.startsWith('image/')) return null;
  const on = !!list?.some((f) => f.id === pointer.id);
  return (
    <button
      className={`favorite-star ${on ? 'is-on' : ''}`}
      aria-label={on ? 'Remove from your GIFs' : 'Add to your GIFs'}
      title={on ? 'Remove from your GIFs' : 'Add to your GIFs (kept only on this device)'}
      onClick={(e) => {
        e.stopPropagation();
        void useFavorites.getState().toggle(pointer, !on);
      }}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

function Thumb({ f, onPick }: { f: FavoriteMediaView; onPick(): void }): ReactElement {
  const url = useFavoriteUrl(f.id);
  return (
    <button
      className="sticker-picker__item"
      title={`${f.name} — right-click to remove`}
      aria-label={`Send ${f.name}`}
      onClick={onPick}
      onContextMenu={(e) => {
        e.preventDefault();
        void useFavorites.getState().remove(f.id);
      }}
    >
      {url ? <img src={url} alt="" /> : <span className="attachment-image__spinner" />}
    </button>
  );
}

/** The composer's GIF button: your favourites, sent as a fresh encrypted file. */
export function GifButton({ channelId }: { channelId: string }): ReactElement {
  const s = useCommunity();
  const list = useFavorites((x) => x.list);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) void useFavorites.getState().load();
  }, [open]);
  const shown = (list ?? []).filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <button
        type="button"
        className="icon-btn composer__gif"
        aria-label="GIFs"
        title="Your GIFs"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left - 260, y: r.top - 340 });
        }}
      >
        GIF
      </button>
      {open && (
        <Popover x={open.x} y={open.y} onClose={() => setOpen(null)} className="sticker-picker">
          <input
            className="emoji-picker__search"
            autoFocus
            placeholder="Search your GIFs"
            aria-label="Search your GIFs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {list?.length === 0 && (
            <p className="muted small">
              Click ☆ on any GIF or picture in a chat to keep it here. Your GIFs stay on this device; no GIF
              service sees what you look for.
            </p>
          )}
          <div className="sticker-picker__grid">
            {shown.map((f) => (
              <Thumb
                key={f.id}
                f={f}
                onPick={() => {
                  if (busy) return;
                  setBusy(true);
                  void s.run({ a: 'sendFavorite', channelId, id: f.id }).finally(() => {
                    setBusy(false);
                    setOpen(null);
                  });
                }}
              />
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
