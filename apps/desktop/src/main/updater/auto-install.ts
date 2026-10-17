/**
 * When River may restart into a verified update by itself (2.10.13). Closing River's window
 * only hides it in the tray, so "install on quit" alone left people on old versions for weeks.
 */

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
