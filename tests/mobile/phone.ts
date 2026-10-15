import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { decodeWire, encodeWire } from '../../apps/mobile/shared/wire.ts';
import type { NativeMethod } from '../../apps/mobile/core/native.ts';
import { asyncMethods, createNodeNative, respond } from './node-native.ts';

/**
 * A phone in a test: River's mobile core bundle running in a worker with the
 * Node implementation of the native interface, driven through the same
 * messages the Android shell sends. `invoke` is what the UI's window.river does.
 */
export interface Phone {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, ...args: unknown[]): void;
  events: Array<{ channel: string; args: unknown[] }>;
  asks: Array<{ kind: string; args: unknown }>;
  nativeCalls: Map<string, number>;
  waitFor(channel: string, match?: (args: unknown[]) => boolean, timeoutMs?: number): Promise<unknown[]>;
  lifecycle(state: 'foreground' | 'background'): void;
  stop(): Promise<void>;
}

const SHARED_BYTES = 64 * 1024 * 1024;

export async function startPhone(bundle: string, root: string): Promise<Phone> {
  mkdirSync(join(root, 'files'), { recursive: true });
  mkdirSync(join(root, 'cache'), { recursive: true });
  const shared = new SharedArrayBuffer(8 + SHARED_BYTES);
  const state = new Int32Array(shared, 0, 2);
  const out = new Uint8Array(shared, 8);
  const native = createNodeNative(root);
  const worker = new Worker(new URL('./core-worker.ts', import.meta.url), { workerData: { bundle, shared } });

  const events: Phone['events'] = [];
  const asks: Phone['asks'] = [];
  const nativeCalls = new Map<string, number>();
  const replies = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const waiters = new Set<() => void>();
  let nextId = 1;
  let fatal: string | null = null;

  const call = (name: 'invoke' | 'send' | 'answer' | 'lifecycle', ...args: unknown[]): void =>
    worker.postMessage({ call: name, args });
  const answerNative = (json: string): void => {
    const encoded = new TextEncoder().encode(json);
    if (encoded.length > SHARED_BYTES) throw new Error('native result too large for the test bridge');
    out.set(encoded);
    Atomics.store(state, 1, encoded.length);
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0);
  };

  const ready = new Promise<void>((resolve, reject) => {
    worker.on('error', reject);
    worker.on(
      'message',
      (msg: { native?: NativeMethod; args?: string; header?: string; payload?: string }) => {
        if (msg.native) {
          const method = msg.native;
          nativeCalls.set(method, (nativeCalls.get(method) ?? 0) + 1);
          const args = JSON.parse(msg.args ?? '{}') as unknown;
          if (asyncMethods.has(method)) {
            void native.async(method, args).then(
              (v) => answerNative(JSON.stringify({ v: v ?? null })),
              (err: Error & { code?: string }) =>
                answerNative(JSON.stringify({ e: err.message, code: err.code })),
            );
          } else {
            answerNative(respond(() => native.sync(method, args)));
          }
          return;
        }
        if (typeof msg.header !== 'string') return;
        const header = JSON.parse(msg.header) as { t: string; id?: number; kind?: string };
        const payload = msg.payload ?? '';
        switch (header.t) {
          case 'ready':
            resolve();
            break;
          case 'reply': {
            const body = decodeWire<{ ok: boolean; value?: unknown; error?: string }>(payload);
            const r = replies.get(header.id!);
            replies.delete(header.id!);
            if (body.ok) r?.resolve(body.value);
            else r?.reject(new Error(body.error));
            break;
          }
          case 'event': {
            const { channel, args } = decodeWire<{ channel: string; args: unknown[] }>(payload);
            if (channel === 'core:fatal') {
              fatal = String(args[0]);
              reject(new Error(fatal));
            }
            events.push({ channel, args });
            for (const w of [...waiters]) w();
            break;
          }
          case 'ask': {
            const kind = header.kind ?? '';
            asks.push({ kind, args: decodeWire(payload) });
            // What a person tapping through the Android dialogs would answer.
            const value =
              kind === 'messageBox'
                ? { response: 0 }
                : kind === 'saveFile'
                  ? { canceled: true }
                  : kind === 'notify'
                    ? 'shown'
                    : null;
            call('answer', header.id, encodeWire({ ok: true, value }));
            break;
          }
        }
      },
    );
  });
  await ready;

  return {
    events,
    asks,
    nativeCalls,
    invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        replies.set(id, { resolve: resolve as (v: unknown) => void, reject });
        call('invoke', id, encodeWire({ channel, args }));
      });
    },
    send(channel, ...args) {
      call('send', encodeWire({ channel, args }));
    },
    lifecycle(s) {
      call('lifecycle', s);
    },
    waitFor(channel, match = () => true, timeoutMs = 15_000) {
      return new Promise((resolve, reject) => {
        const check = (): boolean => {
          const hit = events.find((e) => e.channel === channel && match(e.args));
          if (!hit) return false;
          waiters.delete(check as () => void);
          clearTimeout(timer);
          resolve(hit.args);
          return true;
        };
        const timer = setTimeout(() => {
          waiters.delete(check as () => void);
          reject(new Error(`timed out waiting for ${channel}${fatal ? ` (core failed: ${fatal})` : ''}`));
        }, timeoutMs);
        if (!check()) waiters.add(check as () => void);
      });
    },
    async stop() {
      await worker.terminate();
      native.close();
    },
  };
}
