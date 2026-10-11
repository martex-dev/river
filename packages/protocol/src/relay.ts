/**
 * Voice relay frames (protocol v1, River 1.0.17).
 *
 * When two members of a voice channel cannot connect directly (strict NAT,
 * blocked UDP), their apps send voice to each other through the River server
 * over the existing WebSocket, as binary frames. Each frame's payload is
 * end-to-end encrypted by the sender (AES-256-GCM with a per-call sender key
 * that peers exchange inside sealed call signals); the server can see only who
 * sends to whom, when, and how big the frames are.
 *
 * Client → server:  [0x01][n: 1..MAX_RELAY_RECIPIENTS][n × 16-byte recipient River ID][payload]
 * Server → client:  [0x01][16-byte sender River ID][payload]
 *
 * The server forwards a frame only to recipients in the sender's own voice
 * channel, caps payload size and frame rate, and never stores frames.
 */

export const RELAY_FRAME = 0x01;
export const MAX_RELAY_RECIPIENTS = 24;
/** Largest encrypted payload (an Opus packet at up to 128 kbit/s plus IV and tag fits easily). */
export const MAX_RELAY_PAYLOAD = 1200;
/** Frames per second a sender may relay (50 = one 20 ms packet per recipient group), with a burst. */
export const RELAY_FRAMES_PER_SECOND = 120;
export const RELAY_BURST = 240;

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuidToBytes(id: string): Uint8Array {
  if (!HEX.test(id)) throw new Error('not a River ID');
  const hex = id.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToUuid(b: Uint8Array): string {
  const hex = [...b.subarray(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function encodeRelayOut(recipients: string[], payload: Uint8Array): Uint8Array {
  if (recipients.length < 1 || recipients.length > MAX_RELAY_RECIPIENTS)
    throw new Error('bad recipient count');
  if (payload.length > MAX_RELAY_PAYLOAD) throw new Error('relay payload too large');
  const out = new Uint8Array(2 + recipients.length * 16 + payload.length);
  out[0] = RELAY_FRAME;
  out[1] = recipients.length;
  recipients.forEach((r, i) => out.set(uuidToBytes(r), 2 + i * 16));
  out.set(payload, 2 + recipients.length * 16);
  return out;
}

export function decodeRelayOut(frame: Uint8Array): { recipients: string[]; payload: Uint8Array } | null {
  if (frame.length < 2 || frame[0] !== RELAY_FRAME) return null;
  const n = frame[1]!;
  if (n < 1 || n > MAX_RELAY_RECIPIENTS) return null;
  const start = 2 + n * 16;
  if (frame.length <= start || frame.length - start > MAX_RELAY_PAYLOAD) return null;
  const recipients: string[] = [];
  for (let i = 0; i < n; i++) recipients.push(bytesToUuid(frame.subarray(2 + i * 16, 18 + i * 16)));
  return { recipients, payload: frame.subarray(start) };
}

export function encodeRelayIn(sender: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(17 + payload.length);
  out[0] = RELAY_FRAME;
  out.set(uuidToBytes(sender), 1);
  out.set(payload, 17);
  return out;
}

export function decodeRelayIn(frame: Uint8Array): { sender: string; payload: Uint8Array } | null {
  if (frame.length <= 17 || frame[0] !== RELAY_FRAME || frame.length - 17 > MAX_RELAY_PAYLOAD) return null;
  return { sender: bytesToUuid(frame.subarray(1, 17)), payload: frame.subarray(17) };
}
