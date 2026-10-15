/** POSIX node:path for the phone (app storage paths are always "/…"). */

export const sep = '/';
export const delimiter = ':';

export function normalize(path: string): string {
  if (path === '') return '.';
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length && out.at(-1) !== '..') out.pop();
      else if (!absolute) out.push('..');
    } else out.push(part);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined || '.';
}

export function join(...parts: string[]): string {
  const nonEmpty = parts.filter((p) => p !== '');
  return nonEmpty.length ? normalize(nonEmpty.join('/')) : '.';
}

export function isAbsolute(path: string): boolean {
  return path.startsWith('/');
}

export function resolve(...parts: string[]): string {
  let out = '';
  for (let i = parts.length - 1; i >= 0 && !out.startsWith('/'); i--) {
    const p = parts[i]!;
    if (p) out = out ? `${p}/${out}` : p;
  }
  if (!out.startsWith('/')) out = `/${out}`;
  const n = normalize(out);
  return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n;
}

export function dirname(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const i = trimmed.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return trimmed.slice(0, i);
}

export function basename(path: string, ext?: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return ext && base.endsWith(ext) && base !== ext ? base.slice(0, -ext.length) : base;
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i);
}

export function relative(from: string, to: string): string {
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

const path = { sep, delimiter, normalize, join, isAbsolute, resolve, dirname, basename, extname, relative };
export const posix = path;
export default path;
