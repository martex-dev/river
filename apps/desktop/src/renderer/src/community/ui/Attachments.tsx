import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { AttachmentPointer } from '../../../../shared/community-actions.ts';
import { MAX_ATTACHMENT_BYTES } from '../../../../shared/community-actions.ts';
import { useCommunity } from '../store.ts';
import { XIcon } from './common.tsx';

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

/** Decrypted object URLs for this session, so scrolling back does not re-download. */
const urls = new Map<string, string>();

async function decryptToUrl(pointer: AttachmentPointer): Promise<string> {
  const existing = urls.get(pointer.id);
  if (existing) return existing;
  const res = await window.river.community.action({ a: 'download', pointer });
  if (!res.ok) throw new Error(res.message);
  const type =
    INLINE_IMAGE.has(pointer.mime) || INLINE_VIDEO.has(pointer.mime) || INLINE_AUDIO.has(pointer.mime)
      ? pointer.mime
      : 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([res.value as Uint8Array<ArrayBuffer>], { type }));
  urls.set(pointer.id, url);
  return url;
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
  else if (res.value) useCommunity.getState().notify(`Saved ${pointer.name}`);
}

export function AttachmentList({ attachments }: { attachments: AttachmentPointer[] }): ReactElement {
  const [open, setOpen] = useState<AttachmentPointer | null>(null);
  return (
    <div className="attachments">
      {attachments.map((a) =>
        INLINE_IMAGE.has(a.mime) ? (
          <ImageAttachment key={a.id} pointer={a} onOpen={() => setOpen(a)} />
        ) : INLINE_VIDEO.has(a.mime) || INLINE_AUDIO.has(a.mime) ? (
          <MediaAttachment key={a.id} pointer={a} />
        ) : (
          <FileCard key={a.id} pointer={a} />
        ),
      )}
      {open && <Lightbox pointer={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ImageAttachment({ pointer, onOpen }: { pointer: AttachmentPointer; onOpen(): void }): ReactElement {
  const [ref, visible] = useVisible();
  const [manual, setManual] = useState(false);
  const { url, error } = useDecrypted(pointer, (visible && pointer.size <= AUTO_LOAD_BYTES) || manual);
  const ratio = pointer.width && pointer.height ? pointer.width / pointer.height : 4 / 3;
  const width = Math.max(64, Math.min(400, pointer.width ?? 400, 300 * ratio));
  return (
    <div
      ref={ref}
      className="attachment-image"
      style={{ width, aspectRatio: String(ratio) }}
      role="button"
      tabIndex={0}
      aria-label={`Image ${pointer.name}`}
      onClick={() => (url ? onOpen() : setManual(true))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          if (url) onOpen();
          else setManual(true);
        }
      }}
    >
      {pointer.thumb && !url && <img className="attachment-image__thumb" src={pointer.thumb} alt="" />}
      {url && <img className="attachment-image__full" src={url} alt={pointer.name} draggable={false} />}
      {!url && !error && (visible || manual) && <span className="attachment-image__spinner" />}
      {!url && !error && !manual && pointer.size > AUTO_LOAD_BYTES && (
        <span className="attachment-image__hint">Click to load · {formatBytes(pointer.size)}</span>
      )}
      {error && <span className="attachment-image__hint attachment-image__hint--error">{error}</span>}
    </div>
  );
}

function MediaAttachment({ pointer }: { pointer: AttachmentPointer }): ReactElement {
  const [load, setLoad] = useState(false);
  const { url, error } = useDecrypted(pointer, load);
  const video = INLINE_VIDEO.has(pointer.mime);
  return (
    <div className={`attachment-media ${video ? 'attachment-media--video' : ''}`}>
      {url ? (
        video ? (
          <video src={url} controls playsInline aria-label={pointer.name} />
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
                (load ? 'Decrypting…' : `${video ? 'Video' : 'Audio'} · ${formatBytes(pointer.size)}`)}
            </span>
          </span>
        </button>
      )}
      <button className="btn btn--link attachment-media__save" onClick={() => void saveAttachment(pointer)}>
        Save
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
          {icon === '⚠️' ? ' · program — only run it if you trust the sender' : ''}
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
        {busy ? 'Decrypting…' : 'Save'}
      </button>
    </div>
  );
}

function Lightbox({ pointer, onClose }: { pointer: AttachmentPointer; onClose(): void }): ReactElement {
  const url = urls.get(pointer.id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label={pointer.name} onClick={onClose}>
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <span>{pointer.name}</span>
        <span className="muted small">{formatBytes(pointer.size)}</span>
        <button className="btn btn--ghost btn--small" onClick={() => void saveAttachment(pointer)}>
          Save
        </button>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <XIcon />
        </button>
      </div>
      {url && <img src={url} alt={pointer.name} onClick={(e) => e.stopPropagation()} />}
    </div>
  );
}

// ---- sending -------------------------------------------------------------------------------------

export interface PendingFile {
  key: string;
  file: File;
  preview: string | null;
}

export function pendingFrom(files: Iterable<File>): PendingFile[] {
  return [...files].map((file) => ({
    key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
    file,
    preview: INLINE_IMAGE.has(file.type) ? URL.createObjectURL(file) : null,
  }));
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
    throw new Error(`${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
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
export async function uploadAll(
  files: PendingFile[],
  onProgress: (done: number) => void,
  via: 'community' | 'dm' = 'community',
): Promise<AttachmentPointer[]> {
  const pointers: AttachmentPointer[] = [];
  for (const [i, p] of files.entries()) {
    const prepared = await prepare(p.file);
    const res =
      via === 'dm'
        ? await window.river.dm.action({ a: 'upload', ...prepared })
        : await window.river.community.action({ a: 'upload', ...prepared });
    if (!res.ok) throw new Error(res.message);
    pointers.push(res.value as AttachmentPointer);
    onProgress(i + 1);
  }
  return pointers;
}

export function PendingFiles(props: { files: PendingFile[]; onRemove(key: string): void }): ReactElement {
  return (
    <div className="pending-files">
      {props.files.map((p) => (
        <div key={p.key} className="pending-file">
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
            aria-label={`Remove ${p.file.name}`}
            onClick={() => props.onRemove(p.key)}
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
