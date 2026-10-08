import type { ReleaseChannel } from '@river/release/channels';
import type { Settings, SettingsPatch } from './settings.ts';

/** Every IPC channel River uses. Main validates every payload; nothing else is exposed. */
export const IPC = {
  appInfo: 'river:app:info',
  settingsGet: 'river:settings:get',
  settingsUpdate: 'river:settings:update',
  updatesStatus: 'river:updates:status',
  updatesCheck: 'river:updates:check',
  updatesInstall: 'river:updates:install',
  updatesOpenDownload: 'river:updates:open-download',
  updatesStatusChanged: 'river:updates:status-changed',
  securityStatus: 'river:security:status',
  serverCheck: 'river:server:check',
  openLink: 'river:link:open',
} as const;

/** Links the renderer may ask main to open. Arbitrary URLs are never accepted from the renderer. */
export const EXTERNAL_LINKS = {
  source: 'https://github.com/martex-dev/river',
  releases: 'https://github.com/martex-dev/river/releases',
  issues: 'https://github.com/martex-dev/river/issues',
  security: 'https://github.com/martex-dev/river/blob/main/SECURITY.md',
  privacy: 'https://github.com/martex-dev/river/blob/main/PRIVACY.md',
  threatModel: 'https://github.com/martex-dev/river/blob/main/THREAT_MODEL.md',
  license: 'https://github.com/martex-dev/river/blob/main/LICENSE',
} as const;
export type ExternalLinkId = keyof typeof EXTERNAL_LINKS;

export interface AppInfo {
  version: string;
  channel: ReleaseChannel;
  platform: string;
  arch: string;
  isPackaged: boolean;
  versions: { electron: string; chrome: string; node: string };
}

export type UpdateStatus =
  | { state: 'disabled'; reason: string }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; checkedAt: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'verifying'; version: string }
  | { state: 'ready'; version: string }
  | { state: 'manual'; version: string }
  | { state: 'error'; message: string; code?: string };

export type Indicator = 'active' | 'inactive' | 'planned' | 'warning';

export interface SecurityStatus {
  items: Array<{ id: string; label: string; indicator: Indicator; value: string; detail: string }>;
  releaseKeys: Array<{ keyId: string; comment?: string }>;
}

export type ServerCheckResult =
  | { ok: true; url: string; version: string; protocol: number }
  | { ok: false; reason: 'invalid-url' | 'unreachable' | 'not-river' | 'incompatible'; message: string };

/** Shape of `window.river`, implemented by the preload script. */
export interface RiverApi {
  app: { info(): Promise<AppInfo> };
  settings: { get(): Promise<Settings>; update(patch: SettingsPatch): Promise<Settings> };
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    install(): Promise<void>;
    openDownloadPage(): Promise<void>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
  };
  security: { status(): Promise<SecurityStatus> };
  server: { check(url: string): Promise<ServerCheckResult> };
  links: { open(id: ExternalLinkId): Promise<void> };
}
