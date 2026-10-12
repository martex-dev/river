import { useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import { EMOJI_NAME } from '../../../../shared/community-actions.ts';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { useCommunity } from '../store.ts';
import { can } from './common.tsx';

/** Largest image kept as it is (animated GIFs); anything else is redrawn at 128 px. */
const MAX_KEEP_BYTES = 64 * 1024;
const SIZE = 128;

/** A name from a file name: "party parrot.gif" → "party_parrot". */
export function emojiNameFrom(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (base.length >= 2 ? base : `emoji_${base}`).slice(0, 32);
}

/** Small square PNG (or a small GIF as it is, to keep its animation). */
async function toEmojiImage(file: File): Promise<string> {
  const read = (f: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('read'));
      r.readAsDataURL(f);
    });
  if (file.type === 'image/gif' && file.size <= MAX_KEEP_BYTES) return read(file);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image'));
      i.src = url;
    });
    const scale = Math.min(1, SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Community settings → Emoji (1.0.19). */
export function EmojiSettings({ community }: { community: CommunityView }): ReactElement {
  const s = useCommunity();
  const emojis = useCommunity((x) => x.emojis[community.id]) ?? [];
  const manage = can(community.permissions, Permission.MANAGE_EXPRESSIONS);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; image: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOk = !!pending && EMOJI_NAME.test(pending.name);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const rename = async (): Promise<void> => {
    if (!renaming || !EMOJI_NAME.test(renaming.name)) return;
    const res = await s.run({
      a: 'renameEmoji',
      communityId: community.id,
      emojiId: renaming.id,
      name: renaming.name,
    });
    if (res !== null) {
      setRenaming(null);
      void s.loadEmojis(community.id);
    }
  };
  const save = async (): Promise<void> => {
    if (!pending) return;
    setBusy(true);
    const res = await s.run({
      a: 'addEmoji',
      communityId: community.id,
      name: pending.name,
      image: pending.image,
    });
    setBusy(false);
    if (res) {
      setPending(null);
      void s.loadEmojis(community.id);
    }
  };
  return (
    <div className="settings-page">
      <h2>Emoji</h2>
      <p className="muted small">
        Everyone here can use these with <code>:name:</code> in messages and reactions. Click a name to rename
        it. Pictures and names are end-to-end encrypted. Up to 100.
      </p>
      {manage && (
        <div className="emoji-upload">
          <button className="btn btn--primary btn--small" onClick={() => fileRef.current?.click()}>
            Upload emoji
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
              if (file.size > 5 * 1024 * 1024) return s.notify('That image is too large.', 'error');
              void toEmojiImage(file)
                .then((image) => setPending({ name: emojiNameFrom(file.name), image }))
                .catch(() => s.notify('River could not read that image.', 'error'));
            }}
          />
          {pending && (
            <div className="emoji-upload__pending">
              <img className="custom-emoji custom-emoji--big" src={pending.image} alt="" />
              <label className="textfield">
                <span className="field__label">Name</span>
                <input
                  autoFocus
                  value={pending.name}
                  maxLength={32}
                  onChange={(e) => setPending({ ...pending, name: e.target.value })}
                />
              </label>
              {!nameOk && <span className="field__error">2–32 letters, numbers or _</span>}
              <button
                className="btn btn--primary btn--small"
                disabled={!nameOk || busy}
                onClick={() => void save()}
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
      {emojis.length === 0 ? (
        <p className="muted">No custom emoji yet.</p>
      ) : (
        <ul className="emoji-list">
          {emojis.map((e) => (
            <li key={e.id} className="emoji-list__item">
              <img className="custom-emoji custom-emoji--big" src={e.image} alt="" />
              {renaming?.id === e.id ? (
                <form
                  className="emoji-list__rename"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    void rename();
                  }}
                >
                  <input
                    autoFocus
                    aria-label={`New name for :${e.name}:`}
                    value={renaming.name}
                    maxLength={32}
                    onChange={(ev) => setRenaming({ id: e.id, name: ev.target.value })}
                    onKeyDown={(ev) => ev.key === 'Escape' && setRenaming(null)}
                  />
                  <button className="btn btn--small" disabled={!EMOJI_NAME.test(renaming.name)}>
                    Save
                  </button>
                </form>
              ) : manage ? (
                <button
                  className="btn btn--link emoji-list__name"
                  title="Rename"
                  onClick={() => setRenaming({ id: e.id, name: e.name })}
                >
                  <code>:{e.name}:</code>
                </button>
              ) : (
                <code>:{e.name}:</code>
              )}
              {manage && (
                <button
                  className="btn btn--link btn--danger"
                  aria-label={`Remove :${e.name}:`}
                  onClick={() =>
                    void s.run({ a: 'deleteEmoji', emojiId: e.id }).then(() => s.loadEmojis(community.id))
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
