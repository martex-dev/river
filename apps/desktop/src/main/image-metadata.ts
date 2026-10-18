/**
 * Photos lose their hidden metadata before they are encrypted and sent (2.13): the place they were
 * taken (GPS), the camera and its serial number, the time, editing software, embedded thumbnails
 * and descriptions. JPEG (Exif and XMP in APP1, IPTC in APP13, comments, other APPn blocks and
 * images appended after the photo), PNG (text chunks, eXIf, tIME) and WebP (EXIF, XMP).
 *
 * The picture itself is not touched (no re-encoding): colour profiles and everything needed to
 * decode it are kept. Only the orientation is carried over, as a minimal Exif block, so a photo
 * taken sideways is still shown upright. A file River cannot parse is sent as it is.
 * Other files (videos, documents) are never changed.
 */

const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u32le = (b: Uint8Array, i: number): number =>
  ((b[i + 3]! << 24) | (b[i + 2]! << 16) | (b[i + 1]! << 8) | b[i]!) >>> 0;

/** The Exif orientation (1–8) in a TIFF block, or null. */
export function tiffOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const r16 = (i: number): number => (little ? tiff[i]! | (tiff[i + 1]! << 8) : u16be(tiff, i));
  const r32 = (i: number): number => (little ? u32le(tiff, i) : u32be(tiff, i));
  if (r16(2) !== 42) return null;
  const ifd = r32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = r16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > tiff.length) return null;
    if (r16(e) === 0x0112 && r16(e + 2) === 3) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A TIFF block holding only the orientation (big-endian, one IFD entry). */
export function orientationTiff(orientation: number): Uint8Array {
  return Uint8Array.from([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // "MM", 42, IFD0 at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    orientation >> 8,
    orientation & 0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ]);
}

const EXIF_HEADER = Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
const startsWith = (b: Uint8Array, prefix: Uint8Array, at = 0): boolean =>
  b.length >= at + prefix.length && prefix.every((x, i) => b[at + i] === x);
const ICC = new TextEncoder().encode('ICC_PROFILE\0');
const ADOBE = new TextEncoder().encode('Adobe');
const JFIF = new TextEncoder().encode('JFIF\0');

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

class Unparsable extends Error {}

function stripJpeg(src: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [src.subarray(0, 2)];
  let orientation: number | null = null;
  let i = 2;
  let exifAt = -1;
  for (;;) {
    if (i + 4 > src.length || src[i] !== 0xff) throw new Unparsable();
    const marker = src[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    const length = u16be(src, i + 2);
    if (length < 2 || i + 2 + length > src.length) throw new Unparsable();
    const segment = src.subarray(i, i + 2 + length);
    const data = src.subarray(i + 4, i + 2 + length);
    if (marker === 0xda) {
      // Start of scan: the image data follows. Keep it up to the end of this picture (EOI);
      // anything appended after it (extra images, often with their own metadata) is dropped.
      let j = i + 2 + length;
      for (;;) {
        if (j + 1 >= src.length) throw new Unparsable();
        if (src[j] !== 0xff) {
          j++;
          continue;
        }
        const b = src[j + 1]!;
        if (b === 0xd9) {
          j += 2;
          break;
        }
        if (b === 0x00 || b === 0xff || (b >= 0xd0 && b <= 0xd7)) {
          j += b === 0xff ? 1 : 2;
          continue;
        }
        // Another segment between scans (progressive JPEGs): skip it whole.
        if (j + 4 > src.length) throw new Unparsable();
        j += 2 + u16be(src, j + 2);
      }
      if (exifAt >= 0 && orientation && orientation !== 1) {
        const tiff = orientationTiff(orientation);
        const app1 = concat([Uint8Array.from([0xff, 0xe1, 0, 2 + 6 + tiff.length]), EXIF_HEADER, tiff]);
        parts.splice(exifAt, 0, app1);
      }
      parts.push(src.subarray(i, j));
      return concat(parts);
    }
    let keep: boolean;
    if (marker === 0xe1) {
      // Exif or XMP: dropped; the orientation is remembered.
      if (startsWith(data, EXIF_HEADER)) orientation ??= tiffOrientation(data.subarray(6));
      if (exifAt < 0) exifAt = parts.length;
      keep = false;
    } else if (marker === 0xe0) keep = startsWith(data, JFIF);
    else if (marker === 0xe2)
      keep = startsWith(data, ICC); // colour profile; MPF and others go
    else if (marker === 0xee)
      keep = startsWith(data, ADOBE); // needed to decode some colour spaces
    else if (marker >= 0xe3 && marker <= 0xef)
      keep = false; // other application blocks (IPTC: APP13)
    else if (marker === 0xfe)
      keep = false; // comment
    else keep = true; // tables, frame headers, restart intervals…
    if (keep) parts.push(segment);
    i += 2 + length;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** PNG's chunk checksum (CRC-32, ISO 3309): an integrity check, not cryptography. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  head.set(new TextEncoder().encode(type), 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concat([head.subarray(4), data])));
  return concat([head, data, crc]);
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(src: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [src.subarray(0, 8)];
  let i = 8;
  for (;;) {
    if (i + 12 > src.length) throw new Unparsable();
    const length = u32be(src, i);
    const type = String.fromCharCode(...src.subarray(i + 4, i + 8));
    const end = i + 12 + length;
    if (end > src.length) throw new Unparsable();
    if (type === 'eXIf') {
      const o = tiffOrientation(src.subarray(i + 8, i + 8 + length));
      if (o && o !== 1) parts.push(pngChunk('eXIf', orientationTiff(o)));
    } else if (!PNG_DROP.has(type)) parts.push(src.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(parts);
  }
}

const fourcc = (b: Uint8Array, i: number): string => String.fromCharCode(...b.subarray(i, i + 4));

function stripWebp(src: Uint8Array): Uint8Array {
  if (u32le(src, 4) + 8 > src.length) throw new Unparsable();
  const chunks: Uint8Array[] = [];
  let vp8x = -1;
  let orientation: number | null = null;
  let i = 12;
  const end = u32le(src, 4) + 8;
  while (i < end) {
    if (i + 8 > end) throw new Unparsable();
    const id = fourcc(src, i);
    const size = u32le(src, i + 4);
    const next = i + 8 + size + (size & 1);
    if (i + 8 + size > end) throw new Unparsable();
    if (id === 'EXIF') {
      let data = src.subarray(i + 8, i + 8 + size);
      if (startsWith(data, EXIF_HEADER)) data = data.subarray(6);
      orientation = tiffOrientation(data);
    } else if (id !== 'XMP ') {
      if (id === 'VP8X') vp8x = chunks.length;
      // A last chunk of odd size may lack its padding byte: add it, so chunks after it line up.
      chunks.push(next > end ? concat([src.subarray(i, end), new Uint8Array(1)]) : src.subarray(i, next));
    }
    i = next;
  }
  let exifFlag = false;
  if (orientation && orientation !== 1 && vp8x >= 0) {
    const tiff = orientationTiff(orientation);
    const head = new Uint8Array(8);
    head.set(new TextEncoder().encode('EXIF'));
    new DataView(head.buffer).setUint32(4, tiff.length, true);
    chunks.push(concat([head, tiff]));
    exifFlag = true;
  }
  if (vp8x >= 0) {
    const copy = new Uint8Array(chunks[vp8x]!);
    copy[8] = (copy[8]! & ~0x0c) | (exifFlag ? 0x08 : 0); // EXIF (0x08) and XMP (0x04) flags
    chunks[vp8x] = copy;
  }
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(src.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  return concat([head, body]);
}

/** The photo without its metadata, or the bytes unchanged if they are not a photo River can clean. */
export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  try {
    if (mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return stripJpeg(bytes);
    if (mime === 'image/png' && startsWith(bytes, PNG_SIGNATURE)) return stripPng(bytes);
    if (mime === 'image/webp' && fourcc(bytes, 0) === 'RIFF' && fourcc(bytes, 8) === 'WEBP')
      return stripWebp(bytes);
  } catch (err) {
    if (!(err instanceof Unparsable) && !(err instanceof RangeError)) throw err;
  }
  return bytes;
}
