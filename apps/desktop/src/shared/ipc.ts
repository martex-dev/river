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
  storageStatus: 'river:storage:status',
  storageSetup: 'river:storage:setup-passphrase',
  storageUnlock: 'river:storage:unlock',
  storageStatusChanged: 'river:storage:status-changed',
  identityGet: 'river:identity:get',
  identityCreate: 'river:identity:create',
  identitySetName: 'river:identity:set-name',
  accountStatus: 'river:account:status',
  accountRegister: 'river:account:register',
  accountConnect: 'river:account:connect',
  accountStatusChanged: 'river:account:status-changed',
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

export type StorageStatus =
  | { state: 'opening' }
  /** No real OS keystore (e.g. Linux without a keyring): the user must choose a passphrase. */
  | { state: 'setup-required'; minLength: number }
  /** Passphrase-protected and waiting for the user. */
  | { state: 'locked' }
  | { state: 'open'; protection: 'os-keystore' | 'passphrase'; keystore: string; schema: number }
  | {
      state: 'error';
      code: 'keystore-unavailable' | 'newer-data' | 'migration-failed' | 'corrupt' | 'unknown';
      message: string;
    };

/** Everything the UI may know about the user's identity — public material only. */
export interface IdentityInfo {
  riverId: string;
  displayName: string | null;
  /** "AB73 29FA …" — SHA-256 of the identity public key, first 128 bits. */
  fingerprint: string;
  /** The same 16 bytes as Bytewords. */
  words: string[];
  createdAt: string;
}

export type AccountStatus =
  | { state: 'none' }
  | {
      state: 'registered';
      /** Host (and port) of the server, for display. */
      server: string;
      serverUrl: string;
      riverId: string;
      deviceId: number;
      devices: number;
      listVersion: number;
      connection: 'connecting' | 'online' | 'offline' | 'error';
      message?: string;
    };

export type AccountActionResult = { ok: true; status: AccountStatus } | { ok: false; message: string };

export type PassphraseResult =
  { ok: true } | { ok: false; reason: 'wrong-passphrase' | 'too-short' | 'not-expected' };

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
  identity: {
    get(): Promise<IdentityInfo | null>;
    create(displayName: string): Promise<IdentityInfo>;
    setDisplayName(displayName: string): Promise<IdentityInfo>;
  };
  account: {
    status(): Promise<AccountStatus>;
    /** Creates an account on the server set in Settings → Server. */
    register(): Promise<AccountActionResult>;
    connect(): Promise<AccountStatus>;
    onStatus(listener: (status: AccountStatus) => void): () => void;
  };
  storage: {
    status(): Promise<StorageStatus>;
    setupPassphrase(passphrase: string): Promise<PassphraseResult>;
    unlock(passphrase: string): Promise<PassphraseResult>;
    onStatus(listener: (status: StorageStatus) => void): () => void;
  };
  links: { open(id: ExternalLinkId): Promise<void> };
}
