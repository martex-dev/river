import { create } from 'zustand';
import type { AppInfo, SecurityStatus, StorageStatus, UpdateStatus } from '../../shared/ipc.ts';
import type { Settings, SettingsPatch } from '../../shared/settings.ts';

export const SECTIONS = [
  'home',
  'messages',
  'communities',
  'social',
  'calls',
  'files',
  'contacts',
  'security',
  'settings',
] as const;
export type Section = (typeof SECTIONS)[number];

interface RiverState {
  section: Section;
  info: AppInfo | null;
  settings: Settings | null;
  update: UpdateStatus;
  security: SecurityStatus | null;
  storage: StorageStatus;
  loadError: string | null;
  navigate(section: Section): void;
  load(): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<void>;
  setUpdate(status: UpdateStatus): void;
  setStorage(status: StorageStatus): Promise<void>;
  checkForUpdates(): Promise<void>;
}

export const useRiver = create<RiverState>((set) => ({
  section: 'home',
  info: null,
  settings: null,
  update: { state: 'idle' },
  security: null,
  storage: { state: 'opening' },
  loadError: null,
  navigate: (section) => set({ section }),
  load: async () => {
    try {
      const [info, settings, update, security, storage] = await Promise.all([
        window.river.app.info(),
        window.river.settings.get(),
        window.river.updates.status(),
        window.river.security.status(),
        window.river.storage.status(),
      ]);
      set({ info, settings, update, security, storage, loadError: null });
    } catch (err) {
      set({ loadError: (err as Error).message });
    }
  },
  updateSettings: async (patch) => {
    const settings = await window.river.settings.update(patch);
    set({ settings });
    // Some security indicators depend on settings (e.g. the configured server).
    set({ security: await window.river.security.status() });
  },
  setUpdate: (update) => set({ update }),
  setStorage: async (storage) => {
    set({ storage });
    set({ security: await window.river.security.status() });
  },
  checkForUpdates: async () => {
    set({ update: { state: 'checking' } });
    set({ update: await window.river.updates.check() });
  },
}));
