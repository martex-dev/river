/**
 * Playing other people's voices louder than 100 %.
 *
 * Up to 100 % River plays each voice through a plain <audio> element, which is
 * what echo cancellation listens to on computers. Above that (a person turned
 * up, or the louder default on phones) the voice goes through Web Audio: a
 * gain per person into one shared limiter, so boosted voices get louder
 * without clipping. Phones cancel echo in the operating system, so this does
 * not cost them anything.
 */

export { effectiveGain, PHONE_OUTPUT_VOLUME } from './voice-level.ts';

let ctx: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;
let sinkId = '';

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

/** Routes `track` through Web Audio at `gain` (may exceed 1). Null where Web Audio is unavailable. */
export function boost(track: MediaStreamTrack, gain: number): BoostChain | null {
  const c = context();
  if (!c || !limiter) return null;
  try {
    const source = c.createMediaStreamSource(new MediaStream([track]));
    const node = c.createGain();
    node.gain.value = gain;
    source.connect(node);
    node.connect(limiter);
    void c.resume().catch(() => undefined);
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

/** Wakes the audio engine after a user gesture (joining a call). */
export function resumeAudio(): void {
  void ctx?.resume().catch(() => undefined);
}
