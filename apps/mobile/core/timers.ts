/**
 * Timers that keep time in a hidden WebView (2.13.1).
 *
 * The phone's core runs in a WebView that is never shown. Browsers slow timers in hidden pages
 * down — after five minutes, chained timers run about once a minute ("intensive wake-up
 * throttling") — so polling for a device link, reconnect backoff, call timeouts and the watchdog
 * all crawled. A dedicated worker's timers are not throttled that way: the worker keeps time and
 * posts which timer is due, and the callback runs here as before.
 *
 * The switch happens only after the worker answers. If it cannot start (a platform that does not
 * allow workers from the core's origin), the browser's own timers stay in use.
 */

type Callback = (...args: unknown[]) => void;

export interface WorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

interface Timers {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
}

/** IDs far above the browser's own, so clearing one of the browser's timers still works. */
const FIRST_ID = 1_000_000_000;

/**
 * Starts the worker and, once it answers, routes `target`'s timers through it. Returns a promise
 * that says whether the switch happened.
 */
export function installWorkerTimers(
  makeWorker: () => WorkerLike,
  target: Timers = globalThis as unknown as Timers,
  waitMs = 3000,
): Promise<boolean> {
  const native: Timers = {
    setTimeout: target.setTimeout.bind(globalThis) as Timers['setTimeout'],
    clearTimeout: target.clearTimeout.bind(globalThis) as Timers['clearTimeout'],
    setInterval: target.setInterval.bind(globalThis) as Timers['setInterval'],
    clearInterval: target.clearInterval.bind(globalThis) as Timers['clearInterval'],
  };
  let worker: WorkerLike;
  try {
    worker = makeWorker();
  } catch {
    return Promise.resolve(false);
  }
  const due = new Map<number, { fn: Callback; args: unknown[]; repeat: boolean }>();
  let next = FIRST_ID;

  const run = (id: number): void => {
    const t = due.get(id);
    if (!t) return;
    if (!t.repeat) due.delete(id);
    try {
      t.fn(...t.args);
    } catch (err) {
      // Reported as uncaught, as a throwing timer callback is in the browser.
      queueMicrotask(() => {
        throw err;
      });
    }
  };
  const add = (fn: unknown, ms: unknown, args: unknown[], repeat: boolean): number => {
    if (typeof fn !== 'function') return 0;
    const id = next++;
    due.set(id, { fn: fn as Callback, args, repeat });
    const delay = Math.max(0, Number(ms) || 0);
    worker.postMessage([repeat ? 'every' : 'once', id, delay]);
    return id;
  };
  const clear = (id: unknown, nativeClear: (id: never) => void): void => {
    const n = typeof id === 'number' ? id : Number(id);
    if (due.delete(n)) worker.postMessage(['clear', n]);
    else nativeClear(id as never);
  };

  return new Promise((resolve) => {
    let settled = false;
    const giveUp = native.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        worker.terminate();
      } catch {
        // already gone
      }
      resolve(false);
    }, waitMs);
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      native.clearTimeout(giveUp);
      try {
        worker.terminate();
      } catch {
        // already gone
      }
      resolve(false);
    };
    worker.onmessage = (e) => {
      const id = Number(e.data);
      if (id !== 0) return run(id);
      if (settled) return;
      settled = true;
      native.clearTimeout(giveUp);
      target.setTimeout = ((fn: unknown, ms?: unknown, ...args: unknown[]) =>
        add(fn, ms, args, false)) as unknown as Timers['setTimeout'];
      target.setInterval = ((fn: unknown, ms?: unknown, ...args: unknown[]) =>
        add(fn, ms, args, true)) as unknown as Timers['setInterval'];
      target.clearTimeout = ((id?: unknown) => clear(id, native.clearTimeout)) as Timers['clearTimeout'];
      target.clearInterval = ((id?: unknown) => clear(id, native.clearInterval)) as Timers['clearInterval'];
      resolve(true);
    };
  });
}
