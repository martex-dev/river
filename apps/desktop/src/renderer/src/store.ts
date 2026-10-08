import { create } from 'zustand';
import type { AppInfo, SecurityStatus, UpdateStatus } from '../../shared/ipc.ts';
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
  loadError: string | null;
  navigate(section: Section): void;
  load(): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<void>;
  setUpdate(status: UpdateStatus): void;
  checkForUpdates(): Promise<void>;
}

export const useRiver = create<RiverState>((set) => ({
  section: 'home',
  info: null,
  settings: null,
  update: { state: 'idle' },
  security: null,
  loadError: null,
  navigate: (section) => set({ section }),
  load: async () => {
    try {
      const [info, settings, update, security] = await Promise.all([
        window.river.app.info(),
        window.river.settings.get(),
        window.river.updates.status(),
        window.river.security.status(),
      ]);
      set({ info, settings, update, security, loadError: null });
    } catch (err) {
      set({ loadError: (err as Error).message });
    }
  },
  updateSettings: async (patch) => {
    const settings = await window.river.settings.update(patch);
    set({ settings });
  },
  setUpdate: (update) => set({ update }),
  checkForUpdates: async () => {
    set({ update: { state: 'checking' } });
    set({ update: await window.river.updates.check() });
  },
}));
