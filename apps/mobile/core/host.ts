import { decodeWire, encodeWire, type CoreInbound, type CoreOutbound } from '../shared/wire.ts';

/**
 * The client core's side of the phone bridge. The app shell delivers UI calls
 * with `__riverCore.receive(json)` and takes the core's messages through
 * `RiverHost.post(json)`. Nothing else can reach the core: it runs in its own
 * WebView with no UI and no network access other than River servers.
 */

interface ShellInterface {
  post(json: string): void;
}

type Handler = (event: unknown, ...args: unknown[]) => unknown;
type Listener = (event: unknown, ...args: unknown[]) => void;

const handlers = new Map<string, Handler>();
const listeners = new Map<string, Listener[]>();
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const lifecycle = new Set<(state: 'foreground' | 'background') => void>();
let nextAsk = 1;

function shell(): ShellInterface {
  const s = (globalThis as { RiverHost?: ShellInterface }).RiverHost;
  if (!s) throw new Error('River app shell is not available');
  return s;
}

export function post(message: CoreOutbound): void {
  shell().post(encodeWire(message));
}

/** The UI's frame, as Electron would describe it: River's own page, main frame. */
const uiFrame = { url: 'river://app/index.html' };
const uiContents = {
  id: 1,
  mainFrame: uiFrame,
  isDestroyed: (): boolean => false,
  send: (channel: string, ...args: unknown[]): void => post({ t: 'event', channel, args }),
};
const uiEvent = { sender: uiContents, senderFrame: uiFrame };

export const ui = uiContents;

export function handle(channel: string, handler: Handler): void {
  if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
  handlers.set(channel, handler);
}

export function on(channel: string, listener: Listener): void {
  listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
}

/** Asks the app shell to do something only it can (dialogs, opening links, saving files). */
export function ask<T = unknown>(kind: string, args: unknown): Promise<T> {
  const id = nextAsk++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    post({ t: 'ask', id, kind, args });
  });
}

export function onLifecycle(fn: (state: 'foreground' | 'background') => void): () => void {
  lifecycle.add(fn);
  return () => lifecycle.delete(fn);
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function invoke(id: number, channel: string, args: unknown[]): Promise<void> {
  const handler = handlers.get(channel);
  if (!handler) {
    post({ t: 'reply', id, ok: false, error: `No handler registered for '${channel}'` });
    return;
  }
  try {
    const value = await handler(uiEvent, ...args);
    post({ t: 'reply', id, ok: true, value });
  } catch (err) {
    post({ t: 'reply', id, ok: false, error: message(err) });
  }
}

export function receive(json: string): void {
  const msg = decodeWire<CoreInbound>(json);
  switch (msg.t) {
    case 'invoke':
      void invoke(msg.id, msg.channel, msg.args);
      break;
    case 'send':
      for (const l of listeners.get(msg.channel) ?? []) {
        try {
          l(uiEvent, ...msg.args);
        } catch {
          // a bad fire-and-forget message is dropped, as in Electron
        }
      }
      break;
    case 'answer': {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) p?.resolve(msg.value);
      else p?.reject(new Error(msg.error ?? 'failed'));
      break;
    }
    case 'lifecycle':
      for (const fn of lifecycle) fn(msg.state);
      break;
  }
}
