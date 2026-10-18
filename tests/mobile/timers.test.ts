import { describe, expect, it } from 'vitest';
import { installWorkerTimers, type WorkerLike } from '../../apps/mobile/core/timers.ts';

/** A stand-in for timer-worker.js: the same protocol, on Node's timers. */
function fakeWorker(opts: { ready?: boolean; fail?: boolean } = {}): WorkerLike & { posted: unknown[] } {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const w: WorkerLike & { posted: unknown[] } = {
    posted: [],
    onmessage: null,
    onerror: null,
    postMessage(message: unknown) {
      w.posted.push(message);
      const [op, id, ms] = message as [string, number, number];
      if (op === 'clear') {
        clearTimeout(timers.get(id));
        clearInterval(timers.get(id));
        timers.delete(id);
      } else if (op === 'once') {
        timers.set(
          id,
          setTimeout(() => w.onmessage?.({ data: id }), ms),
        );
      } else if (op === 'every') {
        timers.set(
          id,
          setInterval(() => w.onmessage?.({ data: id }), ms),
        );
      }
    },
    terminate() {
      for (const t of timers.values()) clearInterval(t);
    },
  };
  setTimeout(() => {
    if (opts.fail) w.onerror?.(new Error('no workers here'));
    else if (opts.ready !== false) w.onmessage?.({ data: 0 });
  }, 1);
  return w;
}

const target = () => ({
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('core timers in a worker (hidden WebViews slow their own timers down)', () => {
  it('routes timeouts and intervals through the worker once it answers', async () => {
    const t = target();
    const w = fakeWorker();
    expect(await installWorkerTimers(() => w, t as never)).toBe(true);
    const got: string[] = [];
    t.setTimeout(((a: string, b: string) => got.push(a + b)) as never, 5, 'x', 'y');
    let ticks = 0;
    const every = t.setInterval((() => ticks++) as never, 5);
    const cancelled = t.setTimeout((() => got.push('never')) as never, 5);
    t.clearTimeout(cancelled);
    await wait(40);
    t.clearInterval(every);
    const after = ticks;
    await wait(20);
    expect(got).toEqual(['xy']);
    expect(after).toBeGreaterThanOrEqual(2);
    expect(ticks).toBe(after);
    expect(w.posted.some((m) => (m as unknown[])[0] === 'every')).toBe(true);
  });

  it("still clears the browser's own timers made before the switch", async () => {
    const t = target();
    let fired = false;
    const early = t.setTimeout(() => (fired = true), 30);
    expect(await installWorkerTimers(() => fakeWorker(), t as never)).toBe(true);
    t.clearTimeout(early);
    await wait(50);
    expect(fired).toBe(false);
  });

  it('keeps the browser timers when the worker cannot start, fails or never answers', async () => {
    for (const make of [
      () => {
        throw new Error('blocked');
      },
      () => fakeWorker({ fail: true }),
      () => fakeWorker({ ready: false }),
    ]) {
      const t = target();
      const before = t.setTimeout;
      expect(await installWorkerTimers(make as () => WorkerLike, t as never, 20)).toBe(false);
      expect(t.setTimeout).toBe(before);
    }
  });

  it('a callback that throws does not stop the others', async () => {
    const t = target();
    expect(await installWorkerTimers(() => fakeWorker(), t as never)).toBe(true);
    const errors: unknown[] = [];
    const onError = (err: unknown) => errors.push(err);
    process.on('uncaughtException', onError);
    try {
      let ok = false;
      t.setTimeout(
        (() => {
          throw new Error('boom');
        }) as never,
        1,
      );
      t.setTimeout((() => (ok = true)) as never, 5);
      await wait(30);
      expect(ok).toBe(true);
      expect(errors).toHaveLength(1);
    } finally {
      process.off('uncaughtException', onError);
    }
  });
});
