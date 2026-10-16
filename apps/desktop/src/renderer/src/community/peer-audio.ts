/**
 * Playing other people's voices louder than 100 %.
 *
 * Up to 100 % River plays each voice through a plain <audio> element, which is
 * what echo cancellation listens to on computers. Above that (a person turned
 * up, or the louder default on phones) the voice goes through Web Audio: a
 * gain per person into one shared limiter, so boosted voices get louder
 * without clipping. Phones cancel echo in the operating system, so this does
 * not cost them anything.
 *
 * The boost only takes over while the shared audio engine is actually running.
 * A suspended engine (iOS web views until a tap wakes it) plays nothing, so
 * until then voices stay on the plain element: never louder, but always heard.
 */

export { effectiveGain, PHONE_OUTPUT_VOLUME } from './voice-level.ts';

let ctx: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;
let sinkId = '';
const listeners = new Set<() => void>();

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
    limiter = ctx.createDynamicsCompressor();
    // A limiter: transparent at normal levels, holds loud peaks under 0 dBFS.
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    ctx.addEventListener?.('statechange', () => {
      for (const fn of [...listeners]) fn();
    });
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}

export interface BoostChain {
  track: MediaStreamTrack;
  setGain(gain: number): void;
  close(): void;
}

/**
 * Whether boosted voices can be heard right now: the audio engine exists and is
 * running. A suspended engine is asked to resume (this answer changes then; see
 * onAudioStateChange).
 */
export function boostReady(): boolean {
  const c = context();
  if (!c || !limiter) return false;
  if (c.state === 'running') return true;
  void c.resume().catch(() => undefined);
  return false;
}

/** Calls `fn` whenever the audio engine starts or stops running. Returns the unsubscribe. */
export function onAudioStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/**
 * Routes `track` through Web Audio at `gain` (may exceed 1). Null where Web Audio
 * is unavailable or not running (the caller then plays the track itself).
 */
export function boost(track: MediaStreamTrack, gain: number): BoostChain | null {
  if (!boostReady()) return null;
  const c = ctx!;
  const out = limiter!;
  try {
    const source = c.createMediaStreamSource(new MediaStream([track]));
    const node = c.createGain();
    node.gain.value = gain;
    source.connect(node);
    node.connect(out);
    return {
      track,
      setGain: (g) => {
        node.gain.setTargetAtTime(g, c.currentTime, 0.02);
      },
      close: () => {
        try {
          source.disconnect();
          node.disconnect();
        } catch {
          // already disconnected
        }
      },
    };
  } catch {
    return null;
  }
}

/** Boosted voices follow the chosen output device too, where the browser allows it. */
export function setBoostOutput(deviceId: string | null): void {
  const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
  const id = deviceId ?? '';
  if (!c?.setSinkId || id === sinkId) return;
  sinkId = id;
  void c.setSinkId(id).catch(() => undefined);
}

/**
 * Creates and wakes the audio engine. Call it synchronously from the tap or click
 * that joins, starts or accepts a call: iOS lets a page start audio only then.
 */
export function resumeAudio(): void {
  void context()
    ?.resume()
    .catch(() => undefined);
}
