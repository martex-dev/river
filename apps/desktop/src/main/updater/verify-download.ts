import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { MANIFEST_FILENAME, SIGNATURE_FILENAME, verifyReleaseFile, type TrustedKey } from '@river/release';
import type { FetchBytes } from '../http.ts';

export const RELEASE_REPO = 'martex-dev/river';
export const RELEASE_DOWNLOAD_BASE = `https://github.com/${RELEASE_REPO}/releases/download`;
export const releasePageUrl = (version: string): string =>
  `https://github.com/${RELEASE_REPO}/releases/tag/v${encodeURIComponent(version)}`;

/** Manifests are tiny; anything bigger is refused rather than buffered. */
const MAX_METADATA_BYTES = 512 * 1024;

export async function sha512OfFile(path: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('base64');
}

/**
 * Downloads the signed manifest for exactly `version` and checks that the
 * installer electron-updater downloaded is listed in it. Throws on any failure.
 */
export async function verifyDownloadedUpdate(params: {
  version: string;
  filePath: string;
  fetchBytes: FetchBytes;
  trustedKeys: readonly TrustedKey[];
  baseUrl?: string;
}): Promise<void> {
  const base = `${params.baseUrl ?? RELEASE_DOWNLOAD_BASE}/v${encodeURIComponent(params.version)}`;
  const [manifestBytes, signatureBytes, fileSha512] = await Promise.all([
    params.fetchBytes(`${base}/${MANIFEST_FILENAME}`, MAX_METADATA_BYTES),
    params.fetchBytes(`${base}/${SIGNATURE_FILENAME}`, MAX_METADATA_BYTES),
    sha512OfFile(params.filePath),
  ]);
  verifyReleaseFile({
    manifestBytes,
    signatureBytes,
    trustedKeys: params.trustedKeys,
    expectedVersion: params.version,
    fileSha512,
  });
}
