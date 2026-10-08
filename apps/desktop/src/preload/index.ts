import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type RiverApi, type UpdateStatus } from '../shared/ipc.ts';

// The only surface the UI gets. No Node, no ipcRenderer, no arbitrary channels.
const api: RiverApi = {
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    openDownloadPage: () => ipcRenderer.invoke(IPC.updatesOpenDownload),
    onStatus: (listener) => {
      const handler = (_event: unknown, status: UpdateStatus): void => listener(status);
      ipcRenderer.on(IPC.updatesStatusChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.updatesStatusChanged, handler);
      };
    },
  },
  security: { status: () => ipcRenderer.invoke(IPC.securityStatus) },
  links: { open: (id) => ipcRenderer.invoke(IPC.openLink, id) },
};

contextBridge.exposeInMainWorld('river', api);
