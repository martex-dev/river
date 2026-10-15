import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createRiverApi } from '../../desktop/src/shared/river-api.ts';
import { decodeWire, encodeWire } from '../shared/wire.ts';

/**
 * window.river on a phone. The UI is untrusted exactly as on the desktop: it
 * can only send the same named calls, which the client core validates. The
 * app shell (RiverCorePlugin.java) carries them to the core's own WebView.
 */
interface RiverCorePlugin {
  invoke(options: { json: string }): Promise<{ json: string }>;
  send(options: { json: string }): Promise<void>;
  addListener(event: 'event', listener: (data: { json: string }) => void): Promise<PluginListenerHandle>;
}

const Core = registerPlugin<RiverCorePlugin>('RiverCore');

const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
void Core.addListener('event', ({ json }) => {
  const { channel, args } = decodeWire<{ channel: string; args: unknown[] }>(json);
  for (const l of listeners.get(channel) ?? []) l(...args);
});

const api = createRiverApi({
  async invoke(channel, ...args) {
    const { json } = await Core.invoke({ json: encodeWire({ channel, args }) });
    const reply = decodeWire<{ ok: boolean; value?: unknown; error?: string }>(json);
    if (!reply.ok) throw new Error(reply.error ?? `${channel} failed`);
    return reply.value as never;
  },
  send(channel, ...args) {
    void Core.send({ json: encodeWire({ channel, args }) });
  },
  on(channel, listener) {
    const set = listeners.get(channel) ?? new Set();
    set.add(listener);
    listeners.set(channel, set);
    return () => {
      set.delete(listener);
    };
  },
});

Object.defineProperty(window, 'river', { value: Object.freeze(api), writable: false, configurable: false });
