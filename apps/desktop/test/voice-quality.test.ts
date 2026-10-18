import { describe, expect, it } from 'vitest';
import {
  MAX_RELAY_RECIPIENTS,
  MAX_RELAY_SPEAKERS,
  RELAY_SPEAKER_HOLD_MS,
  RelaySpeakers,
  decodeRelayAny,
  encodeRelayAll,
  encodeRelayOut,
} from '@river/protocol/relay';
import {
  GATE_HANGOVER_FRAMES,
  GATE_PREROLL_FRAMES,
  LossMeter,
  MAX_LOSS_GAP,
  SendGate,
  chunk,
  relayBitrate,
} from '../src/renderer/src/community/relay-quality.ts';
import {
  MESH_MAX_PEOPLE,
  isLargeRoom,
  tuneOpusSdp,
  uploadPerFrame,
  videoBitrates,
} from '../src/renderer/src/community/media-tuning.ts';
import { JitterBuffer } from '../src/renderer/src/community/jitter.ts';

const A = '0000000a-0000-4000-8000-000000000000';
const B = '0000000b-0000-4000-8000-000000000000';
const frame = (level: number): Float32Array => new Float32Array(960).fill(level);

describe('relay voice activity (SendGate)', () => {
  it('sends nothing while silent, then the moment before speech with the first loud frame', () => {
    const gate = new SendGate();
    for (let i = 0; i < 10; i++) expect(gate.push(frame(0.001))).toEqual([]);
    const out = gate.push(frame(0.2));
    expect(out).toHaveLength(GATE_PREROLL_FRAMES + 1);
    expect(out.at(-1)![0]).toBeCloseTo(0.2);
    expect(gate.open).toBe(true);
  });

  it('keeps sending through short pauses and stops after the hangover', () => {
    const gate = new SendGate();
    gate.push(frame(0.2));
    let sent = 0;
    for (let i = 0; i < GATE_HANGOVER_FRAMES + 10; i++) sent += gate.push(frame(0)).length;
    expect(sent).toBe(GATE_HANGOVER_FRAMES);
    expect(gate.open).toBe(false);
  });
});

describe('relay loss and bitrate', () => {
  it('counts missed frames from sequence gaps, but not pauses', () => {
    const m = new LossMeter();
    for (let s = 0; s < 100; s++) if (s % 10 !== 5) m.frame(s); // every tenth frame lost
    expect(m.take()).toBeCloseTo(0.1, 2);
    // A long gap is a pause (the speaker stopped talking), not loss.
    for (let s = 200; s < 260; s++) m.frame(s);
    m.frame(260 + MAX_LOSS_GAP + 10);
    expect(m.take()).toBe(0);
  });

  it('says nothing from too few frames', () => {
    const m = new LossMeter();
    m.frame(0);
    m.frame(5);
    expect(m.take()).toBeNull();
  });

  it('lowers the bitrate as listeners miss more, and uses less in large rooms', () => {
    expect(relayBitrate(null, false)).toBe(32_000);
    expect(relayBitrate(null, true)).toBe(24_000);
    expect(relayBitrate(0.01, false)).toBe(32_000);
    expect(relayBitrate(0.05, false)).toBe(20_000);
    expect(relayBitrate(0.1, true)).toBe(16_000);
    expect(relayBitrate(0.3, false)).toBe(12_000);
  });

  it('splits recipients into groups the wire format allows', () => {
    const ids = Array.from({ length: 50 }, (_, i) => i);
    expect(chunk(ids, MAX_RELAY_RECIPIENTS).map((g) => g.length)).toEqual([24, 24, 2]);
  });
});

describe('large-room relay frames (protocol)', () => {
  it('round-trips a frame for everyone and still reads the per-recipient kind', () => {
    const payload = new Uint8Array([1, 2, 3]);
    expect(decodeRelayAny(encodeRelayAll(payload))).toEqual({ recipients: 'all', payload });
    expect(decodeRelayAny(encodeRelayOut([A, B], payload))).toEqual({ recipients: [A, B], payload });
    expect(decodeRelayAny(new Uint8Array([2]))).toBeNull();
    expect(() => encodeRelayAll(new Uint8Array(0))).toThrow();
  });

  it('forwards the first speakers, holds their place through pauses, lets keep-alives through', () => {
    const s = new RelaySpeakers(2, RELAY_SPEAKER_HOLD_MS);
    expect(s.admit('a', 0)).toBe(true);
    expect(s.admit('b', 0)).toBe(true);
    // c starts talking while both places are taken: their first frame passes, the rest wait.
    expect(s.admit('c', 20)).toBe(true);
    expect(s.admit('c', 40)).toBe(false);
    expect(s.admit('a', 300)).toBe(true); // a pause shorter than the hold keeps a's place
    // b went quiet: after the hold, c gets the place.
    expect(s.admit('c', 700)).toBe(true);
    expect(s.speakers(700).sort()).toEqual(['a', 'c']);
    // A keep-alive about once a second from a waiting person always passes.
    expect(s.admit('d', 710)).toBe(true);
    expect(s.admit('d', 1710)).toBe(true);
    s.forget('d');
    expect(s.size).toBe(3);
    expect(MAX_RELAY_SPEAKERS).toBeGreaterThanOrEqual(4);
  });
});

describe('media tuning', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:63 red/48000/2',
    'a=fmtp:63 111/111',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=rtpmap:96 VP8/90000',
    '',
  ].join('\r\n');

  it('asks Opus for FEC, DTX, mono and 32 kbit/s and leaves everything else alone', () => {
    const out = tuneOpusSdp(sdp);
    expect(out).toContain(
      'a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=32000',
    );
    expect(out).toContain('a=fmtp:63 111/111');
    expect(out).toContain('a=rtpmap:96 VP8/90000');
    expect(out.split('\r\n')).toHaveLength(sdp.split('\r\n').length);
    expect(tuneOpusSdp(out)).toBe(out); // stable
  });

  it('adds an fmtp line for Opus without one, and passes SDP without Opus through', () => {
    const bare = 'm=audio 9 RTP 111\na=rtpmap:111 opus/48000/2\n';
    expect(tuneOpusSdp(bare)).toContain('a=fmtp:111 useinbandfec=1;usedtx=1');
    expect(tuneOpusSdp('3.1')).toBe('3.1');
  });

  it('shares video bandwidth between viewers within limits', () => {
    expect(videoBitrates(1)).toEqual({ screen: 2_500_000, camera: 1_000_000, cameraScale: 1 });
    expect(videoBitrates(8).screen).toBe(1_000_000);
    expect(videoBitrates(40)).toEqual({ screen: 500_000, camera: 150_000, cameraScale: 2 });
  });

  it('large rooms start above the mesh limit, only where the relay works', () => {
    expect(isLargeRoom(MESH_MAX_PEOPLE, true)).toBe(false);
    expect(isLargeRoom(MESH_MAX_PEOPLE + 1, true)).toBe(true);
    expect(isLargeRoom(50, false)).toBe(false);
  });

  it('room-size estimate: mesh upload grows with the room, relay upload does not', () => {
    // Per second (50 frames) at 24 kbit/s voice (60-byte frames).
    const kbps = (bytes: number): number => (bytes * 50 * 8) / 1000;
    expect(kbps(uploadPerFrame(8, 'mesh', 60))).toBeCloseTo(308, 0);
    expect(kbps(uploadPerFrame(50, 'mesh', 60))).toBeGreaterThan(2000);
    expect(kbps(uploadPerFrame(50, 'relay', 60))).toBeLessThan(45);
    expect(uploadPerFrame(50, 'relay')).toBe(uploadPerFrame(9, 'relay'));
  });
});

describe('adaptive jitter buffer', () => {
  const chunk20 = (): Float32Array => new Float32Array(960).fill(0.5);
  const pullMs = (jb: JitterBuffer, ms: number): void => {
    for (let i = 0; i < (ms * 48) / 128; i++) jb.pull(new Float32Array(128));
  };

  it('grows the cushion when audio keeps arriving just after it ran dry', () => {
    const jb = new JitterBuffer();
    const start = jb.targetSamples;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 6; i++) jb.push(chunk20());
      pullMs(jb, 140); // plays out and runs dry; the late audio arrives just after
    }
    jb.push(chunk20());
    expect(jb.targetSamples).toBeGreaterThan(start);
    expect(jb.grown).toBeGreaterThan(0);
    expect(jb.targetSamples).toBeLessThan(jb.maxSamples);
  });

  it('does not grow at the end of a sentence, and shrinks back after a calm stretch', () => {
    const jb = new JitterBuffer();
    const start = jb.targetSamples;
    for (let i = 0; i < 6; i++) jb.push(chunk20());
    pullMs(jb, 200);
    pullMs(jb, 1000); // a pause: the next words come a second later
    jb.push(chunk20());
    expect(jb.targetSamples).toBe(start);
    // Make it grow, then stay calm for a while.
    for (let i = 0; i < 6; i++) jb.push(chunk20());
    pullMs(jb, 140);
    jb.push(chunk20());
    expect(jb.targetSamples).toBeGreaterThan(start);
    pullMs(jb, 25_000);
    expect(jb.targetSamples).toBe(start);
  });

  it('fades out instead of cutting off when it runs dry', () => {
    const jb = new JitterBuffer();
    for (let i = 0; i < 3; i++) jb.push(chunk20());
    pullMs(jb, 20); // fade-in done
    const out = new Float32Array(128 * 40);
    jb.pull(out);
    const lastAudio = out.findLastIndex((v) => v !== 0);
    expect(out[lastAudio]!).toBeLessThan(0.05);
  });
});
