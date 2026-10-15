import { native } from '../native.ts';

/** gzip / gunzip (java.util.zip on Android) for encrypted backups. */

export function gzipSync(data: Uint8Array): Buffer {
  return Buffer.from(native('gzip', { data: Buffer.from(data).toString('base64') }), 'base64');
}

export function gunzipSync(data: Uint8Array, options?: { maxOutputLength?: number }): Buffer {
  const max = options?.maxOutputLength ?? 256 * 1024 * 1024;
  return Buffer.from(native('gunzip', { data: Buffer.from(data).toString('base64'), max }), 'base64');
}

export default { gzipSync, gunzipSync };
