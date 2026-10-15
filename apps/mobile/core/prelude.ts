import { Buffer } from 'buffer';

/**
 * Node globals the shared client code expects, set before any of it loads.
 * Buffer is the standard browser port of Node's Buffer, taught the one Node
 * encoding it lacks: base64url (invite keys, IDs).
 */

const B = Buffer as unknown as {
  from: (value: unknown, encodingOrOffset?: unknown, length?: unknown) => Buffer;
  byteLength: (value: unknown, encoding?: unknown) => number;
  isEncoding: (encoding: string) => boolean;
};
const toBase64 = (s: string): string => s.replace(/-/g, '+').replace(/_/g, '/');
const isUrl = (e: unknown): boolean => typeof e === 'string' && e.toLowerCase() === 'base64url';

const from = B.from.bind(Buffer);
B.from = (value, encodingOrOffset, length) =>
  typeof value === 'string' && isUrl(encodingOrOffset)
    ? from(toBase64(value), 'base64')
    : from(value, encodingOrOffset, length);

const byteLength = B.byteLength.bind(Buffer);
B.byteLength = (value, encoding) =>
  typeof value === 'string' && isUrl(encoding)
    ? byteLength(toBase64(value), 'base64')
    : byteLength(value, encoding);

const isEncoding = B.isEncoding.bind(Buffer);
B.isEncoding = (encoding) => isUrl(encoding) || isEncoding(encoding);

const proto = Buffer.prototype as unknown as {
  toString: (encoding?: string, start?: number, end?: number) => string;
};
const toString = proto.toString;
proto.toString = function (this: Buffer, encoding?: string, start?: number, end?: number): string {
  if (isUrl(encoding)) {
    return toString
      .call(this, 'base64', start, end)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  return toString.call(this, encoding, start, end);
};

const g = globalThis as Record<string, unknown>;
g.Buffer ??= Buffer;
g.process ??= {
  env: {},
  platform: /iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent ?? '') ? 'ios' : 'android',
  arch: 'arm64',
  versions: {},
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
};
