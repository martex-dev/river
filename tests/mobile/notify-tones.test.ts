import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFY_TONES, toneFile, toneWav } from '../../apps/desktop/src/shared/notify-sounds.ts';

/**
 * River's notification tones on the phones (2.17), checked without a JDK or Xcode: the WAV files
 * the shells play match the notes River's window plays, and the Java and Swift know every tone
 * (and the asks the core sends for grouped notifications, Mark as read and badges).
 */

const ROOT = resolve(import.meta.dirname, '../..');
const RAW = join(ROOT, 'apps/mobile/android/app/src/main/res/raw');
const BUNDLE = join(ROOT, 'apps/mobile/core/public/sounds');
const JAVA = join(ROOT, 'apps/mobile/android/app/src/main/java/io/github/martexdev/river/core');
const java = (file: string): string => readFileSync(join(JAVA, file), 'utf8');
const swift = readFileSync(join(ROOT, 'apps/mobile/ios/RiverNative/Sources/CoreHost.swift'), 'utf8');

/** 16-bit samples of a WAV file (after its 44-byte header). */
const samples = (bytes: Uint8Array): Int16Array =>
  new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.byteLength));

describe('notification tones', () => {
  it('are valid mono 16-bit WAV files', () => {
    for (const tone of NOTIFY_TONES) {
      const wav = toneWav(tone);
      const text = (from: number, to: number) => String.fromCharCode(...wav.slice(from, to));
      expect(text(0, 4)).toBe('RIFF');
      expect(text(8, 12)).toBe('WAVE');
      const view = new DataView(wav.buffer);
      expect(view.getUint16(22, true)).toBe(1);
      expect(view.getUint16(34, true)).toBe(16);
      expect(view.getUint32(40, true)).toBe(wav.length - 44);
      // Short, like a notification sound, and not silent.
      expect(wav.length).toBeLessThan(64_000);
      expect(Math.max(...samples(wav).map(Math.abs))).toBeGreaterThan(10_000);
    }
  });

  it('are committed for Android and the iPhone exactly as the notes render (node scripts/generate-notify-tones.ts)', () => {
    for (const dir of [RAW, BUNDLE]) {
      for (const tone of NOTIFY_TONES) {
        const file = join(dir, toneFile(tone));
        expect(existsSync(file), file).toBe(true);
        const committed = samples(new Uint8Array(readFileSync(file)));
        const rendered = samples(toneWav(tone));
        expect(committed.length, file).toBe(rendered.length);
        let worst = 0;
        for (let i = 0; i < rendered.length; i++)
          worst = Math.max(worst, Math.abs(committed[i]! - rendered[i]!));
        expect(worst, file).toBeLessThanOrEqual(1);
      }
    }
  });

  it('are known to the Android shell, one channel per sound', () => {
    const notifications = java('MessageNotifications.java');
    for (const tone of NOTIFY_TONES) {
      expect(notifications).toContain(`case "${tone}":`);
      expect(notifications).toContain(`R.raw.river_tone_${tone}`);
    }
    expect(notifications).toContain('"messages_tone_" + sound');
  });

  it('are known to the iPhone shell', () => {
    const tones = /tones: Set<String> = \[([^\]]+)\]/.exec(swift)?.[1] ?? '';
    expect(new Set([...tones.matchAll(/"([a-z]+)"/g)].map((m) => m[1]))).toEqual(new Set(NOTIFY_TONES));
  });
});

describe('grouped notifications, Mark as read and badges in the shells', () => {
  it('Android: clears a read conversation, marks read from the notification, groups under a summary', () => {
    const host = java('CoreHost.java');
    expect(host).toContain('case "notifyClear":');
    expect(host).toContain('NotificationReplyReceiver.ACTION_READ');
    expect(host).toContain('SEMANTIC_ACTION_MARK_AS_READ');
    expect(java('NotificationReplyReceiver.java')).toContain('notificationMarkedRead');
    const notifications = java('MessageNotifications.java');
    expect(notifications).toContain('setGroupSummary(true)');
    expect(notifications).toContain('GROUP_ALERT_CHILDREN');
    // The summary names chats only when previews show names, and keeps the lock screen generic.
    expect(notifications).toContain('setPublicVersion');
  });

  it('iPhone: threads per conversation, Mark as read, clearing and the badge', () => {
    expect(swift).toContain('content.threadIdentifier');
    expect(swift).toContain('case "notifyClear":');
    expect(swift).toContain('case "badge":');
    expect(swift).toContain('setBadgeCount');
    expect(swift).toContain('"Mark as read"');
  });
});
