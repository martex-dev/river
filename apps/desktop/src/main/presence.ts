import type { ChosenStatus } from '@river/protocol';
import type { Settings } from '../shared/settings.ts';

/** Away from the computer this long while Online shows as Idle. */
export const AUTO_IDLE_SECONDS = 10 * 60;
const CHECK_EVERY_MS = 30_000;

export interface CustomStatus {
  text: string;
  emoji: string;
  /** ISO time it clears itself, or null. */
  until: string | null;
}

/**
 * Works out how this person appears (1.0.17): their chosen status, turned to
 * Idle after a while away from the computer (only while Online), and their
 * custom status until it expires. Calls `onChange` when either changes.
 */
export class PresenceTracker {
  private readonly settings: () => Settings['presence'];
  private readonly idleSeconds: () => number;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private last = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: { settings: () => Settings['presence']; idleSeconds: () => number; now?: () => number }) {
    this.settings = deps.settings;
    this.idleSeconds = deps.idleSeconds;
    this.now = deps.now ?? Date.now;
    this.last = this.fingerprint();
  }

  /** The status others should see right now. */
  status(): ChosenStatus {
    const s = this.settings();
    if (s.status === 'online' && s.autoIdle && this.idleSeconds() >= AUTO_IDLE_SECONDS) return 'idle';
    return s.status;
  }

  custom(): CustomStatus | null {
    const s = this.settings();
    if (!s.customText && !s.customEmoji) return null;
    if (s.customUntil && Date.parse(s.customUntil) <= this.now()) return null;
    return { text: s.customText, emoji: s.customEmoji, until: s.customUntil };
  }

  /** Do Not Disturb: no desktop notifications and no notification sounds. */
  quiet(): boolean {
    return this.settings().status === 'dnd';
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-checks (settings changed, or periodically for idle and expiry). */
  check(): void {
    const next = this.fingerprint();
    if (next === this.last) return;
    this.last = next;
    for (const l of this.listeners) l();
  }

  start(): void {
    this.timer ??= setInterval(() => this.check(), CHECK_EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private fingerprint(): string {
    return JSON.stringify([this.status(), this.custom()]);
  }
}
