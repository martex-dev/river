import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HIDDEN_MARKER_MAX_AGE_MS,
  IDLE_MS,
  autoInstallAllowed,
  installWithHiddenMarker,
  shouldAutoInstall,
  takeHiddenMarker,
  type AutoInstallState,
} from '../src/main/updater/auto-install.ts';

describe('the start-hidden-after-update marker', () => {
  const marker = (): string => join(mkdtempSync(join(tmpdir(), 'river-hidden-')), 'marker');

  it('installs a manually downloaded verified update too: only the install toggle decides', () => {
    expect(autoInstallAllowed({ installOnQuit: true })).toBe(true);
    expect(autoInstallAllowed({ installOnQuit: false })).toBe(false);
  });
  it('is kept when the install starts from the tray, and taken once', () => {
    const m = marker();
    expect(installWithHiddenMarker(m, true, () => true)).toBe(true);
    expect(takeHiddenMarker(m)).toBe(true);
    expect(takeHiddenMarker(m)).toBe(false);
  });
  it('is removed when the install is refused, so the next launch shows the window', () => {
    const m = marker();
    expect(installWithHiddenMarker(m, true, () => false)).toBe(false);
    expect(existsSync(m)).toBe(false);
    const thrown = marker();
    expect(() =>
      installWithHiddenMarker(thrown, true, () => {
        throw new Error('boom');
      }),
    ).toThrow();
    expect(existsSync(thrown)).toBe(false);
  });
  it('is not written when River was on screen', () => {
    const m = marker();
    installWithHiddenMarker(m, false, () => true);
    expect(existsSync(m)).toBe(false);
  });
  it('a stale marker (a silent install that failed) is ignored and removed', () => {
    const m = marker();
    writeFileSync(m, '1');
    const old = (Date.now() - HIDDEN_MARKER_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(m, old, old);
    expect(takeHiddenMarker(m)).toBe(false);
    expect(existsSync(m)).toBe(false);
  });
});

const base: AutoInstallState = {
  ready: true,
  allowed: true,
  inCall: false,
  windowVisible: false,
  lastFocusAt: 0,
  hosting: false,
  now: 1_000_000_000,
  hour: 14,
};

describe('installing updates by itself', () => {
  it('restarts into a verified update while River is in the tray', () => {
    expect(shouldAutoInstall(base)).toBe(true);
  });
  it('never during a call, without a verified update, or when the user turned it off', () => {
    expect(shouldAutoInstall({ ...base, inCall: true })).toBe(false);
    expect(shouldAutoInstall({ ...base, ready: false })).toBe(false);
    expect(shouldAutoInstall({ ...base, allowed: false })).toBe(false);
  });
  it('waits while the window is in use, and installs once it was left alone for a while', () => {
    const open = { ...base, windowVisible: true };
    expect(shouldAutoInstall({ ...open, lastFocusAt: base.now - 60_000 })).toBe(false);
    expect(shouldAutoInstall({ ...open, lastFocusAt: base.now - IDLE_MS })).toBe(true);
  });
  it('a PC that hosts River restarts only at night', () => {
    expect(shouldAutoInstall({ ...base, hosting: true, hour: 14 })).toBe(false);
    expect(shouldAutoInstall({ ...base, hosting: true, hour: 3 })).toBe(true);
    expect(shouldAutoInstall({ ...base, hosting: true, hour: 5 })).toBe(false);
    // At night too, not while someone is using River on that PC.
    expect(
      shouldAutoInstall({
        ...base,
        hosting: true,
        hour: 3,
        windowVisible: true,
        lastFocusAt: base.now - 1000,
      }),
    ).toBe(false);
  });
});
