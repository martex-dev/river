import { describe, expect, it } from 'vitest';
import { generateKeyPair, openSealed, sealTo } from '../src/signing.ts';

describe('sealTo / openSealed (HPKE)', () => {
  it('opens only with the right key, purpose and context', () => {
    const pair = generateKeyPair();
    const other = generateKeyPair();
    const aad = new TextEncoder().encode('mailbox-1');
    const sealed = sealTo(pair.publicKey, new TextEncoder().encode('hello'), 'river-test-v1', aad);
    expect(new TextDecoder().decode(openSealed(pair.privateKey, sealed, 'river-test-v1', aad))).toBe('hello');
    expect(() => openSealed(other.privateKey, sealed, 'river-test-v1', aad)).toThrow();
    expect(() => openSealed(pair.privateKey, sealed, 'river-other-v1', aad)).toThrow();
    expect(() => openSealed(pair.privateKey, sealed, 'river-test-v1', new Uint8Array([1]))).toThrow();
  });
});
