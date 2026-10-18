/**
 * Playout buffer for relayed voice (1.0.17). Frames arrive over a WebSocket
 * with uneven timing; this keeps a small cushion so playback is smooth, and
 * bounds the delay so a backlog never turns into seconds of lag.
 *
 * Adaptive (2.13): running dry and then getting audio a moment later means the
 * network is jittery, so the cushion grows (up to `maxTargetMs`); after a calm
 * stretch it shrinks again. Running dry at the end of a sentence (speakers
 * only send while they talk) changes nothing. Starts and stops are faded over
 * a millisecond or so, so a gap is a short silence rather than a click.
 *
 * Pure (no Web Audio) so it can be tested; the playout AudioWorklet uses it.
 * Time is counted in samples played, never the wall clock.
 */

/** Audio back this soon after running dry: the cushion was too small (not the end of a sentence). */
const LATE_MS = 120;
/** Each late arrival grows the cushion by this much. */
const STEP_MS = 20;
/** After this long without a late arrival the cushion shrinks by half a step. */
const CALM_MS = 10_000;
const FADE_SAMPLES = 64;

export class JitterBuffer {
  private readonly chunks: Float32Array[] = [];
  private offset = 0;
  private buffered = 0;
  private playing = false;
  private fadeIn = false;
  /** Samples played (or silence pulled) so far: the buffer's clock. */
  private clock = 0;
  private dryAt: number | null = null;
  private lastChange = 0;
  private readonly minTarget: number;
  private readonly maxTarget: number;
  private readonly step: number;
  private readonly late: number;
  private readonly calm: number;
  targetSamples: number;
  readonly maxSamples: number;
  underruns = 0;
  dropped = 0;
  /** Times the cushion grew because audio came late. */
  grown = 0;

  constructor(sampleRate = 48_000, targetMs = 60, maxMs = 240, maxTargetMs = 200) {
    const samples = (ms: number): number => Math.round((sampleRate * ms) / 1000);
    this.targetSamples = samples(targetMs);
    this.minTarget = this.targetSamples;
    this.maxSamples = samples(maxMs);
    this.maxTarget = Math.min(samples(maxTargetMs), this.maxSamples - samples(STEP_MS));
    this.step = samples(STEP_MS);
    this.late = samples(LATE_MS);
    this.calm = samples(CALM_MS);
  }

  get bufferedSamples(): number {
    return this.buffered;
  }

  push(samples: Float32Array): void {
    if (this.dryAt !== null) {
      // Audio came back soon after we ran out: it was late, not the end of a sentence.
      if (this.clock - this.dryAt < this.late && this.targetSamples < this.maxTarget) {
        this.targetSamples = Math.min(this.maxTarget, this.targetSamples + this.step);
        this.grown += 1;
        this.lastChange = this.clock;
      }
      this.dryAt = null;
    }
    this.chunks.push(samples);
    this.buffered += samples.length;
    // Too far behind: drop the oldest audio and catch up to the target delay.
    while (this.buffered > this.maxSamples && this.chunks.length > 1) {
      const old = this.chunks.shift()!;
      const len = old.length - this.offset;
      this.offset = 0;
      this.buffered -= len;
      this.dropped += len;
      if (this.buffered <= this.targetSamples) break;
    }
  }

  /** Fills `out` with audio (silence while filling up or after running dry). */
  pull(out: Float32Array): void {
    const start = this.clock;
    this.clock += out.length;
    // A calm stretch: give back some of the delay.
    if (this.targetSamples > this.minTarget && start - this.lastChange > this.calm) {
      this.targetSamples = Math.max(this.minTarget, this.targetSamples - this.step / 2);
      this.lastChange = start;
    }
    if (!this.playing) {
      if (this.buffered < this.targetSamples) {
        out.fill(0);
        return;
      }
      this.playing = true;
      this.fadeIn = true;
    }
    let i = 0;
    while (i < out.length && this.chunks.length > 0) {
      const head = this.chunks[0]!;
      const n = Math.min(out.length - i, head.length - this.offset);
      out.set(head.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      this.buffered -= n;
      if (this.offset >= head.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    if (this.fadeIn) {
      this.fadeIn = false;
      const n = Math.min(FADE_SAMPLES, i);
      for (let k = 0; k < n; k++) out[k]! *= k / n;
    }
    if (i < out.length) {
      // Ran dry: fade out what we had instead of cutting it off.
      const n = Math.min(FADE_SAMPLES, i);
      for (let k = 0; k < n; k++) out[i - n + k]! *= 1 - (k + 1) / n;
      out.fill(0, i);
      this.underruns += 1;
      this.playing = false; // refill the cushion before playing again
      this.dryAt = start + i;
    }
  }
}
