import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ReleaseVerificationError,
  SIGNING_CONTEXT,
  TRUSTED_RELEASE_KEYS,
  keyIdFromPublicKey,
  rawPublicKeyOf,
  sha256Hex,
  sha512Base64,
  signManifest,
  verifyManifest,
  verifyReleaseFile,
  type ReleaseManifest,
  type TrustedKey,
} from '../src/index.ts';

function makeKey(): { pem: string; trusted: TrustedKey } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = rawPublicKeyOf(publicKey);
  return {
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    trusted: { keyId: keyIdFromPublicKey(raw), publicKey: raw.toString('base64') },
  };
}

const installer = Buffer.from('pretend this is River-Setup-0.0.2.exe');

function manifest(overrides: Partial<ReleaseManifest> = {}): string {
  const m: ReleaseManifest = {
    schema: 1,
    product: 'river-desktop',
    version: '0.0.2',
    channel: 'stable',
    gitCommit: 'a'.repeat(40),
    createdAt: '2026-10-08T12:00:00.000Z',
    files: [{ name: 'River-Setup-0.0.2.exe', size: installer.length, sha256: sha256Hex(installer), sha512: sha512Base64(installer) }],
    ...overrides,
  };
  return JSON.stringify(m, null, 2);
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof ReleaseVerificationError) return e.code;
    throw e;
  }
  return undefined;
}

describe('release manifest signatures', () => {
  const key = makeKey();

  it('round-trips a valid signature', () => {
    const bytes = manifest();
    const sig = JSON.stringify(signManifest(bytes, key.pem));
    const m = verifyManifest(bytes, sig, [key.trusted]);
    expect(m.version).toBe('0.0.2');
  });

  it('rejects a manifest modified after signing', () => {
    const bytes = manifest();
    const sig = JSON.stringify(signManifest(bytes, key.pem));
    const tampered = bytes.replace('0.0.2', '0.0.3');
    expect(codeOf(() => verifyManifest(tampered, sig, [key.trusted]))).toBe('bad-signature');
  });

  it('rejects a signature from an untrusted key', () => {
    const other = makeKey();
    const bytes = manifest();
    const sig = JSON.stringify(signManifest(bytes, other.pem));
    expect(codeOf(() => verifyManifest(bytes, sig, [key.trusted]))).toBe('unknown-key');
  });

  it('rejects a trusted key whose keyId does not match its public key', () => {
    const other = makeKey();
    const bytes = manifest();
    const sig = JSON.stringify(signManifest(bytes, key.pem));
    const confused: TrustedKey = { keyId: key.trusted.keyId, publicKey: other.trusted.publicKey };
    expect(codeOf(() => verifyManifest(bytes, sig, [confused]))).toBe('unknown-key');
  });

  it('requires the domain-separation context', () => {
    const bytes = manifest();
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const raw = rawPublicKeyOf(publicKey);
    const trusted = { keyId: keyIdFromPublicKey(raw), publicKey: raw.toString('base64') };
    // Signature over the bare bytes (no context) must not verify.
    const bare = sign(null, Buffer.from(bytes), privateKey).toString('base64');
    const sig = JSON.stringify({ algorithm: 'ed25519', keyId: trusted.keyId, signature: bare });
    expect(codeOf(() => verifyManifest(bytes, sig, [trusted]))).toBe('bad-signature');
    expect(SIGNING_CONTEXT).toBe('river-release-manifest-v1\n');
  });

  it('rejects malformed signature files', () => {
    expect(codeOf(() => verifyManifest(manifest(), 'not json', [key.trusted]))).toBe('malformed-signature');
    expect(codeOf(() => verifyManifest(manifest(), '{"algorithm":"rsa"}', [key.trusted]))).toBe('malformed-signature');
  });

  it('rejects a correctly signed but structurally invalid manifest', () => {
    const bad = manifest({ channel: 'beta' }); // 0.0.2 is a stable version
    const sig = JSON.stringify(signManifest(bad, key.pem));
    expect(codeOf(() => verifyManifest(bad, sig, [key.trusted]))).toBe('malformed-manifest');

    const traversal = manifest({
      files: [{ name: '../evil.exe', size: 1, sha256: 'a'.repeat(64), sha512: sha512Base64(installer) }],
    });
    const sig2 = JSON.stringify(signManifest(traversal, key.pem));
    expect(codeOf(() => verifyManifest(traversal, sig2, [key.trusted]))).toBe('malformed-manifest');
  });

  it('verifies a downloaded file against the signed release', () => {
    const bytes = manifest();
    const sig = JSON.stringify(signManifest(bytes, key.pem));
    const ok = verifyReleaseFile({
      manifestBytes: bytes,
      signatureBytes: sig,
      trustedKeys: [key.trusted],
      expectedVersion: '0.0.2',
      fileSha512: sha512Base64(installer),
    });
    expect(ok.file.name).toBe('River-Setup-0.0.2.exe');
  });

  it('rejects a replayed manifest for a different version', () => {
    const bytes = manifest();
    const sig = JSON.stringify(signManifest(bytes, key.pem));
    const params = {
      manifestBytes: bytes,
      signatureBytes: sig,
      trustedKeys: [key.trusted],
      expectedVersion: '0.0.9',
      fileSha512: sha512Base64(installer),
    };
    expect(codeOf(() => verifyReleaseFile(params))).toBe('version-mismatch');
  });

  it('rejects a file that is not in the signed release', () => {
    const bytes = manifest();
    const sig = JSON.stringify(signManifest(bytes, key.pem));
    const params = {
      manifestBytes: bytes,
      signatureBytes: sig,
      trustedKeys: [key.trusted],
      expectedVersion: '0.0.2',
      fileSha512: sha512Base64(Buffer.from('malware')),
    };
    expect(codeOf(() => verifyReleaseFile(params))).toBe('file-not-listed');
  });

  it('ships at least one well-formed pinned release key', () => {
    expect(TRUSTED_RELEASE_KEYS.length).toBeGreaterThan(0);
    for (const k of TRUSTED_RELEASE_KEYS) {
      const raw = Buffer.from(k.publicKey, 'base64');
      expect(raw.length).toBe(32);
      expect(keyIdFromPublicKey(raw)).toBe(k.keyId);
    }
  });
});
