import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Keeps River from failing to open without a word (1.0.16).
 *
 * Before this, an error while starting left an invisible River running that
 * held the single-instance lock, so every later launch quit at once and the
 * app seemed impossible to open until a restart. A graphics driver that
 * crashed Chromium's GPU process could also leave the window blank forever.
 */

/** A short, plain report of a startup failure that people can copy into a message. */
export function describeStartupError(err: unknown, context: { version: string; platform: string }): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const firstFrames = (e.stack ?? '')
    .split('\n')
    .slice(1, 6)
    .map((l) => l.trim())
    .join('\n');
  return [
    `River ${context.version} (${context.platform}) could not start.`,
    `${e.name}: ${e.message}`,
    ...(firstFrames ? [firstFrames] : []),
  ].join('\n');
}

/** What River knows about the graphics process across launches. */
export interface GpuState {
  /** Hardware acceleration is off because the graphics process kept crashing. */
  disabled: boolean;
  /** Crashes counted during the last run. */
  crashes: number;
  reason?: string;
}

export const GPU_CRASHES_BEFORE_FALLBACK = 2;

export function readGpuState(path: string): GpuState {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<GpuState>;
    return {
      disabled: raw.disabled === true,
      crashes: typeof raw.crashes === 'number' && raw.crashes >= 0 ? raw.crashes : 0,
      ...(typeof raw.reason === 'string' ? { reason: raw.reason.slice(0, 200) } : {}),
    };
  } catch {
    return { disabled: false, crashes: 0 };
  }
}

export function writeGpuState(path: string, state: GpuState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // Best effort: the fallback simply is not remembered.
  }
}

/**
 * Counts a graphics-process crash. Returns true when River should restart
 * with hardware acceleration turned off.
 */
export function recordGpuCrash(path: string, reason: string): boolean {
  const state = readGpuState(path);
  if (state.disabled) return false;
  const crashes = state.crashes + 1;
  const fallback = crashes >= GPU_CRASHES_BEFORE_FALLBACK;
  writeGpuState(path, { disabled: fallback, crashes, reason });
  return fallback;
}

/** How long to wait for the first paint before showing the window anyway. */
export const SHOW_WINDOW_FALLBACK_MS = 8000;
/** Renderer crashes tolerated (each followed by a reload) before River shows an error page. */
export const RENDERER_RELOADS = 3;
