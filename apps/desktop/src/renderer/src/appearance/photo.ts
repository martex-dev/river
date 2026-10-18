/**
 * Wallpaper photos (2.18), all on this device: a chosen photo is shrunk once (at most 1600 px,
 * JPEG) before it is kept in the settings, and blurred copies are drawn on demand in memory.
 * Nothing here uploads anything.
 */

/** The longest side a kept wallpaper photo has. */
export const PHOTO_MAX_SIDE = 1600;
/** Photos larger than this are refused before they are even read. */
export const PHOTO_MAX_INPUT = 20_000_000;
const KEPT = /^data:image\/(png|jpeg|webp);base64,/;

/** The size a picture is drawn at so its longest side is at most `max` (never enlarged). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(1, width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That picture could not be read.'));
    img.src = src;
  });
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This device cannot prepare pictures.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

/** A photo the person picked, made ready to keep: shrunk and saved as JPEG (a few hundred KB). */
export async function preparePhoto(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.');
  if (file.size > PHOTO_MAX_INPUT) throw new Error('That picture is larger than 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await load(url);
    const size = fitWithin(img.naturalWidth, img.naturalHeight, PHOTO_MAX_SIDE);
    const [c, ctx] = canvas(size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    for (const quality of [0.85, 0.75, 0.6]) {
      const out = c.toDataURL('image/jpeg', quality);
      if (KEPT.test(out) && out.length < 1_400_000) return out;
    }
    throw new Error('That picture is too detailed to keep. Choose another.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const blurred = new Map<string, Promise<string>>();

/**
 * A blurred copy of a photo, drawn small and scaled back up (soft, cheap, and the same on every
 * platform, including WebViews without canvas filters). Kept in memory for the photos in use.
 */
export function blurPhoto(src: string, px: number): Promise<string> {
  const amount = Math.max(0, Math.min(24, Math.round(px)));
  if (amount === 0) return Promise.resolve(src);
  const key = `${amount}:${src.length}:${src.slice(-64)}`;
  const hit = blurred.get(key);
  if (hit) return hit;
  const job = (async () => {
    const img = await load(src);
    const out = fitWithin(img.naturalWidth, img.naturalHeight, 900);
    // Each pass halves the detail; more blur, smaller drawing.
    const factor = 1 + amount / 3;
    const small = fitWithin(out.width / factor, out.height / factor, 900);
    const [s, sctx] = canvas(small.width, small.height);
    sctx.drawImage(img, 0, 0, small.width, small.height);
    const [c, ctx] = canvas(out.width, out.height);
    if ('filter' in ctx) ctx.filter = `blur(${Math.round(amount / factor)}px)`;
    ctx.drawImage(s, 0, 0, out.width, out.height);
    return c.toDataURL('image/jpeg', 0.8);
  })();
  blurred.set(key, job);
  job.catch(() => blurred.delete(key));
  // Only the last few photos are kept blurred in memory.
  while (blurred.size > 6) blurred.delete(blurred.keys().next().value!);
  return job;
}
