/**
 * River's interface sounds, synthesised with WebAudio (no sample files).
 * Each sound is a few short enveloped tones; they are deliberately quiet.
 */
export type SoundName =
  | 'message'
  | 'mention'
  | 'join'
  | 'leave'
  | 'selfJoin'
  | 'selfLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'streamStart'
  | 'streamStop'
  | 'disconnected';

type Note = [frequency: number, startMs: number, durationMs: number, type?: OscillatorType];

const SOUNDS: Record<SoundName, { gain: number; notes: Note[] }> = {
  message: {
    gain: 0.05,
    notes: [
      [987.8, 0, 90],
      [1318.5, 70, 140],
    ],
  },
  mention: {
    gain: 0.07,
    notes: [
      [1046.5, 0, 90],
      [1318.5, 80, 90],
      [1568, 160, 200],
    ],
  },
  join: {
    gain: 0.06,
    notes: [
      [523.3, 0, 110],
      [784, 90, 180],
    ],
  },
  leave: {
    gain: 0.06,
    notes: [
      [784, 0, 110],
      [523.3, 90, 180],
    ],
  },
  selfJoin: {
    gain: 0.06,
    notes: [
      [523.3, 0, 100],
      [659.3, 80, 100],
      [784, 160, 220],
    ],
  },
  selfLeave: {
    gain: 0.06,
    notes: [
      [784, 0, 100],
      [659.3, 80, 100],
      [440, 160, 220],
    ],
  },
  mute: {
    gain: 0.05,
    notes: [
      [440, 0, 70, 'triangle'],
      [330, 60, 110, 'triangle'],
    ],
  },
  unmute: {
    gain: 0.05,
    notes: [
      [330, 0, 70, 'triangle'],
      [494, 60, 110, 'triangle'],
    ],
  },
  deafen: {
    gain: 0.05,
    notes: [
      [392, 0, 90, 'triangle'],
      [262, 80, 160, 'triangle'],
    ],
  },
  undeafen: {
    gain: 0.05,
    notes: [
      [262, 0, 90, 'triangle'],
      [392, 80, 160, 'triangle'],
    ],
  },
  streamStart: {
    gain: 0.05,
    notes: [
      [659.3, 0, 80],
      [880, 70, 80],
      [1174.7, 140, 180],
    ],
  },
  streamStop: {
    gain: 0.05,
    notes: [
      [1174.7, 0, 80],
      [880, 70, 80],
      [659.3, 140, 180],
    ],
  },
  disconnected: {
    gain: 0.06,
    notes: [
      [220, 0, 160, 'sawtooth'],
      [196, 140, 240, 'sawtooth'],
    ],
  },
};

let ctx: AudioContext | null = null;
let enabled = true;
let lastPlayed = new Map<SoundName, number>();

export function setSoundsEnabled(on: boolean): void {
  enabled = on;
}

export function play(name: SoundName): void {
  if (!enabled) return;
  const now = performance.now();
  // The same sound at most every 150 ms, so bursts don't stack into noise.
  if ((lastPlayed.get(name) ?? 0) > now - 150) return;
  lastPlayed.set(name, now);
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const { gain, notes } = SOUNDS[name];
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, startMs, durMs, type = 'sine'] of notes) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const start = t0 + startMs / 1000;
      const end = start + durMs / 1000;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(gain, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(env).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // Audio unavailable (e.g. no output device): sounds are optional.
  }
}

/** For tests. */
export function resetSounds(): void {
  lastPlayed = new Map();
}
