import { create } from 'zustand';
import type {
  AccountStatus,
  AppInfo,
  IdentityInfo,
  SecurityStatus,
  StorageStatus,
  UpdateStatus,
} from '../../shared/ipc.ts';
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
  account: AccountStatus;
  /** undefined while loading; null when no identity exists yet. */
  identity: IdentityInfo | null | undefined;
  /** True while the first-run flow is on screen (kept until the user leaves the final step). */
  onboarding: boolean;
  loadError: string | null;
  navigate(section: Section): void;
  load(): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<void>;
  setUpdate(status: UpdateStatus): void;
  setStorage(status: StorageStatus): Promise<void>;
  setAccount(status: AccountStatus): Promise<void>;
  identityCreated(identity: IdentityInfo): Promise<void>;
  finishOnboarding(): void;
  checkForUpdates(): Promise<void>;
}

export const useRiver = create<RiverState>((set) => ({
  section: 'home',
  info: null,
  settings: null,
  update: { state: 'idle' },
  security: null,
  storage: { state: 'opening' },
  identity: undefined,
  account: { state: 'none' },
  onboarding: false,
  loadError: null,
  navigate: (section) => set({ section }),
  load: async () => {
    try {
      const [info, settings, update, security, storage, identity, account] = await Promise.all([
        window.river.app.info(),
        window.river.settings.get(),
        window.river.updates.status(),
        window.river.security.status(),
        window.river.storage.status(),
        window.river.identity.get(),
        window.river.account.status(),
      ]);
      set({
        info,
        settings,
        update,
        security,
        storage,
        identity,
        account,
        onboarding: storage.state === 'open' && identity === null,
        loadError: null,
      });
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
    const [security, identity] = await Promise.all([
      window.river.security.status(),
      window.river.identity.get(),
    ]);
    set({ security, identity, onboarding: storage.state === 'open' && identity === null });
  },
  setAccount: async (account) => {
    set({ account, security: await window.river.security.status() });
  },
  identityCreated: async (identity) => {
    set({ identity, security: await window.river.security.status() });
  },
  finishOnboarding: () => set({ onboarding: false, section: 'home' }),
  checkForUpdates: async () => {
    set({ update: { state: 'checking' } });
    set({ update: await window.river.updates.check() });
  },
}));
