// Renders River's notification tones (apps/desktop/src/shared/notify-sounds.ts) into the WAV
// files the phones play: Android's notification channels (res/raw) and the iPhone's notification
// sounds (the core bundle, copied into Library/Sounds by CoreHost.swift).
//
//   node scripts/generate-notify-tones.ts
//
// tests/mobile/notify-tones.test.ts checks that the committed files match the notes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NOTIFY_TONES, toneFile, toneWav } from '../apps/desktop/src/shared/notify-sounds.ts';

const root = resolve(import.meta.dirname, '..');
const TONE_DIRS = [
  join(root, 'apps/mobile/android/app/src/main/res/raw'),
  join(root, 'apps/mobile/core/public/sounds'),
];

for (const dir of TONE_DIRS) {
  mkdirSync(dir, { recursive: true });
  for (const tone of NOTIFY_TONES) writeFileSync(join(dir, toneFile(tone)), toneWav(tone));
}
console.log(`Wrote ${NOTIFY_TONES.length} tones to ${TONE_DIRS.length} folders`);
