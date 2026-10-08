import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import semver from 'semver';
import { z } from 'zod';
import { RELEASE_CHANNELS, channelOfVersion } from './channels.ts';

export const MANIFEST_FILENAME = 'river-release-manifest.json';
export const SIGNATURE_FILENAME = 'river-release-manifest.json.sig';

/**
 * Domain-separation prefix. The Ed25519 signature covers
 * `SIGNING_CONTEXT || manifest bytes`, so a River release signature can never be
 * replayed as any other kind of River signature (see CRYPTOGRAPHY.md §2).
 */
export const SIGNING_CONTEXT = 'river-release-manifest-v1\n';

const fileEntrySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .refine((n) => !/[\\/]/.test(n) && n !== '.' && n !== '..', 'file names must not contain path separators'),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});

export const releaseManifestSchema = z
  .object({
    schema: z.literal(1),
    product: z.literal('river-desktop'),
    version: z.string().refine((v) => semver.valid(v) === v, 'version must be a normalized semver string'),
    channel: z.enum(RELEASE_CHANNELS),
    gitCommit: z.string().regex(/^[0-9a-f]{40}$/),
    createdAt: z.iso.datetime(),
    files: z.array(fileEntrySchema).min(1),
  })
  .superRefine((m, ctx) => {
    let expected: string;
    try {
      expected = channelOfVersion(m.version);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: (e as Error).message, path: ['version'] });
      return;
    }
    if (expected !== m.channel) {
      ctx.addIssue({ code: 'custom', message: `channel ${m.channel} does not match version`, path: ['channel'] });
    }
    const names = new Set<string>();
    for (const f of m.files) {
      if (names.has(f.name)) ctx.addIssue({ code: 'custom', message: `duplicate file ${f.name}`, path: ['files'] });
      names.add(f.name);
    }
  });

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export type ReleaseFileEntry = ReleaseManifest['files'][number];

export const signatureFileSchema = z.object({
  algorithm: z.literal('ed25519'),
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});
export type SignatureFile = z.infer<typeof signatureFileSchema>;

export interface TrustedKey {
  /** First 16 hex chars of SHA-256 over the raw 32-byte public key. */
  keyId: string;
  /** Raw 32-byte Ed25519 public key, base64. */
  publicKey: string;
  /** Human note, e.g. when the key was introduced. */
  comment?: string;
}

export type VerificationErrorCode =
  | 'malformed-signature'
  | 'unknown-key'
  | 'bad-signature'
  | 'malformed-manifest'
  | 'version-mismatch'
  | 'file-not-listed';

export class ReleaseVerificationError extends Error {
  readonly code: VerificationErrorCode;
  constructor(code: VerificationErrorCode, message: string) {
    super(message);
    this.name = 'ReleaseVerificationError';
    this.code = code;
  }
}

function toBytes(data: Uint8Array | string): Buffer {
  return typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
}

function signedMessage(manifestBytes: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(SIGNING_CONTEXT, 'utf8'), Buffer.from(manifestBytes)]);
}

export function rawPublicKeyOf(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new Error('Expected an Ed25519 key');
  }
  return Buffer.from(jwk.x, 'base64url');
}

export function keyIdFromPublicKey(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== 32) throw new Error('Ed25519 public keys are 32 bytes');
  return createHash('sha256').update(rawPublicKey).digest('hex').slice(0, 16);
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

/** Signs manifest bytes with a PKCS#8 PEM Ed25519 private key. */
export function signManifest(manifestBytes: Uint8Array | string, privateKeyPem: string): SignatureFile {
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Release signing key must be Ed25519');
  const raw = rawPublicKeyOf(createPublicKey(privateKey));
  const signature = sign(null, signedMessage(toBytes(manifestBytes)), privateKey);
  return { algorithm: 'ed25519', keyId: keyIdFromPublicKey(raw), signature: signature.toString('base64') };
}

/**
 * Verifies the signature over the exact manifest bytes *before* parsing them,
 * then validates the manifest structure. Throws ReleaseVerificationError.
 */
export function verifyManifest(
  manifestBytes: Uint8Array | string,
  signatureBytes: Uint8Array | string,
  trustedKeys: readonly TrustedKey[],
): ReleaseManifest {
  let sigFile: SignatureFile;
  try {
    sigFile = signatureFileSchema.parse(JSON.parse(toBytes(signatureBytes).toString('utf8')));
  } catch {
    throw new ReleaseVerificationError('malformed-signature', 'Signature file is malformed');
  }

  const trusted = trustedKeys.find((k) => k.keyId === sigFile.keyId);
  if (!trusted) throw new ReleaseVerificationError('unknown-key', `Release signed by untrusted key ${sigFile.keyId}`);

  const raw = Buffer.from(trusted.publicKey, 'base64');
  if (raw.length !== 32 || keyIdFromPublicKey(raw) !== trusted.keyId) {
    // A misconfigured trust list must fail closed, never verify against the wrong key.
    throw new ReleaseVerificationError('unknown-key', `Trusted key ${trusted.keyId} is inconsistent`);
  }

  const bytes = toBytes(manifestBytes);
  const ok = verify(null, signedMessage(bytes), publicKeyFromRaw(raw), Buffer.from(sigFile.signature, 'base64'));
  if (!ok) throw new ReleaseVerificationError('bad-signature', 'Release manifest signature is invalid');

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ReleaseVerificationError('malformed-manifest', 'Release manifest is not valid JSON');
  }
  const result = releaseManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ReleaseVerificationError('malformed-manifest', `Release manifest is invalid: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Full check used by the updater: signature, exact version, and that the
 * downloaded file's SHA-512 (base64) is one of the signed files.
 */
export function verifyReleaseFile(params: {
  manifestBytes: Uint8Array | string;
  signatureBytes: Uint8Array | string;
  trustedKeys: readonly TrustedKey[];
  expectedVersion: string;
  fileSha512: string;
}): { manifest: ReleaseManifest; file: ReleaseFileEntry } {
  const manifest = verifyManifest(params.manifestBytes, params.signatureBytes, params.trustedKeys);
  if (manifest.version !== params.expectedVersion) {
    throw new ReleaseVerificationError(
      'version-mismatch',
      `Signed manifest is for ${manifest.version}, expected ${params.expectedVersion}`,
    );
  }
  const file = manifest.files.find((f) => f.sha512 === params.fileSha512);
  if (!file) throw new ReleaseVerificationError('file-not-listed', 'Downloaded file is not part of the signed release');
  return { manifest, file };
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha512Base64(data: Uint8Array): string {
  return createHash('sha512').update(data).digest('base64');
}
