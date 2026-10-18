import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * River for Android's manifest and notification plumbing, checked without a
 * JDK (the Java first compiles in CI): what Android 14+ refuses at run time
 * — a foreground service type without its permission, a component other apps
 * could reach — and notification numbers that could collide.
 */

const MAIN = resolve(import.meta.dirname, '../../apps/mobile/android/app/src/main');
const manifest = readFileSync(join(MAIN, 'AndroidManifest.xml'), 'utf8');
const JAVA = join(MAIN, 'java/io/github/martexdev/river');
const java = (file: string): string => readFileSync(join(JAVA, file), 'utf8');

const permissions = new Set(
  [...manifest.matchAll(/<uses-permission\s+android:name="android\.permission\.([A-Z_]+)"/g)].map(
    (m) => m[1]!,
  ),
);

/** Each <service>, <receiver>, <activity> or <provider> element with its attributes. */
const components = [...manifest.matchAll(/<(service|receiver|activity|provider)\b([^>]*)>/g)].map((m) => ({
  kind: m[1]!,
  attrs: m[2]!,
  name: /android:name="([^"]+)"/.exec(m[2]!)?.[1] ?? '',
}));

describe('River for Android: manifest', () => {
  it('declares the permission for every foreground service type (Android 14+ refuses the start otherwise)', () => {
    const services = components.filter((c) => c.kind === 'service');
    expect(services.length).toBeGreaterThan(0);
    expect(permissions.has('FOREGROUND_SERVICE')).toBe(true);
    for (const s of services) {
      const types = /android:foregroundServiceType="([^"]+)"/.exec(s.attrs)?.[1];
      expect(types, `${s.name} has no foregroundServiceType`).toBeDefined();
      for (const type of types!.split('|')) {
        const permission = `FOREGROUND_SERVICE_${type.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
        expect(permissions.has(permission), `${s.name}: ${permission}`).toBe(true);
      }
    }
  });

  it('lets no other app reach River’s services and receivers, nor its call screen', () => {
    for (const c of components) {
      if (c.name === '.MainActivity') continue;
      expect(c.attrs, `${c.name} must say exported="false"`).toMatch(/android:exported="false"/);
    }
  });

  it('may watch the network (2.12: reconnect at once on Wi-Fi ↔ mobile data)', () => {
    expect(permissions.has('ACCESS_NETWORK_STATE')).toBe(true);
    expect(java('core/CoreHost.java')).toContain('registerDefaultNetworkCallback');
    expect(java('core/CoreHost.java')).toContain('unregisterNetworkCallback');
  });

  it('declares what the Java asks Android for', () => {
    for (const permission of [
      'POST_NOTIFICATIONS', // MainActivity: Android 13+ asks
      'USE_FULL_SCREEN_INTENT', // IncomingCall: the call screen over the lock screen
      'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', // PhoneState: Android's own question
      'RECEIVE_BOOT_COMPLETED', // BootReceiver
      'WAKE_LOCK', // Watchdog, ringing, the proximity sensor
      'VIBRATE', // Ringer
      'REQUEST_INSTALL_PACKAGES', // UpdateOps
      'RECORD_AUDIO', // calls
    ]) {
      expect(permissions.has(permission), permission).toBe(true);
    }
  });
});

describe('River over a locked phone (Android, 2.18)', () => {
  it('shows only the full-screen call there, without its way back to the chats', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../apps/mobile/ui/phone.css'), 'utf8');
    expect(css).toMatch(/html\[data-over-lock\] body > \* \{\s*visibility: hidden !important;/);
    expect(css).toMatch(/html\[data-over-lock\] \.dm-call--full \{\s*visibility: visible !important;/);
    expect(css).toMatch(
      /html\[data-over-lock\] \.dm-call--full \.dm-call__min \{\s*visibility: hidden !important;/,
    );
    const shell = readFileSync(resolve(import.meta.dirname, '../../apps/mobile/ui/shell.ts'), 'utf8');
    expect(shell).toContain("OVER_LOCK_CHANNEL = 'river:app:overLock'");
  });

  it('is told so by Android, which shows River there only for a call it knows of', () => {
    const main = java('MainActivity.java');
    expect(main).toContain('river:app:overLock');
    // The "call" extra of an intent any app can send is not enough on its own.
    expect(main).not.toMatch(/getBooleanExtra\(CoreHost\.EXTRA_CALL, false\)\)\s*showOverLock\(true\)/);
    expect(main).toMatch(
      /getBooleanExtra\(CoreHost\.EXTRA_CALL, false\) && \(tapped \|\| core\.callMayShowOverLock\(\)\)\)\s*showOverLock\(true\)/,
    );
    expect(java('core/CoreHost.java')).toMatch(
      /public boolean callMayShowOverLock\(\) \{\s*return overLockForCall \|\| inCall;/,
    );
  });
});

describe('Lock River (2.18)', () => {
  it('hides River under its cover from screen readers and the keyboard, not only from sight', () => {
    const lock = java('core/AppLock.java');
    expect(lock).toContain('IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS');
    expect(lock).toMatch(/focused\.clearFocus\(\)/);
    expect(lock).toMatch(/box\.requestFocus\(\)/);
    // and gives them back when River is unlocked
    expect(lock).toMatch(/private void hide\(\) \{[\s\S]*setImportantForAccessibility\(e\.getValue\(\)\)/);
    const ios = readFileSync(
      resolve(import.meta.dirname, '../../apps/mobile/ios/RiverNative/Sources/AppLock.swift'),
      'utf8',
    );
    expect(ios).toContain('box.accessibilityViewIsModal = true');
    expect(ios).toContain('view.endEditing(true)');
  });
});

describe('River for Android: notification numbers', () => {
  /** The fixed notification numbers River's own notifications use (service, call, ringing, notices). */
  const fixed = (): Map<string, number> => {
    const out = new Map<string, number>();
    for (const file of readdirSync(join(JAVA, 'core')).filter((f) => f.endsWith('.java'))) {
      for (const m of java(`core/${file}`).matchAll(
        /static final int (NOTIFICATION|UPDATE|STOPPED) = (0x[0-9a-fA-F]+);/g,
      )) {
        out.set(`${file}:${m[1]}`, Number.parseInt(m[2]!, 16));
      }
    }
    return out;
  };

  it('never collide with each other or with message notifications (numbered from 1)', () => {
    const ids = fixed();
    expect(ids.size).toBeGreaterThanOrEqual(5);
    expect(new Set(ids.values()).size).toBe(ids.size);
    const max = /MAX_MESSAGE_NOTIFICATION = (0x[0-9a-fA-F]+);/.exec(java('core/CoreHost.java'))?.[1];
    expect(max).toBeDefined();
    for (const [where, id] of ids) expect(id, where).toBeGreaterThan(Number.parseInt(max!, 16));
  });
});
