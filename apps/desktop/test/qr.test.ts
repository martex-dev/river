import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { friendLink, parseFriend } from '../src/shared/invite-link.ts';

/** Draws a QR code the way River shows it (dark on white, quiet zone) into RGBA pixels. */
function pixels(value: string, scale = 4): { data: Uint8ClampedArray; size: number } {
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  const n = qr.getModuleCount() + 8;
  const size = n * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / scale) - 4;
      const col = Math.floor(x / scale) - 4;
      const dark = row >= 0 && col >= 0 && row < n - 8 && col < n - 8 && qr.isDark(row, col);
      if (dark) data.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
    }
  }
  return { data, size };
}

describe('friend QR codes', () => {
  it('the scanner reads back the friend link River shows', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const link = friendLink('https://river.example.net/', id);
    const { data, size } = pixels(link);
    const read = jsQR(data, size, size);
    expect(read?.data).toBe(link);
    expect(parseFriend(read!.data)).toEqual({ riverId: id, serverUrl: 'https://river.example.net' });
  });
});
