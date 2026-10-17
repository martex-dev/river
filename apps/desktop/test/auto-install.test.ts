import { describe, expect, it } from 'vitest';
import { IDLE_MS, shouldAutoInstall, type AutoInstallState } from '../src/main/updater/auto-install.ts';

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
  });
});
