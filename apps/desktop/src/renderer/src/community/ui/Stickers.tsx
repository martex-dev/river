import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { StickerIcon } from '../../phone/icons.tsx';
import { useCommunity } from '../store.ts';
import { Popover, StillPicture, can, holdStill } from './common.tsx';
import { tr } from '../../i18n.ts';

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
  if (!sticker) return <span className="muted small">{tr('[a sticker that is no longer here]')}</span>;
  if (holdStill(sticker.image))
    return (
      <StillPicture
        src={sticker.image}
        className="sticker"
        label={tr('Sticker: {name}', { name: sticker.name })}
      />
    );
  return (
    <img
      className="sticker"
      src={sticker.image}
      alt={tr('Sticker: {name}', { name: sticker.name })}
      title={sticker.name}
      draggable={false}
    />
  );
}

/** A sticker sent in a direct message (2.10.10) is a picture file named `sticker-…`. */
export const STICKER_PREFIX = 'sticker-';

export function isStickerFile(name: string, mime: string): boolean {
  return name.startsWith(STICKER_PREFIX) && mime.startsWith('image/');
}

/** A sticker's picture (a data URL) as a file to send. */
export function stickerFile(name: string, image: string): File | null {
  const m = /^data:(image\/(?:png|webp|gif|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(image);
  if (!m) return null;
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = m[1]!.slice('image/'.length).replace('jpeg', 'jpg');
  const safe = name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'sticker';
  return new File([bytes], `${STICKER_PREFIX}${safe}.${ext}`, { type: m[1]! });
}

/**
 * Stickers in direct messages and groups (2.10.10): the stickers of all your communities. The one
 * you pick is sent as an encrypted picture.
 */
export function MyStickersButton(props: {
  disabled?: boolean;
  /** The phone's message box: a line icon like the buttons next to it. */
  phone?: boolean;
  onPick(file: File): void;
}): ReactElement {
  const s = useCommunity();
  const communities = useCommunity((x) => x.communities);
  const all = useCommunity((x) => x.stickers);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) return;
    for (const c of communities) if (!all[c.id]) void s.loadStickers(c.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const q = query.trim().toLowerCase();
  const groups = communities
    .map((c) => ({ c, list: (all[c.id] ?? []).filter((x) => x.name.toLowerCase().includes(q)) }))
    .filter((g) => g.list.length > 0);
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label={tr('Stickers')}
        title={tr('Stickers')}
        disabled={props.disabled}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: r.left - 260, y: r.top - 340 });
        }}
      >
        {props.phone ? <StickerIcon size={24} /> : <span aria-hidden="true">🗒️</span>}
      </button>
      {open && (
        <Popover x={open.x} y={open.y} onClose={() => setOpen(null)} className="sticker-picker">
          <input
            className="emoji-picker__search"
            autoFocus
            placeholder={tr('Search stickers')}
            aria-label={tr('Search stickers')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {groups.length === 0 && (
            <p className="muted small">
              {communities.length === 0
                ? tr('Stickers come from your communities. Join or make one to add stickers.')
                : tr('No stickers yet. Community admins add them in community settings → Stickers.')}
            </p>
          )}
          {groups.map(({ c, list }) => (
            <div key={c.id}>
              <div className="sticker-picker__group muted small">{c.name}</div>
              <div className="sticker-picker__grid">
                {list.map((x) => (
                  <button
                    key={x.id}
                    className="sticker-picker__item"
                    title={x.name}
                    aria-label={tr('Send sticker {name}', { name: x.name })}
                    onClick={() => {
                      setOpen(null);
                      const file = stickerFile(x.name, x.image);
                      if (file) props.onPick(file);
                    }}
                  >
                    <img src={x.image} alt="" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Popover>
      )}
    </>
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
        aria-label={tr('Stickers')}
        title={tr('Stickers')}
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
            placeholder={tr('Search stickers')}
            aria-label={tr('Search stickers')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {stickers === undefined && <p className="muted small">{tr('Loading…')}</p>}
          {stickers?.length === 0 && (
            <p className="muted small">
              {tr('No stickers here yet.')}
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
                    {tr('Add some')}
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
                aria-label={tr('Send sticker {name}', { name: x.name })}
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
      <h2>{tr('Stickers')}</h2>
      <p className="muted small">
        {tr('Big pictures anyone here can send with the 🗒️ button. End-to-end encrypted. Up to 60.')}
      </p>
      {manage && (
        <div className="emoji-upload">
          <button className="btn btn--primary btn--small" onClick={() => fileRef.current?.click()}>
            {tr('Upload sticker')}
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
              if (file.size > 8 * 1024 * 1024) return s.notify(tr('That image is too large.'), 'error');
              void toStickerImage(file)
                .then((image) => {
                  if (image.length > 190_000) throw new Error('big');
                  setPending({ name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'sticker', image });
                })
                .catch(() =>
                  s.notify(
                    tr('River could not make a sticker from that picture (try a smaller one).'),
                    'error',
                  ),
                );
            }}
          />
          {pending && (
            <div className="emoji-upload__pending">
              <img className="sticker sticker--preview" src={pending.image} alt="" />
              <label className="textfield">
                <span className="field__label">{tr('Name')}</span>
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
                {tr('Add')}
              </button>
              <button className="btn btn--link" onClick={() => setPending(null)}>
                {tr('Cancel')}
              </button>
            </div>
          )}
        </div>
      )}
      {stickers === undefined && <p className="muted">{tr('Loading…')}</p>}
      {stickers?.length === 0 && <p className="muted">{tr('No stickers yet.')}</p>}
      <div className="sticker-grid">
        {stickers?.map((x) => (
          <figure key={x.id} className="sticker-grid__item">
            <img className="sticker sticker--preview" src={x.image} alt="" />
            <figcaption>{x.name}</figcaption>
            {manage && (
              <button
                className="btn btn--link btn--danger btn--small"
                aria-label={tr('Remove sticker {name}', { name: x.name })}
                onClick={() =>
                  void s.run({ a: 'deleteSticker', stickerId: x.id }).then(() => s.loadStickers(community.id))
                }
              >
                {tr('Remove')}
              </button>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}
