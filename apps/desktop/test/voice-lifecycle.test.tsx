import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceCall, type CallTransport } from '../src/renderer/src/community/voice.ts';

/** A microphone or camera track that records whether it was stopped. */
interface FakeTrack {
  kind: string;
  enabled: boolean;
  stopped: boolean;
  stop(): void;
  clone(): FakeTrack;
}
function fakeTrack(kind = 'audio'): FakeTrack {
  const t: FakeTrack = {
    kind,
    enabled: true,
    stopped: false,
    stop: () => {
      t.stopped = true;
    },
    clone: () => {
      const c = fakeTrack(kind);
      made.push(c);
      return c;
    },
  };
  made.push(t);
  return t;
}
let made: FakeTrack[] = [];

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let getUserMedia: (c: MediaStreamConstraints) => Promise<unknown>;

beforeEach(() => {
  made = [];
  getUserMedia = async (c) => {
    const t = fakeTrack(c.video ? 'video' : 'audio');
    return { getAudioTracks: () => (c.video ? [] : [t]), getVideoTracks: () => (c.video ? [t] : []) };
  };
  (globalThis as { window?: unknown }).window = globalThis;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: (c: MediaStreamConstraints) => getUserMedia(c) } },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function transport(over: Partial<CallTransport> = {}): CallTransport & { joins: number; leaves: number } {
  const t = {
    joins: 0,
    leaves: 0,
    join: async () => {
      t.joins += 1;
    },
    leave: async () => {
      t.leaves += 1;
    },
    signal: () => undefined,
    ...over,
  };
  return t;
}

const ME = '00000001-0000-4000-8000-000000000000';

describe('voice call lifecycle', () => {
  it('Disconnect while the microphone prompt is open: the microphone is released and nothing is joined', async () => {
    const mic = deferred<unknown>();
    getUserMedia = () => mic.promise;
    const t = transport();
    const call = new VoiceCall('chan', ME, () => undefined, {}, t);
    const started = call.start();
    await call.leave();
    const track = fakeTrack();
    mic.resolve({ getAudioTracks: () => [track] });
    await started;
    expect(track.stopped).toBe(true);
    expect(t.joins).toBe(0);
    expect(call.localTrack('audio')).toBeNull();
  });

  it('Disconnect while joining: leaves again once the join landed, and starts no timers', async () => {
    vi.useFakeTimers();
    const joined = deferred<void>();
    const t = transport({ join: () => joined.promise });
    const call = new VoiceCall('chan', ME, () => undefined, {}, t);
    const started = call.start();
    await vi.advanceTimersByTimeAsync(0);
    await call.leave();
    joined.resolve();
    await started;
    expect(t.leaves).toBe(2);
    expect(made.every((x) => x.stopped)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a failed join releases the microphone and its meter copy', async () => {
    const t = transport({
      join: async () => {
        throw new Error('nope');
      },
    });
    const call = new VoiceCall('chan', ME, () => undefined, {}, t);
    await expect(call.start()).rejects.toThrow('nope');
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((x) => x.stopped)).toBe(true);
    expect(call.closed).toBe(true);
  });

  it('a camera that finishes opening after leaving is stopped, not kept capturing', async () => {
    const call = new VoiceCall('chan', ME, () => undefined, {}, transport());
    await call.start();
    const cam = deferred<unknown>();
    getUserMedia = () => cam.promise;
    const turning = call.setCamera(true);
    await call.leave();
    const track = fakeTrack('video');
    cam.resolve({ getVideoTracks: () => [track] });
    await turning;
    expect(track.stopped).toBe(true);
    expect(call.localTrack('camera')).toBeNull();
  });

  it('tells others "muted" only for a real mute or deafen, not while the voice gate is closed', async () => {
    const call = new VoiceCall('chan', ME, () => undefined, { sensitivity: 0.5 }, transport());
    await call.start();
    const state = (): { muted: boolean } =>
      (call as unknown as { stateSignal(): { muted: boolean } }).stateSignal();
    // Quiet: the gate is closed and nothing is sent, but the person is not muted.
    expect(call.transmitting).toBe(false);
    expect(state().muted).toBe(false);
    call.setMuted(true);
    expect(state().muted).toBe(true);
    call.setMuted(false);
    call.setDeafened(true);
    expect(state().muted).toBe(true);
    call.setDeafened(false);
    call.setServerMuted(true);
    expect(state().muted).toBe(true);
    await call.leave();
  });

  it('someone whose voice stops being measured no longer shows as speaking', async () => {
    const onChange = vi.fn();
    const call = new VoiceCall('chan', ME, onChange, {}, transport());
    await call.start();
    call.speaking.add('peer');
    onChange.mockClear();
    (call as unknown as { watch(id: string, t: null): void }).watch('peer', null);
    expect(call.speaking.has('peer')).toBe(false);
    expect(onChange).toHaveBeenCalled();
    await call.leave();
  });
});
