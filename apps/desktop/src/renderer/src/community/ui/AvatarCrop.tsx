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
  // Only ever a blob: URL made here from the chosen file.
  const [url] = useState(() => {
    const made = URL.createObjectURL(props.file);
    return made.startsWith('blob:') ? made : '';
  });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const base = size ? VIEW / Math.min(size.w, size.h) : 1;
  const save = (): void => {
    const img = imgRef.current;
    if (!img || !size) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUT;
    const ctx = canvas.getContext('2d')!;
    const scale = (base * zoom * OUT) / VIEW;
    const w = size.w * scale;
    const h = size.h * scale;
    const k = OUT / VIEW;
    ctx.drawImage(img, (OUT - w) / 2 + offset.x * k, (OUT - h) / 2 + offset.y * k, w, h);
    props.onDone(
      canvas.toDataURL('image/webp', 0.85).startsWith('data:image/webp')
        ? canvas.toDataURL('image/webp', 0.85)
        : canvas.toDataURL('image/png'),
    );
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
        <img
          ref={imgRef}
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={
            size
              ? {
                  width: size.w * base * zoom,
                  height: size.h * base * zoom,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }
              : { visibility: 'hidden' }
          }
        />
      </div>
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
