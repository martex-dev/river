/**
 * How relayed voice (relay-audio.ts) decides what to send and how well (2.13).
 * Pure, so it can be tested without Web Audio or WebCodecs.
 *
 * - SendGate: voice activity for the relay. Frames go out only while you talk
 *   (with a little audio from just before, so first syllables are not cut, and
 *   a hangover so pauses between words are not either). In a large room this
 *   is what keeps everyone's download to "the people talking", and what the
 *   server's active-speaker cap counts on.
 * - LossMeter: frames a listener missed from one speaker (sequence gaps).
 * - relayBitrate: the Opus bitrate a speaker uses, lowered while listeners miss frames.
 */

/** RMS below which a 20 ms frame counts as silence (about −40 dBFS: well under quiet speech). */
export const GATE_THRESHOLD = 0.01;
/** Keep sending this many frames after the last loud one (500 ms). */
export const GATE_HANGOVER_FRAMES = 25;
/** Frames from just before speech starts that are sent along (60 ms). */
export const GATE_PREROLL_FRAMES = 3;

export function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const v of samples) sum += v * v;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

export class SendGate {
  private readonly preroll: Float32Array[] = [];
  private quietFor = Infinity;
  private readonly threshold: number;
  private readonly hangover: number;
  private readonly prerollFrames: number;

  constructor(threshold = GATE_THRESHOLD, hangover = GATE_HANGOVER_FRAMES, preroll = GATE_PREROLL_FRAMES) {
    this.threshold = threshold;
    this.hangover = hangover;
    this.prerollFrames = preroll;
  }

  /** Whether the gate is sending (someone is talking, or just was). */
  get open(): boolean {
    return this.quietFor <= this.hangover;
  }

  /** Feeds one frame; returns the frames to send now, oldest first (empty while silent). */
  push(frame: Float32Array): Float32Array[] {
    const loud = rmsOf(frame) >= this.threshold;
    const wasOpen = this.open;
    this.quietFor = loud ? 0 : this.quietFor + 1;
    if (this.open) {
      const out = wasOpen ? [frame] : [...this.preroll, frame];
      this.preroll.length = 0;
      return out;
    }
    this.preroll.push(frame);
    if (this.preroll.length > this.prerollFrames) this.preroll.shift();
    return [];
  }

  reset(): void {
    this.preroll.length = 0;
    this.quietFor = Infinity;
  }
}

/** A sequence gap longer than this (in frames, 500 ms) is a pause or the cap, not loss. */
export const MAX_LOSS_GAP = 25;
/** Fewer frames than this in a window say nothing about loss. */
export const MIN_LOSS_SAMPLE = 50;

/** Frames missed from one speaker, from gaps in their sequence numbers. */
export class LossMeter {
  private last = -1;
  private received = 0;
  private lost = 0;

  frame(seq: number): void {
    if (this.last >= 0 && seq > this.last) {
      const gap = seq - this.last - 1;
      if (gap > 0 && gap <= MAX_LOSS_GAP) this.lost += gap;
    }
    if (seq > this.last) this.last = seq;
    this.received += 1;
  }

  /** A new sender key starts a new sequence. */
  restart(): void {
    this.last = -1;
  }

  /** Share of frames missed since the last call (null: too few frames to tell), then starts over. */
  take(): number | null {
    const total = this.received + this.lost;
    if (total < MIN_LOSS_SAMPLE) return null;
    const loss = this.lost / total;
    this.received = 0;
    this.lost = 0;
    return loss;
  }
}

/** Opus bitrate for relayed voice: 32 kbit/s, 24 kbit/s in large rooms, less while frames are missed. */
export function relayBitrate(worstLoss: number | null, large: boolean): number {
  const base = large ? 24_000 : 32_000;
  if (worstLoss === null) return base;
  if (worstLoss >= 0.15) return 12_000;
  if (worstLoss >= 0.08) return 16_000;
  if (worstLoss >= 0.03) return Math.min(base, 20_000);
  return base;
}

/** Splits recipients into groups the wire format allows (servers without "to everyone"). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
