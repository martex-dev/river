import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

/**
 * Runs River's mobile core bundle the way the phone does: a single JavaScript
 * context whose only ways out are RiverNative.call (synchronous) and
 * RiverHost.post. Native calls are answered by the test's main thread
 * (node-native.ts) while this thread waits on a SharedArrayBuffer, which is
 * how a synchronous Android JavaScript interface behaves.
 */

const { bundle, shared } = workerData as { bundle: string; shared: SharedArrayBuffer };
const state = new Int32Array(shared, 0, 2);
const bytes = new Uint8Array(shared, 8);

// The phone has no Node Buffer: the bundle must bring its own.
delete (globalThis as { Buffer?: unknown }).Buffer;

(globalThis as Record<string, unknown>).RiverNative = {
  call(method: string, argsJson: string): string {
    Atomics.store(state, 0, 0);
    parentPort!.postMessage({ native: method, args: argsJson });
    Atomics.wait(state, 0, 0);
    const length = Atomics.load(state, 1);
    return new TextDecoder().decode(bytes.slice(0, length));
  },
};

(globalThis as Record<string, unknown>).RiverHost = {
  post(header: string, payload: string): void {
    parentPort!.postMessage({ header, payload });
  },
};

type Inbound = { [K in 'invoke' | 'send' | 'answer' | 'lifecycle' | 'uiGone']: (...args: never[]) => void };

// The shell's calls into the core, as Android's evaluateJavascript makes them.
parentPort!.on('message', (msg: { call?: keyof Inbound; args?: unknown[] }) => {
  if (!msg.call) return;
  const core = (globalThis as unknown as { __riverCore: Inbound }).__riverCore;
  (core[msg.call] as (...args: unknown[]) => void)(...(msg.args ?? []));
});

await import(pathToFileURL(bundle).href);
