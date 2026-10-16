import { finishExport } from '../exports.ts';
import { native, NativeError } from '../native.ts';

/**
 * The subset of node:fs (sync) and node:fs/promises the client core uses,
 * backed by the app's private storage. Paths outside it are refused natively.
 */

type Data = Uint8Array | string;
type Encoding = BufferEncoding | { encoding?: BufferEncoding | null; flag?: string } | null | undefined;

function enoent(path: string, op: string): Error {
  const err = new Error(`ENOENT: no such file or directory, ${op} '${path}'`) as Error & {
    code: string;
    errno: number;
    path: string;
  };
  err.code = 'ENOENT';
  err.errno = -2;
  err.path = path;
  return err;
}

function wrap<T>(path: string, op: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof NativeError && err.code === 'ENOENT') throw enoent(path, op);
    throw err;
  }
}

const encodingOf = (options: Encoding): BufferEncoding | null =>
  typeof options === 'string' ? options : (options?.encoding ?? null);

const toB64 = (data: Data, encoding: BufferEncoding | null = 'utf8'): string =>
  (typeof data === 'string' ? Buffer.from(data, encoding ?? 'utf8') : Buffer.from(data)).toString('base64');

export function readFileSync(path: string): Buffer;
export function readFileSync(path: string, options: BufferEncoding | { encoding: BufferEncoding }): string;
export function readFileSync(path: string, options?: Encoding): Buffer | string;
export function readFileSync(path: string, options?: Encoding): Buffer | string {
  const buf = Buffer.from(
    wrap(path, 'open', () => native('fs.read', { path })),
    'base64',
  );
  const encoding = encodingOf(options);
  return encoding ? buf.toString(encoding) : buf;
}

export function writeFileSync(path: string, data: Data, options?: Encoding): void {
  wrap(path, 'open', () => native('fs.write', { path, data: toB64(data, encodingOf(options)) }));
}

export function appendFileSync(path: string, data: Data, options?: Encoding): void {
  wrap(path, 'open', () =>
    native('fs.write', { path, data: toB64(data, encodingOf(options)), append: true }),
  );
}

export function existsSync(path: string): boolean {
  try {
    return native('fs.stat', { path }) !== null;
  } catch {
    return false;
  }
}

class Stats {
  readonly size: number;
  readonly mtimeMs: number;
  readonly mtime: Date;
  private readonly dir: boolean;
  constructor(s: { size: number; mtimeMs: number; dir: boolean }) {
    this.size = s.size;
    this.mtimeMs = s.mtimeMs;
    this.mtime = new Date(s.mtimeMs);
    this.dir = s.dir;
  }
  isDirectory(): boolean {
    return this.dir;
  }
  isFile(): boolean {
    return !this.dir;
  }
}

export function statSync(path: string): Stats;
export function statSync(path: string, options: { throwIfNoEntry: false }): Stats | undefined;
export function statSync(path: string, options?: { throwIfNoEntry?: boolean }): Stats | undefined {
  const s = native('fs.stat', { path });
  if (!s) {
    if (options?.throwIfNoEntry === false) return undefined;
    throw enoent(path, 'stat');
  }
  return new Stats(s);
}

export function readdirSync(path: string): string[] {
  return wrap(path, 'scandir', () => native('fs.list', { path }));
}

export function mkdirSync(path: string, _options?: { recursive?: boolean }): void {
  native('fs.mkdir', { path });
}

export function renameSync(from: string, to: string): void {
  wrap(from, 'rename', () => native('fs.rename', { from, to }));
}

export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void {
  try {
    native('fs.remove', { path, recursive: !!options?.recursive });
  } catch (err) {
    if (!(err instanceof NativeError && err.code === 'ENOENT')) throw err;
    if (!options?.force) throw enoent(path, 'rm');
  }
}

export function unlinkSync(path: string): void {
  rmSync(path);
}

export function copyFileSync(from: string, to: string): void {
  wrap(from, 'copyfile', () => native('fs.copy', { from, to }));
}

const later =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  async (...args: A): Promise<R> =>
    fn(...args);

/** Streams are only used to verify desktop update downloads, which phones do not have. */
export function createReadStream(): never {
  throw new Error('File streams are not available on phones');
}

export const promises = {
  readFile: later(readFileSync as (path: string, options?: Encoding) => Buffer | string),
  // A file saved through the iOS "Save to Files" sheet is offered once written (exports.ts).
  writeFile: async (path: string, data: Data, options?: Encoding): Promise<void> => {
    writeFileSync(path, data, options);
    await finishExport(path);
  },
  appendFile: later(appendFileSync),
  mkdir: later(mkdirSync),
  rename: later(renameSync),
  rm: later(rmSync),
  unlink: later(unlinkSync),
  stat: later((path: string) => statSync(path)),
  readdir: later(readdirSync),
  copyFile: later(copyFileSync),
};

export default {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  statSync,
  readdirSync,
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  copyFileSync,
  promises,
};
