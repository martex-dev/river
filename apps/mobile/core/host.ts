import { decodeWire, encodeWire } from '../shared/wire.ts';

/**
 * The client core's side of the phone bridge. Nothing else can reach the core:
 * it runs in its own WebView with no UI.
 *
 * In (app shell → core), as calls on `globalThis.__riverCore`:
 *   invoke(id, json)   a UI call; json = {channel, args}
 *   send(json)         a UI fire-and-forget message; json = {channel, args}
 *   answer(id, json)   the shell's answer to an ask; json = {ok, value?, error?}
 *   lifecycle(state)   'foreground' | 'background'
 *
 * Out (core → app shell): `RiverHost.post(header, payload)`. The header is a
 * small JSON object the shell reads; the payload goes on untouched:
 *   {t:'ready'}               ''
 *   {t:'reply', id}           {ok, value?, error?}  → resolves the UI's call
 *   {t:'event'}               {channel, args}       → the UI's listeners
 *   {t:'ask', id, kind}       args                  → native dialogs, links, files
 *
 * Payloads use the wire encoding (shared/wire.ts) so bytes survive.
 */

interface ShellInterface {
  post(header: string, payload: string): void;
}

type Handler = (event: unknown, ...args: unknown[]) => unknown;
type Listener = (event: unknown, ...args: unknown[]) => void;

const handlers = new Map<string, Handler>();
const listeners = new Map<string, Listener[]>();
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const lifecycleListeners = new Set<(state: 'foreground' | 'background') => void>();
let nextAsk = 1;

function shell(): ShellInterface {
  const s = (globalThis as { RiverHost?: ShellInterface }).RiverHost;
  if (!s) throw new Error('River app shell is not available');
  return s;
}

const post = (header: object, payload = ''): void => shell().post(JSON.stringify(header), payload);

export function ready(): void {
  post({ t: 'ready' });
}

/** Tells the UI something happened, as webContents.send does on the desktop. */
export function emit(channel: string, args: unknown[]): void {
  post({ t: 'event' }, encodeWire({ channel, args }));
}

/** The UI's frame, as Electron would describe it: River's own page, main frame. */
const uiFrame = { url: 'river://app/index.html' };
const uiContents = {
  id: 1,
  mainFrame: uiFrame,
  isDestroyed: (): boolean => false,
  send: (channel: string, ...args: unknown[]): void => emit(channel, args),
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
    post({ t: 'ask', id, kind }, encodeWire(args));
  });
}

export function onLifecycle(fn: (state: 'foreground' | 'background') => void): () => void {
  lifecycleListeners.add(fn);
  return () => lifecycleListeners.delete(fn);
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function reply(id: number, body: { ok: boolean; value?: unknown; error?: string }): void {
  let payload: string;
  try {
    payload = encodeWire(body);
  } catch (err) {
    payload = encodeWire({ ok: false, error: `The reply could not be sent: ${message(err)}` });
  }
  post({ t: 'reply', id }, payload);
}

async function invoke(id: number, json: string): Promise<void> {
  let channel = '';
  try {
    const call = decodeWire<{ channel: string; args: unknown[] }>(json);
    channel = call.channel;
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for '${channel}'`);
    reply(id, { ok: true, value: await handler(uiEvent, ...(Array.isArray(call.args) ? call.args : [])) });
  } catch (err) {
    reply(id, { ok: false, error: message(err) });
  }
}

function send(json: string): void {
  try {
    const call = decodeWire<{ channel: string; args: unknown[] }>(json);
    for (const l of listeners.get(call.channel) ?? [])
      l(uiEvent, ...(Array.isArray(call.args) ? call.args : []));
  } catch {
    // a bad fire-and-forget message is dropped, as in Electron
  }
}

function answer(id: number, json: string): void {
  const p = pending.get(id);
  pending.delete(id);
  if (!p) return;
  try {
    const a = decodeWire<{ ok: boolean; value?: unknown; error?: string }>(json);
    if (a.ok) p.resolve(a.value);
    else p.reject(new Error(a.error ?? 'failed'));
  } catch (err) {
    p.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

function lifecycle(state: string): void {
  if (state !== 'foreground' && state !== 'background') return;
  for (const fn of lifecycleListeners) fn(state);
}

export const inbound = {
  invoke: (id: number, json: string): void => void invoke(id, json),
  send,
  answer,
  lifecycle,
};
