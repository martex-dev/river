/**
 * Length padding for end-to-end encrypted content (2.13).
 *
 * Ciphertext is as long as its plaintext plus a constant, so without padding the server (and
 * anyone watching the network) learns how long every message, profile or reaction is. Before
 * encryption River therefore lengthens JSON plaintext to a size bucket:
 *
 * - up to 2560 bytes: the next multiple of 160 bytes (as Signal pads message content), so every
 *   short message, receipt, reaction or typing signal looks the same;
 * - above that: Padmé (Nikitin et al., "Reducing Metadata Leakage from Encrypted Files and
 *   Communication with PURBs", PETS 2019), which rounds to a value whose low bits are zero and
 *   costs at most 12 % (on average much less) while leaving only O(log log n) bits of the length.
 *
 * This is not a cryptographic primitive: it only chooses how many bytes to add.
 *
 * The padding is JSON whitespace (spaces) after the JSON text. JSON allows whitespace after a
 * value, so every River that ever parsed this content with `JSON.parse` — including 2.11 and
 * 2.12, which know nothing about padding — reads padded content exactly as before.
 */

/** Block size for short content, in bytes. */
export const PAD_BLOCK = 160;
/** Up to this size content is padded in whole blocks; above it, with Padmé. */
export const PAD_BLOCK_LIMIT = 16 * PAD_BLOCK;

/** Padmé: rounds `n` up so that only the top ~log2(log2(n)) bits of its length remain. */
export function padme(n: number): number {
  if (n < 2) return n;
  const e = Math.floor(Math.log2(n));
  const s = Math.floor(Math.log2(e)) + 1;
  const lastBits = e - s;
  const mask = 2 ** lastBits;
  return Math.ceil(n / mask) * mask;
}

/** The size bucket for `n` bytes of plaintext (never smaller than `n`). */
export function paddedLength(n: number): number {
  if (n <= 0) return PAD_BLOCK;
  if (n <= PAD_BLOCK_LIMIT) return Math.ceil(n / PAD_BLOCK) * PAD_BLOCK;
  return Math.max(n, padme(n));
}

/**
 * The bucket for `n`, but never more than `cap` (the largest plaintext the receiving end accepts).
 * Content already larger than `cap` is left as it is: padding must never make a send fail.
 */
export function paddedLengthCapped(n: number, cap: number): number {
  if (n >= cap) return n;
  return Math.min(paddedLength(n), cap);
}

const SPACE = 0x20;
const encoder = new TextEncoder();

/**
 * UTF-8 bytes of `json` followed by spaces up to its size bucket (at most `cap` bytes in all).
 * `JSON.parse` of the result gives back the same value as `JSON.parse(json)`.
 */
export function padJson(json: string, cap = Number.POSITIVE_INFINITY): Uint8Array {
  const text = encoder.encode(json);
  const target = paddedLengthCapped(text.length, cap);
  if (target <= text.length) return text;
  const out = new Uint8Array(target);
  out.set(text);
  out.fill(SPACE, text.length);
  return out;
}
