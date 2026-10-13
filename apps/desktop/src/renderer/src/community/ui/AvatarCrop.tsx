import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { Modal } from './common.tsx';

const VIEW = 240;
const OUT = 128;

/** Where the picture sits in the round frame: never leaving a gap at the edges (pure, for tests). */
export function clampOffset(
  offset: { x: number; y: number },
  size: { w: number; h: number },
  zoom: number,
  view = VIEW,
): { x: number; y: number } {
  const base = view / Math.min(size.w, size.h);
  const w = size.w * base * zoom;
  const h = size.h * base * zoom;
  const maxX = Math.max(0, (w - view) / 2);
  const maxY = Math.max(0, (h - view) / 2);
  return { x: Math.max(-maxX, Math.min(maxX, offset.x)), y: Math.max(-maxY, Math.min(maxY, offset.y)) };
}

/** Drag to position, slide to zoom, then Save: a 128 px square picture (1.0.25). */
export function AvatarCropDialog(props: {
  file: File;
  onDone(avatar: string): void;
  onClose(): void;
}): ReactElement {
  // The picture is decoded straight into a bitmap and drawn on canvases: no URL of it ever enters the page.
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState(false);
  const size = bitmap ? { w: bitmap.width, h: bitmap.height } : null;
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void createImageBitmap(props.file).then(
      (b) => (alive ? setBitmap(b) : b.close()),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [props.file]);
  const base = size ? VIEW / Math.min(size.w, size.h) : 1;
  /** Draws the picture as framed into a square canvas of `side` pixels. */
  const draw = (canvas: HTMLCanvasElement, side: number): void => {
    if (!bitmap || !size) return;
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = (base * zoom * side) / VIEW;
    const w = size.w * scale;
    const h = size.h * scale;
    const k = side / VIEW;
    ctx.clearRect(0, 0, side, side);
    ctx.drawImage(bitmap, (side - w) / 2 + offset.x * k, (side - h) / 2 + offset.y * k, w, h);
  };
  useEffect(() => {
    if (previewRef.current) draw(previewRef.current, VIEW);
  });
  const save = (): void => {
    if (!bitmap) return;
    const canvas = document.createElement('canvas');
    draw(canvas, OUT);
    const webp = canvas.toDataURL('image/webp', 0.85);
    props.onDone(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current || !size) return;
    const d = drag.current;
    setOffset(clampOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }, size, zoom));
  };
  return (
    <Modal title="Position your picture" onClose={props.onClose}>
      <div
        className="avatar-crop"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label="Drag to position your picture"
      >
        <canvas ref={previewRef} width={VIEW} height={VIEW} />
      </div>
      {failed && <p className="field__error">River could not read that picture.</p>}
      <label className="avatar-crop__zoom">
        <span className="field__label">Zoom</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => {
            const z = Number(e.target.value);
            setZoom(z);
            if (size) setOffset((o) => clampOffset(o, size, z));
          }}
        />
      </label>
      <div className="modal__foot">
        <button className="btn btn--link" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={!size} onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}

/** Small animated GIFs stay animated as avatars (1.0.34); anything larger is cropped to a still. */
export const KEEP_GIF_BYTES = 44_000;

/** A data URL of a small, real GIF to use as is, or null to crop it like any picture (pure, for tests). */
export function animatedAvatar(bytes: Uint8Array): string | null {
  if (bytes.length > KEEP_GIF_BYTES) return null;
  const magic = String.fromCharCode(...bytes.subarray(0, 6));
  if (magic !== 'GIF87a' && magic !== 'GIF89a') return null;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/gif;base64,${btoa(binary)}`;
}

export async function keepAnimated(file: File): Promise<string | null> {
  if (file.type !== 'image/gif' || file.size > KEEP_GIF_BYTES) return null;
  return animatedAvatar(new Uint8Array(await file.arrayBuffer()));
}
