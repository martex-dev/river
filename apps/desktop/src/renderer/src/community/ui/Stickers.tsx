import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { useCommunity } from '../store.ts';
import { Popover, can } from './common.tsx';

const MAX_SIDE = 320;
/** GIFs this small are kept as they are, so they stay animated. */
const KEEP_GIF_BYTES = 140 * 1024;

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(blob);
  });
}

/** A sticker picture: small GIFs as they are, anything else redrawn as a PNG up to 320 px. */
export async function toStickerImage(file: File): Promise<string> {
  if (file.type === 'image/gif' && file.size <= KEEP_GIF_BYTES) return readDataUrl(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image'));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL('image/webp', 0.85);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A sticker in a message, from any community you are in. */
export function StickerImage({ id }: { id: string }): ReactElement {
  const sticker = useCommunity((s) => {
    for (const list of Object.values(s.stickers)) {
      const found = list.find((x) => x.id === id);
      if (found) return found;
    }
    return null;
  });
  if (!sticker) return <span className="muted small">[a sticker that is no longer here]</span>;
  return (
    <img
      className="sticker"
      src={sticker.image}
      alt={`Sticker: ${sticker.name}`}
      title={sticker.name}
      draggable={false}
    />
  );
}

/** The composer's sticker button and picker. */
export function StickerButton({
  community,
  channelId,
}: {
  community: CommunityView;
  channelId: string;
}): ReactElement {
  const s = useCommunity();
  const stickers = useCommunity((x) => x.stickers[community.id]);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open && !stickers) void s.loadStickers(community.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, community.id]);
  const shown = (stickers ?? []).filter((x) => x.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Stickers"
        title="Stickers"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left - 260, y: r.top - 340 });
        }}
      >
        <span aria-hidden="true">🗒️</span>
      </button>
      {open && (
        <Popover x={open.x} y={open.y} onClose={() => setOpen(null)} className="sticker-picker">
          <input
            className="emoji-picker__search"
            autoFocus
            placeholder="Search stickers"
            aria-label="Search stickers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {stickers === undefined && <p className="muted small">Loading…</p>}
          {stickers?.length === 0 && (
            <p className="muted small">
              No stickers here yet.
              {can(community.permissions, Permission.MANAGE_EXPRESSIONS) && (
                <>
                  {' '}
                  <button
                    className="btn btn--link btn--small"
                    onClick={() => {
                      setOpen(null);
                      s.setModal({ kind: 'community-settings', communityId: community.id, tab: 'stickers' });
                    }}
                  >
                    Add some
                  </button>
                </>
              )}
            </p>
          )}
          <div className="sticker-picker__grid">
            {shown.map((x) => (
              <button
                key={x.id}
                className="sticker-picker__item"
                title={x.name}
                aria-label={`Send sticker ${x.name}`}
                onClick={() => {
                  setOpen(null);
                  void s.run({ a: 'send', channelId, text: '', sticker: x.id });
                }}
              >
                <img src={x.image} alt="" />
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}

/** Community settings → Stickers (1.0.24). */
export function StickerSettings({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const stickers = useCommunity((x) => x.stickers[community.id]);
  const manage = can(community.permissions, Permission.MANAGE_EXPRESSIONS);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; image: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void s.loadStickers(community.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id]);
  const add = async (): Promise<void> => {
    if (!pending || !pending.name.trim()) return;
    setBusy(true);
    const res = await s.run({
      a: 'addSticker',
      communityId: community.id,
      name: pending.name.trim(),
      image: pending.image,
    });
    setBusy(false);
    if (res) {
      setPending(null);
      void s.loadStickers(community.id);
    }
  };
  return (
    <div className="settings-page">
      <h2>Stickers</h2>
      <p className="muted small">
        Big pictures anyone here can send with the 🗒️ button. End-to-end encrypted. Up to 60.
      </p>
      {manage && (
        <div className="emoji-upload">
          <button className="btn btn--primary btn--small" onClick={() => fileRef.current?.click()}>
            Upload sticker
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 8 * 1024 * 1024) return s.notify('That image is too large.', 'error');
              void toStickerImage(file)
                .then((image) => {
                  if (image.length > 190_000) throw new Error('big');
                  setPending({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'sticker', image });
                })
                .catch(() =>
                  s.notify('River could not make a sticker from that picture (try a smaller one).', 'error'),
                );
            }}
          />
          {pending && (
            <div className="emoji-upload__pending">
              <img className="sticker sticker--preview" src={pending.image} alt="" />
              <label className="textfield">
                <span className="field__label">Name</span>
                <input
                  autoFocus
                  value={pending.name}
                  maxLength={30}
                  onChange={(e) => setPending({ ...pending, name: e.target.value })}
                />
              </label>
              <button
                className="btn btn--primary btn--small"
                disabled={!pending.name.trim() || busy}
                onClick={() => void add()}
              >
                Add
              </button>
              <button className="btn btn--link" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      {stickers === undefined && <p className="muted">Loading…</p>}
      {stickers?.length === 0 && <p className="muted">No stickers yet.</p>}
      <div className="sticker-grid">
        {stickers?.map((x) => (
          <figure key={x.id} className="sticker-grid__item">
            <img className="sticker sticker--preview" src={x.image} alt="" />
            <figcaption>{x.name}</figcaption>
            {manage && (
              <button
                className="btn btn--link btn--danger btn--small"
                aria-label={`Remove sticker ${x.name}`}
                onClick={() =>
                  void s.run({ a: 'deleteSticker', stickerId: x.id }).then(() => s.loadStickers(community.id))
                }
              >
                Remove
              </button>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}
