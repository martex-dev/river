/**
 * JSON with bytes: how values cross between River's UI, the app shell and the
 * client core on a phone. Uint8Arrays become {"$u8": base64}; nothing else is
 * special. Used on both sides of the bridge.
 */

const U8 = '$u8';

function toB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeWire(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Uint8Array) return { [U8]: toB64(v) };
    if (v instanceof ArrayBuffer) return { [U8]: toB64(new Uint8Array(v)) };
    // Buffer.toJSON() runs before the replacer sees it.
    if (
      v &&
      typeof v === 'object' &&
      (v as { type?: unknown }).type === 'Buffer' &&
      Array.isArray((v as { data?: unknown }).data)
    ) {
      return { [U8]: toB64(Uint8Array.from((v as { data: number[] }).data)) };
    }
    return v;
  });
}

export function decodeWire<T = unknown>(json: string): T {
  return JSON.parse(json, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === U8 && typeof (v as Record<string, unknown>)[U8] === 'string') {
        return fromB64((v as Record<string, string>)[U8]!);
      }
    }
    return v;
  }) as T;
}

/** Messages between the client core and the app shell. */
export type CoreInbound =
  | { t: 'invoke'; id: number; channel: string; args: unknown[] }
  | { t: 'send'; channel: string; args: unknown[] }
  | { t: 'answer'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'lifecycle'; state: 'foreground' | 'background' };

export type CoreOutbound =
  | { t: 'ready' }
  | { t: 'reply'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'event'; channel: string; args: unknown[] }
  | { t: 'ask'; id: number; kind: string; args: unknown };
