import { msg } from './i18n/index.ts';
/**
 * Notification sounds you can pick per chat, channel or community (2.17), like Telegram's.
 *
 * River's own sounds are synthesised (renderer/src/community/sound.ts): the same notes play in
 * River's window and are rendered once into small WAV files for the phones, whose notification
 * sounds must be files. `node scripts/generate-notify-tones.ts` writes them; a test checks that
 * the committed files still match these notes.
 *
 * - "default": River's usual sound (its window) or the phone's notification sound.
 * - "none": the notification shows without a sound.
 * - a tone: that sound, in River's window and in the phone's notification.
 */

export const NOTIFY_TONES = ['chime', 'bell', 'pop', 'drop', 'harp'] as const;
export type NotifyTone = (typeof NOTIFY_TONES)[number];
export const NOTIFY_SOUNDS = ['default', 'none', ...NOTIFY_TONES] as const;
export type NotifySound = (typeof NOTIFY_SOUNDS)[number];

export const NOTIFY_SOUND_LABELS: Record<NotifySound, string> = {
  default: msg('Default'),
  none: msg('No sound'),
  chime: msg('Chime'),
  bell: msg('Bell'),
  pop: msg('Pop'),
  drop: msg('Drop'),
  harp: msg('Harp'),
};

export function isTone(sound: string | undefined | null): sound is NotifyTone {
  return (NOTIFY_TONES as readonly string[]).includes(sound ?? '');
}

/** [frequency Hz, start ms, duration ms, waveform]. */
export type ToneNote = [frequency: number, startMs: number, durationMs: number, type?: ToneWave];
export type ToneWave = 'sine' | 'triangle' | 'square' | 'sawtooth';

export const TONE_NOTES: Record<NotifyTone, { gain: number; notes: ToneNote[] }> = {
  chime: {
    gain: 0.06,
    notes: [
      [1318.5, 0, 160],
      [1760, 110, 260],
    ],
  },
  bell: {
    gain: 0.06,
    notes: [
      [880, 0, 420],
      [1760, 0, 260],
      [2637, 0, 140],
    ],
  },
  pop: {
    gain: 0.07,
    notes: [
      [660, 0, 45, 'triangle'],
      [990, 30, 70, 'triangle'],
    ],
  },
  drop: {
    gain: 0.06,
    notes: [
      [1568, 0, 70],
      [1175, 55, 80],
      [784, 115, 180],
    ],
  },
  harp: {
    gain: 0.05,
    notes: [
      [523.3, 0, 200],
      [659.3, 70, 200],
      [784, 140, 200],
      [1046.5, 210, 320],
    ],
  },
};

/** File names of the rendered tones (Android res/raw: lower case letters, digits and _). */
export function toneFile(tone: NotifyTone): string {
  return `river_tone_${tone}.wav`;
}

const SAMPLE_RATE = 22_050;
/** Phones play files at the notification volume: rendered louder than River's quiet window sounds. */
const FILE_PEAK = 0.6;

function wave(type: ToneWave, phase: number): number {
  const x = phase - Math.floor(phase);
  switch (type) {
    case 'sine':
      return Math.sin(2 * Math.PI * x);
    case 'triangle':
      return 1 - 4 * Math.abs(x - 0.5);
    case 'square':
      return x < 0.5 ? 1 : -1;
    case 'sawtooth':
      return 2 * x - 1;
  }
}

/** The tone as samples in −1…1, with the envelope River's window uses (12 ms attack, exponential fade). */
export function toneSamples(tone: NotifyTone, sampleRate = SAMPLE_RATE): Float64Array {
  const { notes } = TONE_NOTES[tone];
  const endMs = Math.max(...notes.map(([, start, duration]) => start + duration)) + 20;
  const out = new Float64Array(Math.ceil((endMs / 1000) * sampleRate));
  for (const [frequency, startMs, durationMs, type = 'sine'] of notes) {
    const start = Math.round((startMs / 1000) * sampleRate);
    const length = Math.round((durationMs / 1000) * sampleRate);
    const attack = Math.max(1, Math.round(0.012 * sampleRate));
    for (let i = 0; i < length && start + i < out.length; i++) {
      const envelope =
        i < attack ? i / attack : Math.exp(Math.log(0.0001) * ((i - attack) / Math.max(1, length - attack)));
      out[start + i]! += envelope * wave(type, (frequency * i) / sampleRate);
    }
  }
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i]! / peak) * FILE_PEAK;
  return out;
}

/** A mono 16-bit PCM WAV file of the tone. */
export function toneWav(tone: NotifyTone, sampleRate = SAMPLE_RATE): Uint8Array {
  const samples = toneSamples(tone, sampleRate);
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
  }
  return bytes;
}
