import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BYTEWORDS,
  createIdentity,
  formatFingerprint,
  formatSafetyNumber,
  identityFingerprint,
  isRiverId,
  safetyNumber,
  verificationWords,
} from '../src/index.ts';

describe('Bytewords list (BCR-2020-012)', () => {
  it('has 256 unique, sorted, four-letter words', () => {
    expect(BYTEWORDS).toHaveLength(256);
    expect(new Set(BYTEWORDS).size).toBe(256);
    expect([...BYTEWORDS].sort()).toEqual(BYTEWORDS);
    for (const w of BYTEWORDS) expect(w).toMatch(/^[a-z]{4}$/);
  });

  it('is unique by first and last letter, as the spec requires', () => {
    expect(new Set(BYTEWORDS.map((w) => w[0]! + w[3]!)).size).toBe(256);
  });

  it('matches spot checks from the specification table', () => {
    expect(BYTEWORDS[0x00]).toBe('able');
    expect(BYTEWORDS[0x2a]).toBe('door');
    expect(BYTEWORDS[0x80]).toBe('lava');
    expect(BYTEWORDS[0xc9]).toBe('solo');
    expect(BYTEWORDS[0xff]).toBe('zoom');
  });
});

describe('identity', () => {
  it('creates libsignal identities with valid River IDs', () => {
    const id = createIdentity();
    expect(isRiverId(id.riverId)).toBe(true);
    expect(id.publicKey).toHaveLength(33);
    expect(id.publicKey[0]).toBe(0x05);
    expect(id.privateKey).toHaveLength(32);
    expect(id.registrationId).toBeGreaterThan(0);
    expect(id.registrationId).toBeLessThan(0x4000);
    expect(createIdentity().riverId).not.toBe(id.riverId);
  });

  it('fingerprints are SHA-256(public key) truncated to 128 bits', () => {
    const id = createIdentity();
    const fp = identityFingerprint(id.publicKey);
    expect(Buffer.from(fp)).toEqual(createHash('sha256').update(id.publicKey).digest().subarray(0, 16));
    expect(formatFingerprint(fp)).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
  });

  // Expected words derived independently from the specification text, not from BYTEWORDS.
  it('fingerprint and words have fixed test vectors', () => {
    const fp = new Uint8Array([
      0xab, 0x73, 0x29, 0xfa, 0x91, 0xc2, 0x77, 0xd4, 0, 1, 2, 3, 0xfc, 0xfd, 0xfe, 0xff,
    ]);
    expect(formatFingerprint(fp)).toBe('AB73 29FA 91C2 77D4 0001 0203 FCFD FEFF');
    expect(verificationWords(fp)).toEqual([
      'play',
      'junk',
      'diet',
      'zaps',
      'maze',
      'saga',
      'kept',
      'tiny',
      'able',
      'acid',
      'also',
      'apex',
      'zest',
      'zinc',
      'zone',
      'zoom',
    ]);
  });

  it('rejects malformed public keys', () => {
    expect(() => identityFingerprint(new Uint8Array(33))).toThrow();
    expect(() => identityFingerprint(new Uint8Array([5, 1, 2]))).toThrow();
  });
});

describe('safety numbers', () => {
  it('are 60 digits and identical from both sides', () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const fromAlice = safetyNumber(alice, bob);
    const fromBob = safetyNumber(bob, alice);
    expect(fromAlice.digits).toMatch(/^\d{60}$/);
    expect(fromAlice.digits).toBe(fromBob.digits);
    expect(formatSafetyNumber(fromAlice.digits).split(' ')).toHaveLength(12);
  });

  it('change when either identity key changes', () => {
    const alice = createIdentity();
    const bob = createIdentity();
    const mallory = { ...createIdentity(), riverId: bob.riverId };
    expect(safetyNumber(alice, bob).digits).not.toBe(safetyNumber(alice, mallory).digits);
  });

  it('reject invalid River IDs', () => {
    const a = createIdentity();
    expect(() => safetyNumber({ ...a, riverId: 'not-a-uuid' }, a)).toThrow(/River ID/);
  });
});
