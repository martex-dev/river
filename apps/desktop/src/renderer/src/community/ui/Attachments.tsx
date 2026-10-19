import { tr } from '../../i18n.ts';
import { FavoriteStar } from './Favorites.tsx';
import { isStickerFile } from './Stickers.tsx';
import { isVoiceMessage, VoiceNote } from '../../components/VoiceMessage.tsx';
import {
  useCallback,
  useContext,
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { AttachmentPointer } from '../../../../shared/community-actions.ts';
import { MAX_ATTACHMENT_BYTES } from '../../../../shared/community-actions.ts';
import { BlobUrlCache } from '../blob-cache.ts';
import { useCommunity } from '../store.ts';
import { useOverlayLayer, XIcon } from './common.tsx';

/** Types River shows inline. Everything else is offered as a file to save — never opened automatically. */
const INLINE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const INLINE_VIDEO = new Set(['video/mp4', 'video/webm']);
const INLINE_AUDIO = new Set([
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
]);
const AUTO_LOAD_BYTES = 12 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Decrypted object URLs for this session, so scrolling back does not re-download: at most 200
 * files / 300 MB, the least recently used revoked first, never one on screen.
 */
const urls = new BlobUrlCache({ maxEntries: 200, maxBytes: 300 * 1024 * 1024 });

export function decryptToUrl(pointer: AttachmentPointer): Promise<string> {
  return urls.load(pointer.id, async () => {
    const res = await window.river.community.action({ a: 'download', pointer });
    if (!res.ok) throw new Error(res.message);
    const type =
      INLINE_IMAGE.has(pointer.mime) || INLINE_VIDEO.has(pointer.mime) || INLINE_AUDIO.has(pointer.mime)
        ? pointer.mime
        : 'application/octet-stream';
    return new Blob([res.value as Uint8Array<ArrayBuffer>], { type });
  });
}

function useDecrypted(
  pointer: AttachmentPointer,
  enabled: boolean,
): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({
    url: urls.get(pointer.id) ?? null,
    error: null,
  });
  useEffect(() => {
    if (!enabled || state.url) return;
    let live = true;
    decryptToUrl(pointer)
      .then((url) => live && setState({ url, error: null }))
      .catch((err: Error) => live && setState({ url: null, error: err.message }));
    return () => {
      live = false;
    };
  }, [enabled, pointer, state.url]);
  // While shown, the URL is never revoked.
  useEffect(() => (state.url ? urls.retain(pointer.id) : undefined), [state.url, pointer.id]);
  return state;
}

/** True once the element has scrolled into view (so off-screen images are not downloaded). */
function useVisible(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return [ref, visible];
}

export async function saveAttachment(pointer: AttachmentPointer): Promise<void> {
  const res = await window.river.community.saveAttachment(pointer);
  if (!res.ok) useCommunity.getState().notify(res.message, 'error');
  else if (res.value) useCommunity.getState().notify(tr('Saved {name}', { name: pointer.name }));
}

/**
 * The pictures of the conversation being shown, oldest first (2.7): the image viewer moves
 * between them. Message lists provide it; elsewhere a message's own pictures are used.
 */
export const GalleryContext = createContext<AttachmentPointer[] | null>(null);

export function galleryOf(lists: Iterable<AttachmentPointer[]>): AttachmentPointer[] {
  const out: AttachmentPointer[] = [];
  for (const list of lists) for (const a of list) if (INLINE_IMAGE.has(a.mime)) out.push(a);
  return out;
}

export function AttachmentList({
  attachments,
  alts,
}: {
  attachments: AttachmentPointer[];
  alts?: Record<string, string>;
}): ReactElement {
  const [open, setOpen] = useState<AttachmentPointer | null>(null);
  const shared = useContext(GalleryContext);
  const gallery = shared && open && shared.some((a) => a.id === open.id) ? shared : galleryOf([attachments]);
  // Two or more pictures in one message are an album (2.10.3): a grid, like Telegram.
  const images = attachments.filter((a) => INLINE_IMAGE.has(a.mime));
  const album = images.length >= 2 ? images : [];
  return (
    <div className="attachments">
      {album.length > 0 && (
        <div className={`attachment-album attachment-album--${Math.min(album.length, 5)}`}>
          {album.map((a, i) => (
            <ImageAttachment
              key={a.id}
              pointer={a}
              alt={alts?.[a.id]}
              tile={albumTile(album.length, i)}
              onOpen={() => setOpen(a)}
            />
          ))}
        </div>
      )}
      {attachments.map((a) =>
        album.includes(a) ? null : INLINE_IMAGE.has(a.mime) ? (
          <ImageAttachment key={a.id} pointer={a} alt={alts?.[a.id]} onOpen={() => setOpen(a)} />
        ) : INLINE_VIDEO.has(a.mime) || INLINE_AUDIO.has(a.mime) ? (
          <MediaAttachment key={a.id} pointer={a} />
        ) : (
          <FileCard key={a.id} pointer={a} />
        ),
      )}
      {open && (
        <Lightbox
          key={open.id}
          pointer={open}
          gallery={gallery}
          onNavigate={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** The shape of picture `i` of `n` in an album grid: the first of three is wide, the rest square. */
export function albumTile(n: number, i: number): number {
  return n === 3 && i === 0 ? 2 : 1;
}

function ImageAttachment({
  pointer,
  alt,
  tile,
  onOpen,
}: {
  pointer: AttachmentPointer;
  alt?: string;
  /** In an album: fills its grid cell at this aspect ratio. */
  tile?: number;
  onOpen(): void;
}): ReactElement {
  const [ref, visible] = useVisible();
  const [manual, setManual] = useState(false);
  const { url, error } = useDecrypted(pointer, (visible && pointer.size <= AUTO_LOAD_BYTES) || manual);
  const ratio = tile ?? (pointer.width && pointer.height ? pointer.width / pointer.height : 4 / 3);
  // Stickers (2.10.10) are small and drawn without a frame.
  const sticker = !tile && isStickerFile(pointer.name, pointer.mime);
  const width = tile
    ? '100%'
    : Math.max(64, Math.min(sticker ? 160 : 400, pointer.width ?? 400, (sticker ? 160 : 300) * ratio));
  return (
    // The star sits beside the picture (not inside its button), so controls are never nested.
    <div className={`attachment-image-wrap ${tile === 2 ? 'is-wide' : ''}`} style={{ width }}>
      <div
        ref={ref}
        className={`attachment-image ${sticker ? 'attachment-image--sticker' : ''}`}
        style={{ width, aspectRatio: String(ratio) }}
        role="button"
        tabIndex={0}
        aria-label={
          alt ? tr('Image: {description}', { description: alt }) : tr('Image {name}', { name: pointer.name })
        }
        onClick={() => (url ? onOpen() : setManual(true))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (url) onOpen();
            else setManual(true);
          }
        }}
      >
        {pointer.thumb && !url && <img className="attachment-image__thumb" src={pointer.thumb} alt="" />}
        {url && (
          // Decoded off the main thread: a big photo arriving never stalls scrolling.
          <img
            className="attachment-image__full"
            src={url}
            alt={alt || pointer.name}
            draggable={false}
            decoding="async"
          />
        )}
        {alt && (
          <span className="attachment-image__alt" title={alt}>
            {tr('ALT')}
          </span>
        )}
        {!url && !error && (visible || manual) && <span className="attachment-image__spinner" />}
        {!url && !error && !manual && pointer.size > AUTO_LOAD_BYTES && (
          <span className="attachment-image__hint">
            {tr('Click to load · {size}', { size: formatBytes(pointer.size) })}
          </span>
        )}
        {error && <span className="attachment-image__hint attachment-image__hint--error">{error}</span>}
      </div>
      {url && <FavoriteStar pointer={pointer} />}
    </div>
  );
}

function MediaAttachment({ pointer }: { pointer: AttachmentPointer }): ReactElement {
  const voice = isVoiceMessage(pointer.name, pointer.mime);
  // Voice messages are small and meant to be played at once: decrypted right away.
  const [load, setLoad] = useState(voice);
  const { url, error } = useDecrypted(pointer, load);
  const video = INLINE_VIDEO.has(pointer.mime);
  if (voice && url) return <VoiceNote url={url} name={pointer.name} />;
  return (
    <div className={`attachment-media ${video ? 'attachment-media--video' : ''}`}>
      {url ? (
        video ? (
          <SpeedVideo url={url} name={pointer.name} />
        ) : (
          <audio src={url} controls aria-label={pointer.name} />
        )
      ) : (
        <button className="attachment-media__load" onClick={() => setLoad(true)} disabled={load && !error}>
          <span className="attachment-media__icon">{video ? '▶' : '♪'}</span>
          <span>
            <strong>{pointer.name}</strong>
            <span className="muted small">
              {error ??
                (load
                  ? tr('Decrypting…')
                  : `${video ? tr('Video') : tr('Audio')} · ${formatBytes(pointer.size)}`)}
            </span>
          </span>
        </button>
      )}
      <button className="btn btn--link attachment-media__save" onClick={() => void saveAttachment(pointer)}>
        {tr('Save')}
      </button>
    </div>
  );
}

const VIDEO_SPEEDS = [1, 1.5, 2, 0.5] as const;

/** A video with a playback-speed button (2.7). */
function SpeedVideo({ url, name }: { url: string; name: string }): ReactElement {
  const ref = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState<(typeof VIDEO_SPEEDS)[number]>(1);
  return (
    <div className="speed-video">
      <video ref={ref} src={url} controls playsInline aria-label={name} />
      <button
        type="button"
        className="speed-video__speed"
        aria-label={tr('Playback speed {speed}×', { speed })}
        title={tr('Playback speed')}
        onClick={() => {
          const n = VIDEO_SPEEDS[(VIDEO_SPEEDS.indexOf(speed) + 1) % VIDEO_SPEEDS.length]!;
          setSpeed(n);
          if (ref.current) ref.current.playbackRate = n;
        }}
      >
        {speed}×
      </button>
    </div>
  );
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx', 'odt', 'txt', 'md', 'rtf'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return '📽️';
  if (['exe', 'msi', 'dmg', 'app', 'sh', 'bat', 'cmd', 'ps1', 'apk', 'deb', 'rpm'].includes(ext)) return '⚠️';
  return '📎';
}

function FileCard({ pointer }: { pointer: AttachmentPointer }): ReactElement {
  const [busy, setBusy] = useState(false);
  const icon = fileIcon(pointer.name);
  return (
    <div className="file-card">
      <span className="file-card__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="file-card__text">
        <strong title={pointer.name}>{pointer.name}</strong>
        <span className="muted small">
          {formatBytes(pointer.size)}
          {icon === '⚠️' ? ` · ${tr('program — only run it if you trust the sender')}` : ''}
        </span>
      </span>
      <button
        className="btn btn--ghost btn--small"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void saveAttachment(pointer).finally(() => setBusy(false));
        }}
      >
        {busy ? tr('Decrypting…') : tr('Save')}
      </button>
    </div>
  );
}

/** The next zoom level for the image viewer: wheel and keys step by 25 %, from 100 % to 800 %. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const next = Math.round(scale * (direction > 0 ? 1.25 : 0.8) * 100) / 100;
  return Math.min(8, Math.max(1, next));
}

function Lightbox({
  pointer,
  gallery = [],
  onNavigate,
  onClose,
}: {
  pointer: AttachmentPointer;
  gallery?: AttachmentPointer[];
  onNavigate?(next: AttachmentPointer): void;
  onClose(): void;
}): ReactElement {
  // Pictures you move to may not be loaded yet: decrypted here when needed.
  const { url } = useDecrypted(pointer, true);
  const index = gallery.findIndex((a) => a.id === pointer.id);
  const prev = index > 0 ? gallery[index - 1] : undefined;
  const next = index >= 0 && index < gallery.length - 1 ? gallery[index + 1] : undefined;
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const dragFrom = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const zoom = (direction: 1 | -1): void => {
    setScale((s) => {
      const next = stepZoom(s, direction);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };
  // Escape (and the phone's Back button) closes the viewer, before whatever it was opened from.
  useOverlayLayer(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft' && prev) onNavigate?.(prev);
      else if (e.key === 'ArrowRight' && next) onNavigate?.(next);
      else if (e.key === '+' || e.key === '=') zoom(1);
      else if (e.key === '-') zoom(-1);
      else if (e.key === '0') {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNavigate, prev, next]);
  const copy = async (): Promise<void> => {
    if (!url) return;
    try {
      // Redraw the decrypted image as PNG (the format the clipboard takes everywhere).
      const png = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d')!.drawImage(img, 0, 0);
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('convert'))), 'image/png');
        };
        img.onerror = () => reject(new Error('load'));
        img.src = url;
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      useCommunity.getState().notify(tr('River could not copy this image.'), 'error');
    }
  };
  // Rendered into <body>, not inside the message: the message's swipe and taps stay out of it.
  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-label={pointer.name}
      onClick={onClose}
      onTouchStart={(e) => {
        const t = e.touches[0];
        swipe.current = scale <= 1 && t && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const s = swipe.current;
        const t = e.changedTouches[0];
        swipe.current = null;
        if (!s || !t) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        // Sideways: next or previous picture; down: close, like a photo app.
        if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
          const to = dx < 0 ? next : prev;
          if (to) onNavigate?.(to);
        } else if (dy > 120 && Math.abs(dy) > 2 * Math.abs(dx)) onClose();
      }}
    >
      {gallery.length > 1 && index >= 0 && (
        <>
          <span className="lightbox__count" aria-live="polite">
            {index + 1} / {gallery.length}
          </span>
          {prev && (
            <button
              className="lightbox__nav lightbox__nav--prev"
              aria-label={tr('Previous picture')}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.(prev);
              }}
            >
              ‹
            </button>
          )}
          {next && (
            <button
              className="lightbox__nav lightbox__nav--next"
              aria-label={tr('Next picture')}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.(next);
              }}
            >
              ›
            </button>
          )}
        </>
      )}
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <span>{pointer.name}</span>
        <span className="muted small">{formatBytes(pointer.size)}</span>
        <span className="muted small lightbox__zoom" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <button
          className="icon-btn"
          aria-label={tr('Zoom out')}
          disabled={scale <= 1}
          onClick={() => zoom(-1)}
        >
          −
        </button>
        <button className="icon-btn" aria-label={tr('Zoom in')} disabled={scale >= 8} onClick={() => zoom(1)}>
          +
        </button>
        {pointer.mime.startsWith('image/') && (
          <button className="btn btn--ghost btn--small" onClick={() => void copy()}>
            {copied ? tr('Copied') : tr('Copy image')}
          </button>
        )}
        <button className="btn btn--ghost btn--small" onClick={() => void saveAttachment(pointer)}>
          {tr('Save')}
        </button>
        <button className="icon-btn" aria-label={tr('Close')} onClick={onClose}>
          <XIcon />
        </button>
      </div>
      {url && (
        <img
          src={url}
          alt={pointer.name}
          draggable={false}
          className={scale > 1 ? 'is-zoomed' : ''}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (scale > 1) {
              setScale(1);
              setOffset({ x: 0, y: 0 });
            } else setScale(2);
          }}
          onWheel={(e) => zoom(e.deltaY < 0 ? 1 : -1)}
          onPointerDown={(e) => {
            if (scale <= 1) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            dragFrom.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          }}
          onPointerMove={(e) => {
            const d = dragFrom.current;
            if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
          }}
          onPointerUp={() => {
            dragFrom.current = null;
          }}
        />
      )}
    </div>,
    document.body,
  );
}

// ---- sending -------------------------------------------------------------------------------------

export interface PendingFile {
  key: string;
  file: File;
  preview: string | null;
  /** A description of the picture for people who cannot see it (1.0.21). */
  alt?: string;
}

export function pendingFrom(files: Iterable<File>): PendingFile[] {
  return [...files].map((file) => ({
    key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
    file,
    preview: INLINE_IMAGE.has(file.type) ? URL.createObjectURL(file) : null,
  }));
}

/** Frees the previews of files that are no longer waiting to be sent. */
export function dropPreviews(files: Iterable<PendingFile>): void {
  for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
}

/** At most this many files go with one message. */
export const MAX_PENDING = 10;

/** Files waiting to be sent, per channel or conversation, while River is open (like drafts). */
const pendingStore = new Map<string, PendingFile[]>();

/**
 * The files waiting in one channel's or conversation's message box. They stay when you switch
 * away and back (2.10.12); a file removed, sent or over the limit has its preview freed.
 * `add` returns how many did not fit.
 */
export function usePendingFiles(key: string): {
  pending: PendingFile[];
  setPending(next: PendingFile[]): void;
  add(files: Iterable<File>): number;
} {
  const [pending, setState] = useState<PendingFile[]>(() => pendingStore.get(key) ?? []);
  const current = useRef(pending);
  const setPending = useCallback(
    (next: PendingFile[]): void => {
      const kept = new Set(next.map((p) => p.key));
      dropPreviews(current.current.filter((p) => !kept.has(p.key)));
      current.current = next;
      if (next.length) pendingStore.set(key, next);
      else pendingStore.delete(key);
      setState(next);
    },
    [key],
  );
  const add = useCallback(
    (files: Iterable<File>): number => {
      const next = [...current.current, ...pendingFrom(files)];
      const over = next.slice(MAX_PENDING);
      dropPreviews(over);
      setPending(next.slice(0, MAX_PENDING));
      return over.length;
    },
    [setPending],
  );
  return { pending, setPending, add };
}

/** Reads a chosen file and, for images, measures it and makes a tiny blurred preview. */
async function prepare(file: File): Promise<{
  name: string;
  mime: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  thumb?: string;
}> {
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new Error(
      tr('{name} is larger than {size}.', { name: file.name, size: formatBytes(MAX_ATTACHMENT_BYTES) }),
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base = { name: file.name || 'file', mime: file.type || 'application/octet-stream', bytes };
  if (!INLINE_IMAGE.has(file.type)) return base;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = 24 / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumb = canvas.toDataURL('image/webp', 0.5);
    const result = {
      ...base,
      width: bitmap.width,
      height: bitmap.height,
      ...(thumb.startsWith('data:image/webp') && thumb.length < 3000 ? { thumb } : {}),
    };
    bitmap.close();
    return result;
  } catch {
    return base;
  }
}

/** Encrypts and uploads files one by one; returns their pointers. */
/** Thrown when the person cancels an upload. */
export class UploadCancelled extends Error {
  constructor() {
    super(tr('Upload cancelled.'));
  }
}

export async function uploadAll(
  files: PendingFile[],
  onProgress: (done: number) => void,
  via: 'community' | 'dm' = 'community',
  signal?: AbortSignal,
): Promise<AttachmentPointer[]> {
  const pointers: AttachmentPointer[] = [];
  for (const [i, p] of files.entries()) {
    // A file already on its way finishes (the server forgets unused uploads); nothing after it starts.
    if (signal?.aborted) throw new UploadCancelled();
    const prepared = await prepare(p.file);
    const res =
      via === 'dm'
        ? await window.river.dm.action({ a: 'upload', ...prepared })
        : await window.river.community.action({ a: 'upload', ...prepared });
    if (!res.ok) throw new Error(res.message);
    pointers.push(res.value as AttachmentPointer);
    onProgress(i + 1);
  }
  if (signal?.aborted) throw new UploadCancelled();
  return pointers;
}

export function PendingFiles(props: {
  files: PendingFile[];
  onRemove(key: string): void;
  /** Lets pictures get a description (alt text). */
  onAlt?(key: string, alt: string): void;
}): ReactElement {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="pending-files">
      {props.files.map((p) => (
        <div key={p.key} className="pending-file">
          {p.preview && props.onAlt && (
            <button
              type="button"
              className={`pending-file__alt ${p.alt ? 'is-set' : ''}`}
              title={
                p.alt
                  ? tr('Description: {description}', { description: p.alt })
                  : tr('Describe this picture for people who cannot see it')
              }
              aria-label={
                p.alt
                  ? tr('Edit description of {name}', { name: p.file.name })
                  : tr('Describe {name}', { name: p.file.name })
              }
              onClick={() => setEditing(editing === p.key ? null : p.key)}
            >
              {tr('ALT')}
            </button>
          )}
          {editing === p.key && props.onAlt && (
            <textarea
              className="pending-file__alt-input"
              autoFocus
              rows={3}
              maxLength={1000}
              placeholder={tr('Describe this picture')}
              aria-label={tr('Description of {name}', { name: p.file.name })}
              defaultValue={p.alt ?? ''}
              onBlur={(e) => {
                props.onAlt!(p.key, e.target.value.trim());
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(null);
                }
              }}
            />
          )}
          {p.preview ? (
            <img src={p.preview} alt="" />
          ) : (
            <span className="pending-file__icon">{fileIcon(p.file.name)}</span>
          )}
          <span className="pending-file__name" title={p.file.name}>
            {p.file.name}
          </span>
          <span className="muted small">{formatBytes(p.file.size)}</span>
          <button
            className="pending-file__x"
            aria-label={tr('Remove {name}', { name: p.file.name })}
            onClick={() => props.onRemove(p.key)}
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
