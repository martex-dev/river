import { join } from 'node:path';
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  desktopCapturer,
  dialog,
  nativeImage,
  net,
  powerMonitor,
  session,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { TRUSTED_RELEASE_KEYS } from '@river/release';
import { channelOfVersion } from '@river/release/channels';
import type { AppInfo } from '../shared/ipc.ts';
import {
  broadcastAccountStatus,
  broadcastCommunityEvents,
  broadcastDmEvents,
  broadcastHostStatus,
  broadcastSocialEvents,
  broadcastStorageStatus,
  broadcastUpdateStatus,
  registerIpc,
} from './ipc.ts';
import { CommunityService } from './community/community-service.ts';
import { ServerLocator } from './community/server-locator.ts';
import { Hosting } from './host/hosting.ts';
import { HomeAccount } from './home-server.ts';
import { HOME_SERVER } from '../shared/home-server.ts';
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
import { DmService } from './dm/dm-service.ts';
import { SocialService } from './social/social-service.ts';
import { BackupService } from './backup/backup-service.ts';
import { startMessageNotifications } from './notifications.ts';
import { SettingsStore } from './settings-store.ts';
import { electronKeystore } from './storage/electron-keystore.ts';
import { StorageService } from './storage/storage-service.ts';
import { IdentityService } from './identity/identity-service.ts';
import { AccountService } from './account/account-service.ts';
import { UpdateService } from './updater/update-service.ts';
import { createFetchBytes, createRequestBytes, createRequestJson } from './http.ts';
import { verifyDownloadedUpdate } from './updater/verify-download.ts';
import { LaunchHealth } from './updater/launch-health.ts';

const HEALTHY_AFTER_MS = 30_000;

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
  // Counts starts until River has run for a while; repeated failures after an update pause auto-install.
  const health = new LaunchHealth(join(app.getPath('userData'), 'health.json'), app.getVersion());
  const startupProblem = health.crashLoop
    ? `River ${app.getVersion()} had trouble starting ${health.current.starts} times since the update from ${health.current.previousVersion}. Automatic installs are paused until it runs normally. If problems continue, download the latest version from the Releases page.`
    : null;
  if (startupProblem) log.warn(startupProblem);
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
  const locator = new ServerLocator({
    db: () => storage.db(),
    account,
    requestJson: createRequestJson((input, init) => net.fetch(input as string, init)),
    fetchBytes: createFetchBytes((input, init) => net.fetch(input as string, init)),
    log,
    onMoved: (url) => settings.update({ server: { url } }),
  });
  const community = new CommunityService({
    db: () => storage.db(),
    account,
    identity,
    requestJson: createRequestJson((input, init) => net.fetch(input as string, init)),
    requestBytes: createRequestBytes((input, init) => net.fetch(input as string, init)),
    blobDir: () => (storage.db() ? join(app.getPath('userData'), 'attachments') : null),
    log,
    locator,
  });
  // Hosting runs from sign-in, whether or not the user has unlocked their own River data.
  const hosting = new Hosting({
    userData: app.getPath('userData'),
    // Development builds can look elsewhere for an older River Host, so a test run never takes over a real one.
    homeDir: (!app.isPackaged && process.env.RIVER_DEV_HOME) || app.getPath('home'),
    localOnly: !app.isPackaged && process.env.RIVER_DEV_LOCAL_HOSTING === 'true',
    // Installed builds only: a development run or a test must never take over a real River Host.
    ...(app.isPackaged ? { autoAdoptInstanceId: HOME_SERVER.instanceId } : {}),
    settings,
    log,
    pinnedId: () => locator.pinnedId(),
    followOwnServer: (url) => {
      const status = account.status();
      if (status.state !== 'registered' || status.serverUrl === url) return;
      account.moveServer(url);
      settings.update({ server: { url } });
      community.reconnectNow();
    },
  });
  void hosting.init();
  // New people get their account on River's server by themselves, as soon as they have a name.
  const homeAccount = new HomeAccount({
    enabled: app.isPackaged || process.env.RIVER_DEV_HOME_SERVER === 'true',
    fetchBytes: createFetchBytes((input, init) => net.fetch(input as string, init)),
    requestJson: createRequestJson((input, init) => net.fetch(input as string, init)),
    hostedHere: () => {
      const h = hosting.manager.status();
      return h.instanceId === HOME_SERVER.instanceId && h.state === 'online' ? h.address : null;
    },
    account,
    ready: () => storage.db() !== null && identity.get() !== null,
    chosenServer: () => settings.get().server.url,
    onRegistered: (url) => {
      settings.update({ server: { url } });
      community.ensureSocket();
    },
    log,
  });
  const dm = new DmService({ db: () => storage.db(), identity, account, community, log });
  const social = new SocialService({ db: () => storage.db(), identity, dm, log });
  const backup = new BackupService({ db: () => storage.db() });
  // Stories disappear after a day.
  setInterval(
    () => {
      if (storage.db()) social.expireStories();
    },
    10 * 60 * 1000,
  ).unref();
  // Connect whenever local data becomes available (now, or after the user unlocks).
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
  app.on('will-quit', () => community.stop());
  // Waking up or getting the network back: reconnect now rather than after the backoff.
  powerMonitor.on('resume', () => {
    hosting.manager.nudge();
    community.reconnectNow();
  });
  powerMonitor.on('unlock-screen', () => {
    hosting.manager.nudge();
    community.reconnectNow();
  });

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
      installHold: () => (health.crashLoop ? 'this version has been failing to start' : null),
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
    startupProblem,
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
    dm,
    social,
    backup,
    afterRestore: async () => {
      dm.afterRestore();
      await account.connect().catch(() => undefined);
      community.stop();
      community.ensureSocket();
    },
    selectScreen: (id) => {
      chosenScreen = id;
    },
    hosting,
    homeAccount,
  });

  const window = createWindow();
  // Running for a while with a window up counts as a healthy start.
  window.once('ready-to-show', () => setTimeout(() => health.markHealthy(), HEALTHY_AFTER_MS));
  broadcastStorageStatus(window.webContents, storage);
  broadcastAccountStatus(window.webContents, account, homeAccount);
  broadcastCommunityEvents(window.webContents, community);
  broadcastDmEvents(window.webContents, dm);
  broadcastSocialEvents(window.webContents, social);
  broadcastHostStatus(window.webContents, hosting);
  startMessageNotifications({ community, dm, settings: () => settings.get(), window });
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

  // Started at sign-in: stay in the tray until the user opens River.
  const startedHidden = process.argv.includes('--hidden');
  const show = (): void => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  window.once('ready-to-show', () => {
    if (!startedHidden) window.show();
  });
  app.on('second-instance', show);

  // The tray keeps River (calls, messages, notifications) running with the window closed.
  let quitting = false;
  let told = false;
  let hostStopped = false;
  app.on('before-quit', (event) => {
    quitting = true;
    // Stop the community server cleanly before River exits (at most a few seconds).
    if (hostStopped || hosting.manager.status().state === 'off') return;
    event.preventDefault();
    void hosting.stop().finally(() => {
      hostStopped = true;
      app.quit();
    });
  });
  // Quitting from the tray while hosting takes the community offline: say so first.
  const quitFromTray = async (): Promise<void> => {
    if (hosting.status().enabled && hosting.manager.status().state !== 'off') {
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Keep River running', 'Quit anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Quit River?',
        message: 'Your communities go offline while River is closed.',
        detail:
          'This PC hosts them. Members can still open River and write; their messages are sent when River runs here again.',
      });
      if (response !== 1) return;
    }
    app.quit();
  };
  const tray = new Tray(nativeImage.createFromPath(trayIconPath()).resize({ width: 16, height: 16 }));
  const trayLabel = (): string => {
    const h = hosting.status();
    if (!h.enabled) return 'River';
    return h.state === 'online' ? 'River — hosting your communities' : 'River — starting hosting…';
  };
  const refreshTray = (): void => {
    const h = hosting.status();
    tray.setToolTip(trayLabel());
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open River', click: show },
        ...(h.enabled
          ? [
              {
                label: h.state === 'online' ? 'Hosting: online' : 'Hosting: connecting…',
                enabled: false,
              },
            ]
          : []),
        { type: 'separator' },
        { label: 'Quit River', click: () => void quitFromTray() },
      ]),
    );
  };
  refreshTray();
  let lastTray = trayLabel();
  hosting.onStatus(() => {
    if (trayLabel() === lastTray) return;
    lastTray = trayLabel();
    refreshTray();
  });
  tray.on('click', show);
  window.on('close', (event) => {
    if (quitting || !settings.get().system.closeToTray) return;
    event.preventDefault();
    window.hide();
    if (!told && Notification.isSupported()) {
      told = true;
      new Notification({
        title: 'River is still running',
        body: 'Calls and messages keep coming in. Quit from the River icon in the tray.',
        silent: true,
      }).show();
    }
  });
  app.on('window-all-closed', () => {
    if (!settings.get().system.closeToTray) app.quit();
  });

  // Start with the computer, if the user wants that (installed builds only).
  const applyLoginItem = (on: boolean): void => {
    if (!app.isPackaged || process.platform === 'linux') return;
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  };
  applyLoginItem(settings.get().system.startAtLogin);
  settings.onChange((s) => applyLoginItem(s.system.startAtLogin));
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
  if (devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadURL(`${APP_ORIGIN}/index.html`);
  return window;
}

/** The tray icon: next to the app in installed builds, in the source tree during development. */
function trayIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png');
}
