import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatFingerprint,
  formatSafetyNumber,
  identityFingerprint,
  publicKeyOf,
  safetyNumber,
  verificationWords,
  verify,
} from '../src/index.ts';

// The same file is the contract for the iOS and Android clients.
const vectors = JSON.parse(
  readFileSync(new URL('../../protocol/vectors/identity-v1.json', import.meta.url), 'utf8'),
);
const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));

describe('protocol v1 cross-language vectors (identity-v1.json)', () => {
  it('reproduces public keys, fingerprints and verification words', () => {
    for (const id of vectors.identities) {
      const publicKey = publicKeyOf(bytes(id.privateKey));
      expect(Buffer.from(publicKey).toString('hex')).toBe(id.publicKey);
      const fp = identityFingerprint(publicKey);
      expect(Buffer.from(fp).toString('hex')).toBe(id.fingerprint);
      expect(formatFingerprint(fp)).toBe(id.fingerprintFormatted);
      expect(verificationWords(fp)).toEqual(id.words);
    }
  });

  it('reproduces the safety number from either side', () => {
    const [a, b] = vectors.identities.map((i: { riverId: string; publicKey: string }) => ({
      riverId: i.riverId,
      publicKey: bytes(i.publicKey),
    }));
    for (const [x, y, scannable] of [
      [a, b, vectors.safetyNumber.scannableFromFirst],
      [b, a, vectors.safetyNumber.scannableFromSecond],
    ]) {
      const sn = safetyNumber(x, y);
      expect(sn.digits).toBe(vectors.safetyNumber.digits);
      expect(formatSafetyNumber(sn.digits)).toBe(vectors.safetyNumber.formatted);
      expect(Buffer.from(sn.scannable).toString('hex')).toBe(scannable);
    }
  });

  it('verifies the frozen signature and rejects tampering', () => {
    const signer = vectors.identities[vectors.signature.signer];
    const message = bytes(vectors.signature.message);
    const signature = bytes(vectors.signature.signature);
    expect(verify(bytes(signer.publicKey), message, signature)).toBe(true);
    const tampered = message.slice();
    tampered[0] = tampered[0]! ^ 1;
    expect(verify(bytes(signer.publicKey), tampered, signature)).toBe(false);
    const badSig = signature.slice();
    badSig[10] = badSig[10]! ^ 1;
    expect(verify(bytes(signer.publicKey), message, badSig)).toBe(false);
  });
});
