import { describe, expect, it } from 'vitest';
import { decodeRelayIn, decodeRelayOut, encodeRelayIn, encodeRelayOut } from '@river/protocol/relay';
import {
  ReplayGuard,
  fromBase64,
  importSenderKey,
  newSenderKey,
  openFrame,
  sealFrame,
  toBase64,
} from '../src/renderer/src/community/relay-crypto.ts';
import { JitterBuffer } from '../src/renderer/src/community/jitter.ts';

const A = '0000000a-0000-4000-8000-000000000000';
const B = '0000000b-0000-4000-8000-000000000000';

describe('relay frame encryption', () => {
  it('round-trips, and the key survives being sent as text', async () => {
    const { key, raw } = await newSenderKey();
    const theirs = await importSenderKey(fromBase64(toBase64(raw)));
    const frame = await sealFrame(key, A, 7, new Uint8Array([1, 2, 3]));
    expect(await openFrame(theirs, A, frame)).toEqual({ seq: 7, plain: new Uint8Array([1, 2, 3]) });
  });

  it('rejects tampering, another sender, a changed sequence and the wrong key', async () => {
    const { key } = await newSenderKey();
    const frame = await sealFrame(key, A, 1, new Uint8Array(40).fill(5));
    const flipped = frame.slice();
    flipped[flipped.length - 1]! ^= 1;
    await expect(openFrame(key, A, flipped)).rejects.toThrow();
    await expect(openFrame(key, B, frame)).rejects.toThrow();
    const reseq = frame.slice();
    reseq[3] = 2;
    await expect(openFrame(key, A, reseq)).rejects.toThrow();
    await expect(openFrame((await newSenderKey()).key, A, frame)).rejects.toThrow();
  });

  it('accepts each sequence number once, moving forward', () => {
    const g = new ReplayGuard();
    expect([g.accept(0), g.accept(1), g.accept(1), g.accept(0), g.accept(5)]).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
    g.reset();
    expect(g.accept(0)).toBe(true);
  });

  it('a repeated sender key keeps the sequence; only a new key starts again (2.18)', async () => {
    const first = await newSenderKey();
    const g = new ReplayGuard(first.raw);
    expect([g.accept(0), g.accept(1), g.accept(2)]).toEqual([true, true, true]);
    // The sender repeats its key (after a reconnect): frames recorded earlier stay refused.
    expect(g.rekey(first.raw.slice())).toBe(false);
    expect([g.accept(0), g.accept(2), g.accept(3)]).toEqual([false, false, true]);
    // A new key (River started again) is a new sequence.
    expect(g.rekey((await newSenderKey()).raw)).toBe(true);
    expect(g.accept(0)).toBe(true);
  });
});

describe('relay wire format', () => {
  it('round-trips client and server frames', () => {
    const payload = new Uint8Array([4, 5, 6]);
    expect(decodeRelayOut(encodeRelayOut([A, B], payload))).toEqual({ recipients: [A, B], payload });
    expect(decodeRelayIn(encodeRelayIn(A, payload))).toEqual({ sender: A, payload });
  });

  it('refuses malformed frames', () => {
    expect(decodeRelayOut(new Uint8Array([1, 0]))).toBeNull();
    expect(decodeRelayOut(new Uint8Array([2, 1, ...new Uint8Array(17)]))).toBeNull();
    expect(decodeRelayOut(new Uint8Array([1, 1, ...new Uint8Array(16)]))).toBeNull(); // no payload
    expect(decodeRelayIn(new Uint8Array(17))).toBeNull();
    expect(() => encodeRelayOut([], new Uint8Array(1))).toThrow();
    expect(() => encodeRelayOut(['not-an-id'], new Uint8Array(1))).toThrow();
  });
});

describe('jitter buffer', () => {
  const chunk = (v: number) => new Float32Array(960).fill(v);

  it('waits for a cushion, then plays in order', () => {
    const jb = new JitterBuffer(48_000, 60, 240);
    const out = new Float32Array(128);
    jb.push(chunk(1));
    jb.pull(out);
    expect(out.every((x) => x === 0)).toBe(true); // 20 ms buffered < 60 ms target
    jb.push(chunk(2));
    jb.push(chunk(3));
    jb.pull(out);
    // Faded in over the first 64 samples (no click), then the first chunk as it was.
    expect(out[0]).toBe(0);
    expect(out[100]).toBe(1);
  });

  it('bounds the delay by dropping the oldest audio', () => {
    const jb = new JitterBuffer(48_000, 60, 240);
    for (let i = 0; i < 40; i++) jb.push(chunk(i)); // 800 ms arrived at once
    expect(jb.bufferedSamples).toBeLessThanOrEqual(jb.maxSamples);
    expect(jb.dropped).toBeGreaterThan(0);
  });

  it('counts running dry and refills before playing again', () => {
    const jb = new JitterBuffer(48_000, 60, 240);
    for (let i = 0; i < 3; i++) jb.push(chunk(1));
    const out = new Float32Array(960 * 4);
    jb.pull(out);
    expect(jb.underruns).toBe(1);
    jb.push(chunk(1));
    const next = new Float32Array(128);
    jb.pull(next);
    expect(next.every((x) => x === 0)).toBe(true);
  });
});
