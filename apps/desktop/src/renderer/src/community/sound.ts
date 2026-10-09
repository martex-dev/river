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
  | 'disconnected'
  | 'ring'
  | 'ringback'
  | 'send'
  | 'dm'
  | 'reaction'
  | 'callConnected'
  | 'callEnded'
  | 'communityJoin'
  | 'friendRequest'
  | 'friendAdded'
  | 'success'
  | 'error';

/** Sounds come in groups you can switch off separately (Settings → Notifications). */
export type SoundGroup = 'messages' | 'voice' | 'calls' | 'social' | 'interface';
export const SOUND_GROUPS: readonly SoundGroup[] = ['messages', 'voice', 'calls', 'social', 'interface'];

export const SOUND_GROUP: Record<SoundName, SoundGroup> = {
  message: 'messages',
  mention: 'messages',
  send: 'messages',
  dm: 'messages',
  reaction: 'messages',
  join: 'voice',
  leave: 'voice',
  selfJoin: 'voice',
  selfLeave: 'voice',
  mute: 'voice',
  unmute: 'voice',
  deafen: 'voice',
  undeafen: 'voice',
  streamStart: 'voice',
  streamStop: 'voice',
  disconnected: 'voice',
  ring: 'calls',
  ringback: 'calls',
  callConnected: 'calls',
  callEnded: 'calls',
  communityJoin: 'social',
  friendRequest: 'social',
  friendAdded: 'social',
  success: 'interface',
  error: 'interface',
};

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
  ring: {
    gain: 0.07,
    notes: [
      [659.3, 0, 140],
      [830.6, 150, 140],
      [987.8, 300, 220],
      [830.6, 560, 140],
      [987.8, 710, 260],
    ],
  },
  ringback: {
    gain: 0.035,
    notes: [
      [440, 0, 900],
      [480, 0, 900],
    ],
  },
  disconnected: {
    gain: 0.06,
    notes: [
      [220, 0, 160, 'sawtooth'],
      [196, 140, 240, 'sawtooth'],
    ],
  },
  // A soft upward "whoosh" when your message leaves.
  send: {
    gain: 0.035,
    notes: [
      [740, 0, 50, 'triangle'],
      [1108.7, 35, 90, 'triangle'],
    ],
  },
  // A direct message: warmer than a channel message, two notes up.
  dm: {
    gain: 0.06,
    notes: [
      [880, 0, 90],
      [1174.7, 80, 110],
      [1480, 170, 160],
    ],
  },
  reaction: {
    gain: 0.04,
    notes: [
      [1568, 0, 50, 'triangle'],
      [2093, 40, 90, 'triangle'],
    ],
  },
  callConnected: {
    gain: 0.06,
    notes: [
      [587.3, 0, 90],
      [880, 80, 90],
      [1174.7, 160, 220],
    ],
  },
  callEnded: {
    gain: 0.06,
    notes: [
      [880, 0, 110],
      [587.3, 100, 110],
      [440, 200, 240],
    ],
  },
  // A little fanfare when you join or create a community.
  communityJoin: {
    gain: 0.06,
    notes: [
      [523.3, 0, 100],
      [659.3, 90, 100],
      [784, 180, 100],
      [1046.5, 270, 320],
      [784, 270, 320],
    ],
  },
  friendRequest: {
    gain: 0.06,
    notes: [
      [784, 0, 110],
      [987.8, 100, 110],
      [784, 200, 160],
    ],
  },
  friendAdded: {
    gain: 0.06,
    notes: [
      [659.3, 0, 90],
      [830.6, 80, 90],
      [987.8, 160, 90],
      [1318.5, 240, 260],
    ],
  },
  success: {
    gain: 0.04,
    notes: [
      [1046.5, 0, 70, 'triangle'],
      [1568, 60, 140, 'triangle'],
    ],
  },
  error: {
    gain: 0.05,
    notes: [
      [311.1, 0, 120, 'square'],
      [233.1, 110, 200, 'square'],
    ],
  },
};

export interface SoundConfig {
  sounds: boolean;
  /** 0–1. */
  soundVolume: number;
  soundGroups: Record<SoundGroup, boolean>;
}

let ctx: AudioContext | null = null;
let enabled = true;
let lastPlayed = new Map<SoundName, number>();
let source: (() => SoundConfig | undefined) | null = null;

export function setSoundsEnabled(on: boolean): void {
  enabled = on;
}

/** Where `play` reads the user's sound settings from (set once at start-up). */
export function setSoundConfigSource(get: () => SoundConfig | undefined): void {
  source = get;
}

/** Whether `name` would be heard with these settings. */
export function audible(name: SoundName, config: SoundConfig | undefined): boolean {
  if (!config) return true;
  return config.sounds && config.soundVolume > 0 && config.soundGroups[SOUND_GROUP[name]] !== false;
}

/**
 * Plays a sound. `force` plays it even when its group is off (the preview
 * buttons in settings); the master switch and volume still apply.
 */
export function play(name: SoundName, force = false): void {
  const config = source?.();
  if (!enabled) return;
  if (!force && !audible(name, config)) return;
  if (config && (!config.sounds || config.soundVolume <= 0)) return;
  const volume = config?.soundVolume ?? 1;
  const now = performance.now();
  // The same sound at most every 150 ms, so bursts don't stack into noise.
  if ((lastPlayed.get(name) ?? 0) > now - 150) return;
  lastPlayed.set(name, now);
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const { gain: base, notes } = SOUNDS[name];
    const gain = base * volume;
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
