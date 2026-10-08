import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MANIFEST_FILENAME,
  SIGNATURE_FILENAME,
  keyIdFromPublicKey,
  rawPublicKeyOf,
  sha256Hex,
  sha512Base64,
  signManifest,
} from '@river/release';
import { createFetchBytes, type FetchBytes } from '../src/main/http.ts';
import { verifyDownloadedUpdate } from '../src/main/updater/verify-download.ts';

const dir = mkdtempSync(join(tmpdir(), 'river-verify-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const installer = Buffer.from('River installer bytes for 0.0.2');
const installerPath = join(dir, 'River-Setup-0.0.2.exe');
writeFileSync(installerPath, installer);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const raw = rawPublicKeyOf(publicKey);
const trustedKeys = [{ keyId: keyIdFromPublicKey(raw), publicKey: raw.toString('base64') }];
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function release(version: string, file = installer) {
  const manifest = JSON.stringify({
    schema: 1,
    product: 'river-desktop',
    version,
    channel: 'stable',
    gitCommit: 'b'.repeat(40),
    createdAt: '2026-10-08T00:00:00.000Z',
    files: [
      { name: 'River-Setup.exe', size: file.length, sha256: sha256Hex(file), sha512: sha512Base64(file) },
    ],
  });
  return { manifest, signature: JSON.stringify(signManifest(manifest, pem)) };
}

function server(files: Record<string, string>): { fetchBytes: FetchBytes; requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    fetchBytes: async (url) => {
      requested.push(url);
      const body = files[url];
      if (body === undefined) throw new Error(`HTTP 404 fetching ${url}`);
      return Buffer.from(body);
    },
  };
}

const BASE = 'https://github.com/martex-dev/river/releases/download';

describe('verifyDownloadedUpdate', () => {
  it('accepts an installer listed in a correctly signed manifest for that exact version', async () => {
    const r = release('0.0.2');
    const s = server({
      [`${BASE}/v0.0.2/${MANIFEST_FILENAME}`]: r.manifest,
      [`${BASE}/v0.0.2/${SIGNATURE_FILENAME}`]: r.signature,
    });
    await verifyDownloadedUpdate({
      version: '0.0.2',
      filePath: installerPath,
      fetchBytes: s.fetchBytes,
      trustedKeys,
    });
    expect(s.requested).toHaveLength(2);
  });

  it('rejects a swapped installer', async () => {
    const r = release('0.0.2', Buffer.from('a different, malicious file'));
    const s = server({
      [`${BASE}/v0.0.2/${MANIFEST_FILENAME}`]: r.manifest,
      [`${BASE}/v0.0.2/${SIGNATURE_FILENAME}`]: r.signature,
    });
    await expect(
      verifyDownloadedUpdate({
        version: '0.0.2',
        filePath: installerPath,
        fetchBytes: s.fetchBytes,
        trustedKeys,
      }),
    ).rejects.toMatchObject({ code: 'file-not-listed' });
  });

  it('rejects an old signed manifest replayed under a new version', async () => {
    const old = release('0.0.1');
    const s = server({
      [`${BASE}/v0.0.2/${MANIFEST_FILENAME}`]: old.manifest,
      [`${BASE}/v0.0.2/${SIGNATURE_FILENAME}`]: old.signature,
    });
    await expect(
      verifyDownloadedUpdate({
        version: '0.0.2',
        filePath: installerPath,
        fetchBytes: s.fetchBytes,
        trustedKeys,
      }),
    ).rejects.toMatchObject({ code: 'version-mismatch' });
  });

  it('fails when the signature is missing', async () => {
    const r = release('0.0.2');
    const s = server({ [`${BASE}/v0.0.2/${MANIFEST_FILENAME}`]: r.manifest });
    await expect(
      verifyDownloadedUpdate({
        version: '0.0.2',
        filePath: installerPath,
        fetchBytes: s.fetchBytes,
        trustedKeys,
      }),
    ).rejects.toThrow(/404/);
  });

  it('url-encodes the version so it cannot change the request path', async () => {
    const s = server({});
    await expect(
      verifyDownloadedUpdate({
        version: '0.0.2/../../x',
        filePath: installerPath,
        fetchBytes: s.fetchBytes,
        trustedKeys,
      }),
    ).rejects.toThrow();
    expect(s.requested[0]).toContain('v0.0.2%2F..%2F..%2Fx');
  });
});

describe('createFetchBytes', () => {
  it('enforces the size limit while streaming', async () => {
    const big = new Uint8Array(2048);
    const fetchBytes = createFetchBytes(async () => new Response(big));
    await expect(fetchBytes('https://x/y', 1024)).rejects.toThrow(/too large/);
    await expect(fetchBytes('https://x/y', 4096)).resolves.toHaveLength(2048);
  });

  it('rejects declared oversize and HTTP errors', async () => {
    const declared = createFetchBytes(
      async () => new Response('x', { headers: { 'content-length': '999999' } }),
    );
    await expect(declared('https://x/y', 10)).rejects.toThrow(/too large/);
    const notFound = createFetchBytes(async () => new Response('nope', { status: 404 }));
    await expect(notFound('https://x/y', 10)).rejects.toThrow(/HTTP 404/);
  });
});
