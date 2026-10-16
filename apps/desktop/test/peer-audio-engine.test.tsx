import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A Web Audio engine that starts suspended (like iOS web views) until resume() is allowed. */
class FakeContext {
  static last: FakeContext | null = null;
  static allowResume = false;
  state: AudioContextState = 'suspended';
  currentTime = 0;
  resumes = 0;
  private readonly listeners: Array<() => void> = [];
  constructor() {
    FakeContext.last = this;
  }
  get destination(): unknown {
    return {};
  }
  addEventListener(_type: string, fn: () => void): void {
    this.listeners.push(fn);
  }
  async resume(): Promise<void> {
    this.resumes += 1;
    if (!FakeContext.allowResume || this.state === 'running') return;
    this.state = 'running';
    for (const fn of this.listeners) fn();
  }
  createDynamicsCompressor(): unknown {
    const param = () => ({ value: 0 });
    return {
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
      connect: () => undefined,
    };
  }
  createMediaStreamSource(): unknown {
    return { connect: () => undefined, disconnect: () => undefined };
  }
  createGain(): unknown {
    return {
      gain: { value: 1, setTargetAtTime: () => undefined },
      connect: () => undefined,
      disconnect: () => undefined,
    };
  }
}

const track = {} as MediaStreamTrack;

beforeEach(() => {
  vi.resetModules();
  FakeContext.last = null;
  FakeContext.allowResume = false;
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeContext;
  (globalThis as { MediaStream?: unknown }).MediaStream = class {};
});

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

describe('boosted voices and a suspended audio engine', () => {
  it('stays on the plain element while the engine is suspended, so the voice is still heard', async () => {
    const audio = await import('../src/renderer/src/community/peer-audio.ts');
    expect(audio.boostReady()).toBe(false);
    expect(audio.boost(track, 1.6)).toBeNull();
    // It asked the engine to wake up.
    expect(FakeContext.last!.resumes).toBeGreaterThan(0);
  });

  it('the join tap wakes the engine; boosting works and listeners hear about it', async () => {
    const audio = await import('../src/renderer/src/community/peer-audio.ts');
    const changed = vi.fn();
    audio.onAudioStateChange(changed);
    FakeContext.allowResume = true;
    audio.resumeAudio();
    await Promise.resolve();
    expect(FakeContext.last!.state).toBe('running');
    expect(changed).toHaveBeenCalled();
    expect(audio.boostReady()).toBe(true);
    expect(audio.boost(track, 1.6)).not.toBeNull();
  });

  it('without Web Audio nothing is boosted', async () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const audio = await import('../src/renderer/src/community/peer-audio.ts');
    audio.resumeAudio();
    expect(audio.boostReady()).toBe(false);
    expect(audio.boost(track, 2)).toBeNull();
  });
});
