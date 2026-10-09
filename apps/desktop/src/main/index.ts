import { join } from 'node:path';
import { BrowserWindow, app, desktopCapturer, net, session } from 'electron';
import { autoUpdater } from 'electron-updater';
import { TRUSTED_RELEASE_KEYS } from '@river/release';
import { channelOfVersion } from '@river/release/channels';
import type { AppInfo } from '../shared/ipc.ts';
import {
  broadcastAccountStatus,
  broadcastCommunityEvents,
  broadcastStorageStatus,
  broadcastUpdateStatus,
  registerIpc,
} from './ipc.ts';
import { CommunityService } from './community/community-service.ts';
import { createFileLogger } from './logger.ts';
import {
  APP_ORIGIN,
  guardWebContents,
  hardenSession,
  registerAppScheme,
  serveAppScheme,
  uiSession,
  UI_PARTITION,
} from './security.ts';
import { startMessageNotifications } from './notifications.ts';
import { SettingsStore } from './settings-store.ts';
import { electronKeystore } from './storage/electron-keystore.ts';
import { StorageService } from './storage/storage-service.ts';
import { IdentityService } from './identity/identity-service.ts';
import { AccountService } from './account/account-service.ts';
import { UpdateService } from './updater/update-service.ts';
import { createFetchBytes, createRequestBytes, createRequestJson } from './http.ts';
import { verifyDownloadedUpdate } from './updater/verify-download.ts';

const devServerUrl = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || undefined;
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

registerAppScheme();
app.setAppUserModelId('io.github.martex-dev.river');
// Privacy: Chromium's Linux spellchecker downloads dictionaries from Google; keep it off until River bundles its own.
app.commandLine.appendSwitch('disable-features', 'SpellcheckService');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function start(): Promise<void> {
  await app.whenReady();

  const log = createFileLogger(join(app.getPath('userData'), 'logs'));
  log.info(`River ${app.getVersion()} starting on ${process.platform}-${process.arch}`);

  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), log);
  const storage = new StorageService({
    dir: join(app.getPath('userData'), 'data'),
    keystore: electronKeystore,
    log,
    appVersion: app.getVersion(),
  });
  storage.start();
  const identity = new IdentityService(() => storage.db());
  const account = new AccountService({
    db: () => storage.db(),
    identity,
    requestJson: createRequestJson((input, init) => net.fetch(input as string, init)),
    log,
  });
  const community = new CommunityService({
    db: () => storage.db(),
    account,
    identity,
    requestJson: createRequestJson((input, init) => net.fetch(input as string, init)),
    requestBytes: createRequestBytes((input, init) => net.fetch(input as string, init)),
    log,
  });
  // Connect whenever local data becomes available (now, or after the user unlocks).
  const connectAll = async (): Promise<void> => {
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
  app.on('will-quit', () => community.stop());

  // Screen sharing: River shows its own picker; the chosen source is used for the next request.
  let chosenScreen: string | null = null;
  uiSession().setDisplayMediaRequestHandler((_request, callback) => {
    void desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const source =
        sources.find((s) => s.id === chosenScreen) ?? sources.find((s) => s.id.startsWith('screen:'));
      chosenScreen = null;
      if (source) callback({ video: source });
      else callback({});
    });
  });
  app.on('will-quit', () => storage.close());

  const ui = uiSession();
  hardenSession(ui, devServerUrl);
  serveAppScheme(ui, join(__dirname, '../renderer'));
  // The default session is only used by main-process networking (update verification).
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));

  app.on('web-contents-created', (_e, contents) => guardWebContents(contents, devServerUrl));

  const updatesEnabled = app.isPackaged || process.env.RIVER_DEV_UPDATES === 'true';
  const updatesDisabledReason = 'Automatic updates are disabled in development builds.';
  let updates: UpdateService | null = null;
  if (updatesEnabled) {
    autoUpdater.logger = log;
    // River publishes full NSIS installers only; never fetch a separate web-installer payload.
    (autoUpdater as { disableWebInstaller?: boolean }).disableWebInstaller = true;
    const fetchBytes = createFetchBytes((input, init) => net.fetch(input as string, init));
    updates = new UpdateService({
      updater: autoUpdater,
      currentVersion: app.getVersion(),
      mode: process.platform === 'darwin' && !__RIVER_MAC_AUTO_INSTALL__ ? 'manual' : 'auto',
      preferences: () => settings.get().updates,
      verifyDownload: (version, filePath) =>
        verifyDownloadedUpdate({ version, filePath, fetchBytes, trustedKeys: TRUSTED_RELEASE_KEYS }),
      log,
    });
  }

  const appInfo = (): AppInfo => ({
    version: app.getVersion(),
    channel: channelOfVersion(app.getVersion()),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  });

  const serverFetch = createFetchBytes((input, init) => net.fetch(input as string, init), {
    timeoutMs: 10_000,
  });
  registerIpc({
    appInfo,
    settings,
    updates,
    updatesDisabledReason,
    devServerUrl,
    fetchBytes: serverFetch,
    storage,
    identity,
    account,
    community,
    selectScreen: (id) => {
      chosenScreen = id;
    },
  });

  const window = createWindow();
  broadcastStorageStatus(window.webContents, storage);
  broadcastAccountStatus(window.webContents, account);
  broadcastCommunityEvents(window.webContents, community);
  startMessageNotifications({ community, settings: () => settings.get(), window });
  window.on('focus', () => window.flashFrame(false));
  if (updates) {
    const service = updates;
    broadcastUpdateStatus(window.webContents, service);
    settings.onChange((s) => {
      service.applyPreferences();
      if (s.updates.autoCheck && service.getStatus().state === 'up-to-date') void service.check();
    });
    const scheduledCheck = (): void => {
      if (settings.get().updates.autoCheck) void service.check();
    };
    setTimeout(scheduledCheck, FIRST_CHECK_DELAY_MS);
    setInterval(scheduledCheck, CHECK_INTERVAL_MS);
    app.on('quit', (_event, exitCode) => {
      if (exitCode === 0) service.installOnQuit();
    });
  }

  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const window = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'River',
    backgroundColor: '#05070d',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: '#00000000', symbolColor: '#9aa7c7', height: 44 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      partition: UI_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  window.once('ready-to-show', () => window.show());
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadURL(`${APP_ORIGIN}/index.html`);
  return window;
}
