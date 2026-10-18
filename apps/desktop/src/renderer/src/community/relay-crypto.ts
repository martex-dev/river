/**
 * End-to-end encryption of relayed voice frames (1.0.17).
 *
 * Each participant makes a random AES-256-GCM sender key per call and gives
 * it to the people it relays to inside a sealed call signal. A frame is
 * [4-byte sequence][12-byte random IV][ciphertext + 16-byte tag]; the sender's
 * River ID and the sequence are authenticated as associated data, so the
 * server can neither read, alter, reorder nor replay frames undetected — it
 * only sees who sends to whom, when, and how much.
 */

const SEQ_BYTES = 4;
const IV_BYTES = 12;

export async function newSenderKey(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { key: await importSenderKey(raw), raw };
}

export function importSenderKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error('bad relay key');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function aad(sender: string, seq: number): Uint8Array {
  const id = new TextEncoder().encode(sender);
  const out = new Uint8Array(id.length + SEQ_BYTES);
  out.set(id);
  new DataView(out.buffer).setUint32(id.length, seq);
  return out;
}

export async function sealFrame(
  key: CryptoKey,
  sender: string,
  seq: number,
  plain: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(sender, seq) as BufferSource },
      key,
      plain as BufferSource,
    ),
  );
  const out = new Uint8Array(SEQ_BYTES + IV_BYTES + ct.length);
  new DataView(out.buffer).setUint32(0, seq);
  out.set(iv, SEQ_BYTES);
  out.set(ct, SEQ_BYTES + IV_BYTES);
  return out;
}

/** Opens a frame; throws if it was tampered with or not made with this key and sender. */
export async function openFrame(
  key: CryptoKey,
  sender: string,
  frame: Uint8Array,
): Promise<{ seq: number; plain: Uint8Array }> {
  if (frame.length < SEQ_BYTES + IV_BYTES + 16) throw new Error('short frame');
  const seq = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0);
  const iv = frame.subarray(SEQ_BYTES, SEQ_BYTES + IV_BYTES);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(sender, seq) as BufferSource },
      key,
      frame.subarray(SEQ_BYTES + IV_BYTES) as BufferSource,
    ),
  );
  return { seq, plain };
}

/** Accepts each sequence number once and only moving forward (frames over a WebSocket arrive in order). */
export class ReplayGuard {
  private last = -1;
  private keyBytes: Uint8Array | null;
  /** `key`: the sender key whose frames this guards. */
  constructor(key?: Uint8Array) {
    this.keyBytes = key ? key.slice() : null;
  }
  accept(seq: number): boolean {
    if (seq <= this.last) return false;
    this.last = seq;
    return true;
  }
  /** A new sender key starts a new sequence. */
  reset(): void {
    this.last = -1;
  }
  /**
   * The sender's key arrived (again): true when it is a new key, which starts a new sequence.
   * Senders repeat their key (a few times, and after every reconnect); a repeat keeps the
   * sequence (2.18), or the server could play back frames it recorded after each repeat.
   */
  rekey(key: Uint8Array): boolean {
    if (this.keyBytes && sameBytes(this.keyBytes, key)) return false;
    this.keyBytes = key.slice();
    this.reset();
    return true;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export const toBase64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
export const fromBase64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
