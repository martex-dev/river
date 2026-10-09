import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AttachmentIntegrityError,
  decryptAttachment,
  encryptAttachment,
  paddedSize,
} from '../src/attachment.ts';

describe('attachments', () => {
  it('round-trips files of many sizes, including empty', () => {
    for (const size of [0, 1, 15, 16, 541, 542, 4096, 100_000, 1_000_003]) {
      const data = randomBytes(size);
      const enc = encryptAttachment(data);
      expect(enc.key).toHaveLength(64);
      expect(enc.digest).toHaveLength(32);
      expect(enc.size).toBe(size);
      expect(Buffer.from(decryptAttachment(enc.blob, enc))).toEqual(data);
    }
  });

  it('pads to size buckets so the server cannot see the exact size', () => {
    expect(paddedSize(10)).toBe(541);
    expect(encryptAttachment(randomBytes(10)).blob.length).toBe(
      encryptAttachment(randomBytes(500)).blob.length,
    );
    for (const n of [1000, 50_000, 3_000_000]) {
      expect(paddedSize(n)).toBeGreaterThanOrEqual(n);
      expect(paddedSize(n)).toBeLessThanOrEqual(Math.ceil(n * 1.05) + 1);
    }
  });

  it('uses a fresh key and IV every time', () => {
    const data = randomBytes(100);
    const a = encryptAttachment(data);
    const b = encryptAttachment(data);
    expect(Buffer.from(a.key)).not.toEqual(Buffer.from(b.key));
    expect(Buffer.from(a.blob)).not.toEqual(Buffer.from(b.blob));
  });

  it('rejects any tampering, a wrong key or a wrong digest', () => {
    const enc = encryptAttachment(Buffer.from('a secret holiday photo'));
    for (const i of [0, 20, enc.blob.length - 1]) {
      const bad = Buffer.from(enc.blob);
      bad[i]! ^= 1;
      expect(() => decryptAttachment(bad, enc)).toThrow(AttachmentIntegrityError);
    }
    // Attacker replaces the blob and supplies a matching digest, but cannot forge the MAC.
    const forged = encryptAttachment(Buffer.from('something else'));
    expect(() => decryptAttachment(forged.blob, { ...enc, digest: forged.digest })).toThrow(/MAC/);
    expect(() => decryptAttachment(enc.blob, { ...enc, key: randomBytes(64) })).toThrow(
      AttachmentIntegrityError,
    );
    expect(() => decryptAttachment(enc.blob.subarray(0, 40), enc)).toThrow(AttachmentIntegrityError);
    expect(() => decryptAttachment(enc.blob, { ...enc, size: 1e9 })).toThrow(AttachmentIntegrityError);
  });
});
