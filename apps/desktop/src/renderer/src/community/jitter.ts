/**
 * Playout buffer for relayed voice (1.0.17). Frames arrive over a WebSocket
 * with uneven timing; this keeps a small cushion so playback is smooth, and
 * bounds the delay so a backlog never turns into seconds of lag.
 *
 * Pure (no Web Audio) so it can be tested; the playout AudioWorklet uses it.
 */
export class JitterBuffer {
  private readonly chunks: Float32Array[] = [];
  private offset = 0;
  private buffered = 0;
  private playing = false;
  readonly targetSamples: number;
  readonly maxSamples: number;
  underruns = 0;
  dropped = 0;

  constructor(sampleRate = 48_000, targetMs = 60, maxMs = 240) {
    this.targetSamples = Math.round((sampleRate * targetMs) / 1000);
    this.maxSamples = Math.round((sampleRate * maxMs) / 1000);
  }

  get bufferedSamples(): number {
    return this.buffered;
  }

  push(samples: Float32Array): void {
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
    if (!this.playing) {
      if (this.buffered < this.targetSamples) {
        out.fill(0);
        return;
      }
      this.playing = true;
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
    if (i < out.length) {
      out.fill(0, i);
      this.underruns += 1;
      this.playing = false; // refill the cushion before playing again
    }
  }
}
