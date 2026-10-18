import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import { orientationTiff, stripImageMetadata, tiffOrientation } from '../src/main/image-metadata.ts';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const cat = (...parts: Array<Uint8Array | number[]>): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => [...p]));
const has = (bytes: Uint8Array, s: string): boolean => Buffer.from(bytes).includes(Buffer.from(s));
const seg = (marker: number, data: Uint8Array): Uint8Array =>
  cat([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff], data);

/** Exif (little-endian, as phones write it) with an orientation and a fake GPS block. */
function exif(orientation: number): Uint8Array {
  const tiff = cat(
    [0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0],
    [0x01, 0x00],
    [0x12, 0x01, 0x03, 0x00, 0x01, 0, 0, 0, orientation, 0, 0, 0],
    [0, 0, 0, 0],
    text('GPS 42.6977N 23.3219E Pixel 9 serial 1234'),
  );
  return cat(text('Exif\0\0'), tiff);
}

function jpeg(orientation: number): Uint8Array {
  return cat(
    [0xff, 0xd8],
    seg(0xe0, cat(text('JFIF\0'), [1, 1, 0, 0, 1, 0, 1, 0, 0])),
    seg(0xe1, exif(orientation)),
    seg(0xe1, text('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Creator: Ana</x:xmpmeta>')),
    seg(0xe2, cat(text('ICC_PROFILE\0'), [1, 1, 9, 9])),
    seg(0xed, text('Photoshop 3.0\0IPTC caption: at home')),
    seg(0xfe, text('comment: secret')),
    seg(
      0xdb,
      Uint8Array.from({ length: 65 }, (_, i) => i),
    ),
    seg(0xc0, Uint8Array.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    seg(0xda, Uint8Array.from([1, 1, 0, 0, 0x3f, 0])),
    [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56], // entropy data with a stuffed byte and a restart
    [0xff, 0xd9],
    text('APPENDED IMAGE WITH ITS OWN GPS'),
  );
}

describe('photo metadata is removed before sending (2.13)', () => {
  it('JPEG: drops Exif, XMP, IPTC, comments and appended data; keeps the picture and orientation', () => {
    const out = stripImageMetadata(jpeg(6), 'image/jpeg');
    for (const secret of ['GPS', 'serial', 'xmpmeta', 'IPTC', 'comment', 'APPENDED'])
      expect(has(out, secret)).toBe(false);
    expect(has(out, 'JFIF')).toBe(true);
    expect(has(out, 'ICC_PROFILE')).toBe(true);
    // Ends with the image data and EOI, unchanged.
    expect([...out.subarray(-9)]).toEqual([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9]);
    // The orientation survives in a minimal Exif block.
    const at = Buffer.from(out).indexOf(Buffer.from('Exif\0\0'));
    expect(at).toBeGreaterThan(0);
    expect(tiffOrientation(out.subarray(at + 6))).toBe(6);
    expect(out[at - 4]).toBe(0xff);
    expect(out[at - 3]).toBe(0xe1);
  });

  it('JPEG: an upright photo gets no Exif block at all', () => {
    expect(has(stripImageMetadata(jpeg(1), 'image/jpeg'), 'Exif')).toBe(false);
  });

  it('PNG: drops text, time and eXIf chunks; checksums stay valid', () => {
    const chunk = (type: string, data: Uint8Array): Uint8Array => {
      const body = cat(text(type), data);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return cat(len, body, crc);
    };
    const png = cat(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      chunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
      chunk('tEXt', text('Author\0Ana at Main Street 5')),
      chunk('eXIf', exif(8).subarray(6)),
      chunk('tIME', Uint8Array.from([7, 234, 10, 18, 12, 0, 0])),
      chunk('IDAT', Uint8Array.from([1, 2, 3])),
      chunk('IEND', new Uint8Array()),
    );
    const out = stripImageMetadata(png, 'image/png');
    expect(has(out, 'Main Street')).toBe(false);
    expect(has(out, 'GPS')).toBe(false);
    expect(has(out, 'tIME')).toBe(false);
    // Walk the chunks: every CRC is right, the orientation is kept.
    const types: string[] = [];
    for (let i = 8; i < out.length;) {
      const len = Buffer.from(out).readUInt32BE(i);
      const body = out.subarray(i + 4, i + 8 + len);
      expect(Buffer.from(out).readUInt32BE(i + 8 + len)).toBe(crc32(body));
      const type = Buffer.from(body.subarray(0, 4)).toString();
      types.push(type);
      if (type === 'eXIf') expect(tiffOrientation(body.subarray(4))).toBe(8);
      i += 12 + len;
    }
    expect(types).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
  });

  it('WebP: drops EXIF and XMP and clears their flags', () => {
    const chunk = (id: string, data: Uint8Array): Uint8Array => {
      const size = Buffer.alloc(4);
      size.writeUInt32LE(data.length);
      return cat(text(id), size, data, data.length & 1 ? [0] : []);
    };
    const body = cat(
      text('WEBP'),
      chunk('VP8X', Uint8Array.from([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
      chunk('VP8L', Uint8Array.from([0x2f, 1, 2, 3, 4])),
      chunk('EXIF', exif(1)),
      chunk('XMP ', text('<x:xmpmeta>Creator: Ana</x:xmpmeta>')),
    );
    const size = Buffer.alloc(4);
    size.writeUInt32LE(body.length);
    const out = stripImageMetadata(cat(text('RIFF'), size, body), 'image/webp');
    expect(has(out, 'GPS')).toBe(false);
    expect(has(out, 'xmpmeta')).toBe(false);
    expect(Buffer.from(out).readUInt32LE(4)).toBe(out.length - 8);
    expect(out[20]! & 0x0c).toBe(0);
    expect(has(out, 'VP8L')).toBe(true);
  });

  it('leaves other files, and files it cannot parse, exactly as they are', () => {
    const video = text('....ftypisom GPS +42.69+023.32/');
    expect(stripImageMetadata(video, 'video/mp4')).toBe(video);
    const broken = cat([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff], text('GPS'));
    expect(stripImageMetadata(broken, 'image/jpeg')).toBe(broken);
    const notJpeg = text('GPS but called a jpeg');
    expect(stripImageMetadata(notJpeg, 'image/jpeg')).toBe(notJpeg);
    expect(tiffOrientation(orientationTiff(3))).toBe(3);
  });
});
