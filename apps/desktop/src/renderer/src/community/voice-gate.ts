/**
 * Input sensitivity for voice activity (1.0.20): with a manual sensitivity,
 * the microphone only sends while you are louder than the line you set,
 * like Discord's slider. `null` keeps River's automatic mode (always sending,
 * with the browser's noise suppression).
 *
 * The level scale is the one the microphone meter in Settings shows:
 * 0–1, which is the signal's RMS × 6, capped at 1.
 */
export const levelOf = (rms: number): number => Math.min(1, rms * 6);

/** Keep sending this long after the last loud moment, so words are not chopped. */
export const GATE_HOLD_MS = 400;

export class VoiceGate {
  private lastLoud = -Infinity;
  open = false;

  /** Feeds one level sample; returns true when the gate opened or closed. */
  update(level: number, sensitivity: number, now: number): boolean {
    if (level >= sensitivity) this.lastLoud = now;
    const open = now - this.lastLoud < GATE_HOLD_MS;
    if (open === this.open) return false;
    this.open = open;
    return true;
  }
}
