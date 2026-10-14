import { create } from 'zustand';
import type {
  AccountStatus,
  AppInfo,
  IdentityInfo,
  SecurityStatus,
  StorageStatus,
  UpdateStatus,
} from '../../shared/ipc.ts';
import { setSoundConfigSource } from './community/sound.ts';
import { silenced } from '../../shared/notify-rules.ts';
import type { Settings, SettingsPatch } from '../../shared/settings.ts';
import type { DesignSettings } from '../../shared/design.ts';

export const SECTIONS = [
  'home',
  'messages',
  'communities',
  'social',
  'calls',
  'files',
  'contacts',
  'admin',
  'security',
  'settings',
] as const;
export type Section = (typeof SECTIONS)[number];

/** Tabs of the Settings overlay (1.0.42): one place for user and app settings, like Discord. */
export const SETTINGS_TABS = [
  'account',
  'profile',
  'security',
  'backup',
  'appearance',
  'voice',
  'notifications',
  'system',
  'updates',
  'hosting',
  'about',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

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
  /** The Settings overlay's open tab, or null when closed. It sits over whatever is open. */
  settingsTab: SettingsTab | null;
  openSettings(tab?: SettingsTab): void;
  closeSettings(): void;
  /**
   * A design shown before it is saved: while a slider moves ('live', saved a moment later)
   * or while a theme is tried on from the browser ('try', until Apply or Cancel).
   */
  designPreview: DesignSettings | null;
  designTrying: boolean;
  setDesignPreview(design: DesignSettings | null, trying?: boolean): void;
  /** The "Create or join a community" screen is showing. */
  communityStart: boolean;
  setCommunityStart(open: boolean): void;
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
  settingsTab: null,
  openSettings: (tab) => set({ settingsTab: tab ?? 'account' }),
  closeSettings: () => set({ settingsTab: null }),
  designPreview: null,
  designTrying: false,
  setDesignPreview: (designPreview, trying = false) =>
    set({ designPreview, designTrying: designPreview ? trying : false }),
  communityStart: false,
  setCommunityStart: (open) =>
    set(open ? { communityStart: true, section: 'communities' } : { communityStart: false }),
  // Settings and Security open the overlay over the current view instead of replacing it.
  navigate: (section) =>
    section === 'settings'
      ? set({ settingsTab: 'account' })
      : section === 'security'
        ? set({ settingsTab: 'security' })
        : set({ section, settingsTab: null, communityStart: false }),
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

// Interface sounds follow Settings → Notifications (master switch, volume, groups).
setSoundConfigSource(() => {
  const s = useRiver.getState().settings;
  return s ? { ...s.notifications, quiet: silenced(s) } : undefined;
});
