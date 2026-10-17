/**
 * When River may restart into a verified update by itself (2.10.13). Closing River's window
 * only hides it in the tray, so "install on quit" alone left people on old versions for weeks.
 */
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';

/** Not touched for this long counts as away. */
export const IDLE_MS = 10 * 60 * 1000;

export interface AutoInstallState {
  /** A verified update is ready to install. */
  ready: boolean;
  /** The user lets River install updates by itself (automatic download and install). */
  allowed: boolean;
  /** In a voice channel or a call: never restart then. */
  inCall: boolean;
  /** River's window is on screen (not hidden in the tray or minimized). */
  windowVisible: boolean;
  /** When River's window last had focus (ms), or null if never. */
  lastFocusAt: number | null;
  /** This PC hosts a River server: restarting drops everyone's connection for a moment. */
  hosting: boolean;
  now: number;
  /** Local hour of day, 0–23. */
  hour: number;
}

export function shouldAutoInstall(s: AutoInstallState): boolean {
  if (!s.ready || !s.allowed || s.inCall) return false;
  // A PC that hosts River restarts at night, when nobody is likely to be talking — and, like any
  // PC, only while nobody is using River on it.
  if (s.hosting && !(s.hour >= 3 && s.hour < 5)) return false;
  if (!s.windowVisible) return true;
  return s.lastFocusAt === null ? false : s.now - s.lastFocusAt >= IDLE_MS;
}

/**
 * "Install verified updates by themselves" covers every verified update, also one downloaded
 * with the Download button while automatic download is off (2.11.2). The Settings toggle never
 * depended on automatic download, so this must not either.
 */
export function autoInstallAllowed(prefs: { installOnQuit: boolean }): boolean {
  return prefs.installOnQuit;
}

/** A start-hidden marker older than this is from an update that never happened: ignored. */
export const HIDDEN_MARKER_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Restarts into the update and, when River was in the tray, leaves a marker so the updated River
 * starts in the tray again. The marker is removed when the install was refused (crash-loop hold,
 * manual mode), so a later manual launch is not hidden (2.11.2).
 */
export function installWithHiddenMarker(marker: string, hidden: boolean, installNow: () => boolean): boolean {
  if (hidden) {
    try {
      writeFileSync(marker, String(Date.now()));
    } catch {
      // shows the window after the update instead
    }
  }
  let started = false;
  try {
    started = installNow();
  } finally {
    if (!started && hidden) {
      try {
        rmSync(marker, { force: true });
      } catch {
        // takeHiddenMarker() ignores it once it is old
      }
    }
  }
  return started;
}

/**
 * True (once) when a fresh marker says to start in the tray. A stale marker, left by a silent
 * install that failed, is removed and ignored, so a manual launch shows the window.
 */
export function takeHiddenMarker(marker: string, now: number = Date.now()): boolean {
  try {
    if (!existsSync(marker)) return false;
    const age = now - statSync(marker).mtimeMs;
    rmSync(marker, { force: true });
    return age >= -60_000 && age <= HIDDEN_MARKER_MAX_AGE_MS;
  } catch {
    return false;
  }
}
