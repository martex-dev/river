import { contextBridge, ipcRenderer } from 'electron';
import { createRiverApi } from '../shared/river-api.ts';

// The only surface the UI gets. No Node, no ipcRenderer, no arbitrary channels.
const api = createRiverApi({
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args) as Promise<never>,
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, listener) => {
    const handler = (_event: unknown, ...args: unknown[]): void => listener(...args);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
});

contextBridge.exposeInMainWorld('river', api);
