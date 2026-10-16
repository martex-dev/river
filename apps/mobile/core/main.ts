import { join } from 'node:path';
import { app } from 'electron';
import { channelOfVersion } from '@river/release/channels';
import type { AppInfo, HostStatus } from '../../desktop/src/shared/ipc.ts';
import { CommunityService } from '../../desktop/src/main/community/community-service.ts';
import { ServerLocator } from '../../desktop/src/main/community/server-locator.ts';
import { HomeAccount } from '../../desktop/src/main/home-server.ts';
import { HOME_SERVER } from '../../desktop/src/shared/home-server.ts';
import { createFileLogger } from '../../desktop/src/main/logger.ts';
import {
  broadcastAccountStatus,
  broadcastCommunityEvents,
  broadcastDmEvents,
  broadcastLinkStatus,
  broadcastSocialEvents,
  broadcastStorageStatus,
  registerIpc,
  type IpcDeps,
} from '../../desktop/src/main/ipc.ts';
import { DmService } from '../../desktop/src/main/dm/dm-service.ts';
import { SocialService } from '../../desktop/src/main/social/social-service.ts';
import { BackupService } from '../../desktop/src/main/backup/backup-service.ts';
import { startMessageNotifications } from '../../desktop/src/main/notifications.ts';
import { SettingsStore } from '../../desktop/src/main/settings-store.ts';
import { StorageService } from '../../desktop/src/main/storage/storage-service.ts';
import type { OsKeystore } from '../../desktop/src/main/storage/key-file.ts';
import { IdentityService } from '../../desktop/src/main/identity/identity-service.ts';
import { AccountService } from '../../desktop/src/main/account/account-service.ts';
import { LinkService } from '../../desktop/src/main/account/link-service.ts';
import { createFetchBytes, createRequestBytes, createRequestJson } from '../../desktop/src/main/http.ts';
import { runMainDiagnostics } from '../../desktop/src/main/diagnostics.ts';
import { PresenceTracker } from '../../desktop/src/main/presence.ts';
import { ready as cryptoReady } from './shims/crypto.ts';
import { native } from './native.ts';
import { ask, emit, inbound, onDeepLink, onLifecycle, ready, ui } from './host.ts';
import { parseDeepLink } from '../../desktop/src/main/deep-link.ts';
import { IPC, type DeepLink } from '../../desktop/src/shared/ipc.ts';

/**
 * River's client core on a phone: the desktop's services (accounts,
 * communities, direct messages, social, backup) and its validated IPC layer,
 * started without the parts only a computer has (hosting, auto-update, tray,
 * screen picker). The UI talks to it exactly as it talks to Electron's main
 * process; the app shell carries the messages.
 */

const keystore: OsKeystore = {
  usable: () => native('keystore.usable', {}),
  name: () => native('keystore.name', {}),
  wrap: (plaintext) => Buffer.from(native('keystore.wrap', { data: plaintext.toString('base64') }), 'base64'),
  unwrap: (wrapped) =>
    Buffer.from(native('keystore.unwrap', { data: Buffer.from(wrapped).toString('base64') }), 'base64'),
};

const PHONE = 'Hosting runs on a computer. Phones join communities hosted elsewhere.';

/** Hosting is a desktop feature: the phone reports it as off and refuses to start it. */
const noHosting: IpcDeps['hosting'] = {
  status: (): HostStatus => ({
    state: 'off',
    address: null,
    followable: false,
    lastBackupAt: null,
    enabled: false,
    yours: false,
    legacy: 'none',
    message: PHONE,
  }),
  enable: async () => {
    throw new Error(PHONE);
  },
  disable: async () => undefined,
  backupNow: async () => {
    throw new Error(PHONE);
  },
  openFolder: async () => undefined,
  approveAddress: async () => undefined,
  checkAddress: async () => undefined,
  adminOverview: async () => {
    throw new Error(PHONE);
  },
  adminSuspend: async () => {
    throw new Error(PHONE);
  },
  adminUnsuspend: async () => {
    throw new Error(PHONE);
  },
  adminDeleteAccount: async () => {
    throw new Error(PHONE);
  },
  adminDeleteCommunity: async () => {
    throw new Error(PHONE);
  },
  adminCreateSignup: async () => {
    throw new Error(PHONE);
  },
  adminDeleteSignup: async () => {
    throw new Error(PHONE);
  },
  adminSetSignupMode: async () => {
    throw new Error(PHONE);
  },
} as unknown as IpcDeps['hosting'];

/** Android or iOS: the same core runs on both. */
const PLATFORM = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
let foreground = true;
/** A River link opened from a browser that the UI has not taken yet (the UI asks when it is ready). */
let pendingDeepLink: DeepLink | null = null;
onDeepLink((url) => {
  const link = parseDeepLink(url);
  if (!link) return;
  pendingDeepLink = link;
  emit(IPC.appDeepLink, [link]);
});
let lastActive = Date.now();

async function start(): Promise<void> {
  await cryptoReady;
  const userData = app.getPath('userData');
  const log = createFileLogger(join(userData, 'logs'));
  log.info(`River ${app.getVersion()} starting on ${PLATFORM}`);

  const settings = new SettingsStore(join(userData, 'settings.json'), log);
  // Settings → System → Lock River: the app shell asks for biometrics or the screen lock.
  // Without a screen lock on the phone the setting cannot work, so it turns itself off.
  let lockState: boolean | null = null;
  const syncLock = (): void => {
    const enabled = settings.get().system.appLock;
    if (enabled === lockState) return;
    lockState = enabled;
    void ask<{ available: boolean }>('appLock', { enabled }).then(
      (r) => {
        if (enabled && !r?.available) settings.update({ system: { appLock: false } });
      },
      () => undefined,
    );
  };
  settings.onChange(syncLock);
  syncLock();
  // Settings → System → Stay connected (Android): the shell runs a visible foreground service.
  let backgroundState: boolean | null = null;
  const syncBackground = (): void => {
    const enabled = settings.get().system.background;
    if (enabled === backgroundState || PLATFORM !== 'android') return;
    backgroundState = enabled;
    void ask('background', { enabled }).catch(() => undefined);
  };
  settings.onChange(syncBackground);
  syncBackground();
  // Settings → Privacy → Screen security (2.6, Android): no screenshots, blank in the app switcher.
  let screenState: boolean | null = null;
  const syncScreen = (): void => {
    const on = settings.get().system.screenSecurity;
    if (on === screenState || PLATFORM !== 'android') return;
    screenState = on;
    void ask('screenSecurity', { on }).catch(() => undefined);
  };
  settings.onChange(syncScreen);
  syncScreen();
  const storage = new StorageService({
    dir: join(userData, 'data'),
    keystore,
    log,
    appVersion: app.getVersion(),
  });
  storage.start();
  const identity = new IdentityService(() => storage.db());
  const http = (input: unknown, init?: RequestInit): Promise<Response> => fetch(input as string, init);
  // eslint-disable-next-line prefer-const -- assigned below; the account asks for it lazily
  let homeAccount: HomeAccount;
  const account: AccountService = new AccountService({
    db: () => storage.db(),
    identity,
    requestJson: createRequestJson(http),
    log,
    publicAddress: () => null,
    homeLinks: () => homeAccount.enabled() && locator.pinnedId() === HOME_SERVER.instanceId,
  });
  const locator = new ServerLocator({
    db: () => storage.db(),
    account,
    requestJson: createRequestJson(http),
    fetchBytes: createFetchBytes(http),
    log,
    onMoved: (url) => settings.update({ server: { url } }),
  });
  // A phone in the background counts as idle for the "Idle after 10 minutes" status.
  const presence = new PresenceTracker({
    settings: () => settings.get().presence,
    idleSeconds: () => (foreground ? 0 : (Date.now() - lastActive) / 1000),
  });
  const community = new CommunityService({
    db: () => storage.db(),
    account,
    identity,
    requestJson: createRequestJson(http),
    requestBytes: createRequestBytes(http),
    blobDir: () => (storage.db() ? join(userData, 'attachments') : null),
    log,
    locator,
    presence,
    // Android: an "In a call" foreground service keeps the call running with the screen off; its
    // Hang up button answers the open ask.
    onCallChange: (inCall) => {
      if (PLATFORM !== 'android') return;
      void ask<string>('call', { active: inCall }).then(
        (how) => {
          if (how === 'hangup') community.hangUp();
        },
        () => undefined,
      );
    },
  });
  let lastCustom = JSON.stringify(presence.custom());
  presence.onChange(() => {
    const custom = JSON.stringify(presence.custom());
    void community.presenceChanged(custom !== lastCustom);
    lastCustom = custom;
  });
  settings.onChange(() => presence.check());
  presence.start();
  homeAccount = new HomeAccount({
    enabled: true,
    fetchBytes: createFetchBytes(http),
    requestJson: createRequestJson(http),
    hostedHere: () => null,
    account,
    ready: () => storage.db() !== null && identity.get() !== null,
    chosenServer: () => settings.get().server.url,
    autoAccount: () => settings.get().server.autoAccount,
    onRegistered: (url) => {
      settings.update({ server: { url, autoAccount: true } });
      community.ensureSocket();
    },
    log,
  });
  const dm = new DmService({
    db: () => storage.db(),
    identity,
    account,
    community,
    log,
    privacy: () => ({
      readReceipts: settings.get().presence.readReceipts,
      typing: settings.get().presence.typingIndicators,
    }),
  });
  const link = new LinkService({
    identity,
    account,
    community,
    requestJson: createRequestJson(http),
    log,
    homeServer: () => homeAccount.locate(),
    onLinked: (url) => {
      settings.update({ server: { url, autoAccount: true } });
      community.ensureSocket();
    },
  });
  const social = new SocialService({ db: () => storage.db(), identity, dm, log });
  const backup = new BackupService({ db: () => storage.db() });
  setInterval(
    () => {
      if (storage.db()) social.expireStories();
    },
    10 * 60 * 1000,
  );
  const connectAll = async (): Promise<void> => {
    homeAccount.kick();
    await account.connect();
    community.ensureSocket();
  };
  if (storage.getStatus().state === 'open') void connectAll();
  storage.onStatus((s) => {
    if (s.state === 'open') void connectAll();
  });
  account.onStatus((s) => {
    if (s.state === 'registered' && s.connection === 'online') community.ensureSocket();
  });
  // Coming back to the app (or the network returning): reconnect now rather than after the backoff.
  onLifecycle((state) => {
    foreground = state === 'foreground';
    lastActive = Date.now();
    presence.check();
    if (foreground) community.reconnectNow();
  });

  const appInfo = (): AppInfo => ({
    version: app.getVersion(),
    channel: channelOfVersion(app.getVersion()),
    platform: PLATFORM,
    arch: 'arm64',
    isPackaged: true,
    versions: {
      electron: '',
      chrome: (/Chrome\/([\d.]+)/.exec(navigator.userAgent) ?? [])[1] ?? '',
      node: '',
    },
    startupProblem: null,
  });
  const serverFetch = createFetchBytes(http, { timeoutMs: 10_000 });
  registerIpc({
    appInfo,
    settings,
    updates: null,
    updatesDisabledReason: 'River on phones updates from its download page.',
    devServerUrl: undefined,
    fetchBytes: serverFetch,
    storage,
    identity,
    account,
    link,
    community,
    dm,
    social,
    backup,
    afterRestore: async () => {
      dm.afterRestore();
      await account.connect().catch(() => undefined);
      community.stop();
      community.ensureSocket();
    },
    selectScreen: () => undefined,
    speaker: (on) => void ask('speaker', { on }).catch(() => undefined),
    hosting: noHosting,
    homeAccount,
    takeDeepLink: (kind) => {
      const link = pendingDeepLink;
      if (!link || (kind && link.kind !== kind)) return null;
      pendingDeepLink = null;
      return link;
    },
    diagnostics: () =>
      runMainDiagnostics({
        fetchBytes: serverFetch,
        account: () => account.status(),
        connection: () => community.connectionState(),
        hosting: () => noHosting.status(),
        homeServerEnabled: homeAccount.enabled(),
        version: app.getVersion(),
        platform: PLATFORM,
      }),
    openLogs: async () => undefined,
  });

  const target = ui as unknown as Parameters<typeof broadcastStorageStatus>[0];
  broadcastStorageStatus(target, storage);
  broadcastAccountStatus(target, account, homeAccount);
  broadcastCommunityEvents(target, community);
  broadcastDmEvents(target, dm);
  broadcastLinkStatus(target, link);
  broadcastSocialEvents(target, social);
  // Notifications while River is in the background; tapping one brings it forward.
  const window = {
    isDestroyed: () => false,
    isFocused: () => foreground,
    isMinimized: () => false,
    restore: () => undefined,
    show: () => undefined,
    focus: () => undefined,
    flashFrame: () => undefined,
  };
  startMessageNotifications({
    community,
    dm,
    settings: () => settings.get(),
    window: window as unknown as Parameters<typeof startMessageNotifications>[0]['window'],
  });
  ready();
}

(globalThis as { __riverCore?: unknown }).__riverCore = inbound;
start().catch((err: unknown) => {
  emit('core:fatal', [err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)]);
});
