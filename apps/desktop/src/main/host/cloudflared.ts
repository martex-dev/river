import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * cloudflared opens the public address for a community hosted on this PC
 * (a free Cloudflare quick tunnel; no account needed). River uses a copy that
 * is already installed in a system location, or downloads this exact release
 * from Cloudflare's GitHub releases and checks it against the hash pinned
 * here before ever running it.
 */
export const CLOUDFLARED_VERSION = '2026.10.0';

export interface Asset {
  file: string;
  /** SHA-256 of the release asset, as published by GitHub for that file. */
  sha256: string;
  archive?: 'tgz';
}

export const CLOUDFLARED_ASSETS: Record<string, Asset> = {
  'win32-x64': {
    file: 'cloudflared-windows-amd64.exe',
    sha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c',
  },
  'linux-x64': {
    file: 'cloudflared-linux-amd64',
    sha256: 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db',
  },
  'linux-arm64': {
    file: 'cloudflared-linux-arm64',
    sha256: 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08',
  },
  'darwin-x64': {
    file: 'cloudflared-darwin-amd64.tgz',
    sha256: '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f',
    archive: 'tgz',
  },
  'darwin-arm64': {
    file: 'cloudflared-darwin-arm64.tgz',
    sha256: 'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70',
    archive: 'tgz',
  },
};

/** The most a release asset may weigh; anything bigger is not what we pinned. */
const MAX_BYTES = 150 * 1024 * 1024;

/**
 * System-wide install locations only — never PATH, which any program can
 * prepend to. Writing to these needs the same rights as replacing River itself.
 */
export function installedCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    return [env['ProgramFiles(x86)'], env.ProgramFiles]
      .filter((d): d is string => Boolean(d))
      .map((d) => join(d, 'cloudflared', 'cloudflared.exe'));
  }
  if (platform === 'darwin') return ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'];
  return ['/usr/bin/cloudflared', '/usr/local/bin/cloudflared'];
}

export interface EnsureOptions {
  /** Where River keeps its own copy. */
  dir: string;
  platform: NodeJS.Platform;
  arch: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  onProgress?: (fraction: number) => void;
  exists?: (path: string) => boolean;
  /** Unpacks a .tgz (macOS); defaults to the system tar. */
  untar?: (archive: string, into: string) => Promise<void>;
  /** Tests only: replaces the pinned asset table. */
  assets?: Record<string, Asset>;
}

export class TunnelToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TunnelToolError';
  }
}

/** Returns the path of a cloudflared River may run, downloading and verifying one if needed. */
export async function ensureCloudflared(o: EnsureOptions): Promise<string> {
  const exists = o.exists ?? existsSync;
  for (const candidate of installedCandidates(o.platform, o.env)) {
    if (exists(candidate)) return candidate;
  }
  const asset = (o.assets ?? CLOUDFLARED_ASSETS)[`${o.platform}-${o.arch}`];
  if (!asset) {
    throw new TunnelToolError(
      `Hosting needs cloudflared, and there is no download for ${o.platform}-${o.arch}. Install cloudflared, then try again.`,
    );
  }
  const binary = join(o.dir, `cloudflared-${CLOUDFLARED_VERSION}${o.platform === 'win32' ? '.exe' : ''}`);
  // Our own copy is checked every time it is used. For macOS only the archive's hash is pinned,
  // so the hash of the binary unpacked from a verified archive is kept next to it.
  const expected = asset.archive ? readSidecar(`${binary}.sha256`) : asset.sha256;
  if (exists(binary) && expected && (await sha256File(binary)) === expected) return binary;

  mkdirSync(o.dir, { recursive: true });
  const part = join(o.dir, `${asset.file}.part`);
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset.file}`;
  const digest = await download(o.fetch, url, part, o.onProgress);
  if (digest !== asset.sha256) {
    rmSync(part, { force: true });
    throw new TunnelToolError(
      'The downloaded cloudflared did not match the expected fingerprint, so River did not use it.',
    );
  }
  if (asset.archive) {
    const unpacked = join(o.dir, 'unpack');
    rmSync(unpacked, { recursive: true, force: true });
    mkdirSync(unpacked, { recursive: true });
    await (o.untar ?? systemUntar)(part, unpacked);
    renameSync(join(unpacked, 'cloudflared'), binary);
    writeFileSync(`${binary}.sha256`, await sha256File(binary));
    rmSync(unpacked, { recursive: true, force: true });
    rmSync(part, { force: true });
  } else {
    renameSync(part, binary);
  }
  if (o.platform !== 'win32') chmodSync(binary, 0o755);
  return binary;
}

async function download(
  fetchImpl: typeof fetch,
  url: string,
  to: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok || !res.body) throw new TunnelToolError(`Could not download cloudflared (HTTP ${res.status}).`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new TunnelToolError('The cloudflared download is larger than expected.');
  const hash = createHash('sha256');
  const file = await open(to, 'w');
  let total = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new TunnelToolError('The cloudflared download is larger than expected.');
      }
      hash.update(value);
      await file.write(value);
      if (declared > 0) onProgress?.(Math.min(1, total / declared));
    }
  } catch (err) {
    await file.close();
    rmSync(to, { force: true });
    throw err;
  }
  await file.close();
  onProgress?.(1);
  return hash.digest('hex');
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function readSidecar(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

function systemUntar(archive: string, into: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/tar', ['-xzf', archive, '-C', into], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new TunnelToolError('Could not unpack cloudflared.')),
    );
  });
}
