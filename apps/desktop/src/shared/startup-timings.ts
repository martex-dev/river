/**
 * How long River took to start, step by step (2.21): main marks when Electron is ready, the
 * local data is open, the window is made and first painted; the window marks when the chat list
 * has its chats. Times are milliseconds since the process (or the window's page) started. They
 * go to the log once and into Settings → System → Connection check; nothing else is recorded.
 */
export class StartupTimings {
  private readonly marks: Array<{ name: string; ms: number }> = [];
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** Records a step the first time it happens. */
  mark(name: string): void {
    if (this.marks.some((m) => m.name === name)) return;
    this.marks.push({ name, ms: Math.round(this.now()) });
  }

  get(name: string): number | null {
    return this.marks.find((m) => m.name === name)?.ms ?? null;
  }

  /** "ready 180 ms · data 240 ms · window 260 ms", or null before anything was marked. */
  summary(): string | null {
    return this.marks.length ? this.marks.map((m) => `${m.name} ${m.ms} ms`).join(' · ') : null;
  }
}
