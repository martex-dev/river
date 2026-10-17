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
import { IPC, type AppInfo, type DeepLink } from '../shared/ipc.ts';
import {
  broadcastAccountStatus,
  broadcastCommunityEvents,
  broadcastDmEvents,
  broadcastLinkStatus,
  broadcastHostStatus,
  broadcastSocialEvents,
  broadcastStorageStatus,
  broadcastUpdateStatus,
  registerIpc,
} from './ipc.ts';
import { CommunityService } from './community/community-service.ts';
import { ServerLocator } from './community/server-locator.ts';
import { Hosting } from './host/hosting.ts';
import { ShareIndicator } from './share-indicator.ts';
import { DEEP_LINK_SCHEME, deepLinkInArgs, parseDeepLink } from './deep-link.ts';
import { HomeAccount } from './home-server.ts';
import { HOME_SERVER } from '../shared/home-server.ts';
import { createFileLogger } from './logger.ts';
import { pinnedPreviewDeps } from './link-preview-net.ts';
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
import { LinkService } from './account/link-service.ts';
import { UpdateService } from './updater/update-service.ts';
import { createFetchBytes, createRequestBytes, createRequestJson } from './http.ts';
import { verifyDownloadedUpdate } from './updater/verify-download.ts';
import { shouldAutoInstall } from './updater/auto-install.ts';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { LaunchHealth } from './updater/launch-health.ts';
import { runSelfTest, selfTestPath } from './self-test.ts';
import { runMainDiagnostics } from './diagnostics.ts';
import { PresenceTracker } from './presence.ts';
import {
  RENDERER_RELOADS,
  SHOW_WINDOW_FALLBACK_MS,
  describeStartupError,
  readGpuState,
  recordGpuCrash,
} from './startup-guard.ts';

const HEALTHY_AFTER_MS = 30_000;

const devServerUrl = (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) || undefined;
/** Set before an automatic update from the tray, so River starts in the tray again. */
const hiddenAfterUpdate = (): string => join(app.getPath('userData'), 'start-hidden-after-update');
function takeHiddenAfterUpdate(): boolean {
  try {
    if (!existsSync(hiddenAfterUpdate())) return false;
    rmSync(hiddenAfterUpdate(), { force: true });
    return true;
  } catch {
    return false;
  }
}
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

registerAppScheme();
app.setAppUserModelId('io.github.martex-dev.river');
// "Open in River" on invite pages: river://open?link=… (see deep-link.ts). Development runs
// register the dev Electron with this app's path; installed builds register River itself.
if (process.defaultApp) {
  if (process.argv[1]) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [process.argv[1]]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}
/** A link opened before the window could take it (first launch, or while locked/onboarding). */
let pendingDeepLink: DeepLink | null = deepLinkInArgs(process.argv);
let deliverDeepLink: ((link: DeepLink) => void) | null = null;
const openDeepLink = (link: DeepLink | null): void => {
  if (!link) return;
  if (deliverDeepLink) deliverDeepLink(link);
  else pendingDeepLink = link;
};
// macOS hands links over with this event (also before the app is ready).
app.on('open-url', (event, url) => {
  event.preventDefault();
  openDeepLink(parseDeepLink(url));
});
// Privacy: Chromium's Linux spellchecker downloads dictionaries from Google; keep it off until River bundles its own.
app.commandLine.appendSwitch('disable-features', 'SpellcheckService');

const selfTest = selfTestPath(process.argv);
if (selfTest) {
  // Never touches the person's own data, and runs beside an open River.
  app.setPath('userData', join(app.getPath('temp'), `river-self-test-${process.pid}`));
}
// A graphics driver that kept crashing Chromium's GPU process: run without hardware acceleration.
const gpuStatePath = (): string => join(app.getPath('userData'), 'gpu.json');
const gpuState = readGpuState(gpuStatePath());
if (gpuState.disabled || process.argv.includes('--disable-gpu')) app.disableHardwareAcceleration();

if (selfTest) {
  void runSelfTest(selfTest, join(__dirname, '../renderer'), join(__dirname, '../preload/index.cjs'));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start().catch((err: unknown) => void startupFailed(err));
}

/**
 * Something went wrong before River could show itself. Say so, with the
 * details and where the log is, and quit — never linger invisibly holding the
 * single-instance lock (which made every later launch do nothing).
 */
async function startupFailed(err: unknown): Promise<void> {
  const details = describeStartupError(err, {
    version: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
  });
  const logDir = join(app.getPath('userData'), 'logs');
  try {
    createFileLogger(logDir).error(`${details}\n${(err as Error)?.stack ?? ''}`);
  } catch {
    // logging must not stop the message
  }
  try {
    await app.whenReady();
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'River could not start',
      message: 'River could not start',
      detail: `${details}\n\nThe log is in ${logDir}. Copy the details and send them to whoever helps you with River.`,
      buttons: ['Copy details', 'Open log folder', 'Quit'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) {
      const { clipboard } = await import('electron');
      clipboard.writeText(details);
    } else if (response === 1) {
      const { shell } = await import('electron');
      await shell.openPath(logDir);
    }
  } finally {
    app.exit(1);
  }
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
  // Set once hosting exists (below); the account asks it for links people can open.
  let publicAddress: () => string | null = () => null;
  let homeLinks: () => boolean = () => false;
  const account = new AccountService({
    db: () => storage.db(),
    identity,
    requestJson: createRequestJson((input, init) => net.fetch(input as string, init)),
    log,
    publicAddress: () => publicAddress(),
    homeLinks: () => homeLinks(),
  });
  const locator = new ServerLocator({
    db: () => storage.db(),
    account,
    requestJson: createRequestJson((input, init) => net.fetch(input as string, init)),
    fetchBytes: createFetchBytes((input, init) => net.fetch(input as string, init)),
    log,
    onMoved: (url) => settings.update({ server: { url } }),
  });
  // How you appear to others: chosen status, Idle after 10 minutes away, custom status (1.0.17).
  const presence = new PresenceTracker({
    settings: () => settings.get().presence,
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
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
    presence,
    // A call that ends takes any screen share in it along (the bar goes with it).
    onCallChange: (inCall) => {
      inCallNow = inCall;
      if (!inCall) callEnded();
    },
  });
  let callEnded: () => void = () => undefined;
  // Updates never restart River during a voice channel or a call.
  let inCallNow = false;
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
    accountOnline: () => {
      const s = account.status();
      return s.state === 'registered' && s.connection === 'online';
    },
    canSignInAt: (url) => account.canSignInAt(url),
    followOwnServer: (url) => {
      const status = account.status();
      if (status.state !== 'registered' || status.serverUrl === url) return;
      account.moveServer(url);
      settings.update({ server: { url } });
      // Sign in at the new address straight away, then bring the live connection back.
      void account.connect().then(() => {
        community.stop();
        community.ensureSocket();
      });
    },
  });
  publicAddress = () => hosting.manager.status().address;
  // Installed builds on River's home server (as a member, or as the PC that hosts it).
  homeLinks = () =>
    homeAccount.enabled() &&
    (locator.pinnedId() === HOME_SERVER.instanceId ||
      hosting.manager.localServer()?.instanceId === HOME_SERVER.instanceId);
  let lastPublic: string | null = null;
  hosting.manager.onStatus((s) => {
    if (s.address === lastPublic) return;
    lastPublic = s.address;
    account.refresh();
  });
  let lastCustom = JSON.stringify(presence.custom());
  presence.onChange(() => {
    const custom = JSON.stringify(presence.custom());
    void community.presenceChanged(custom !== lastCustom);
    lastCustom = custom;
  });
  settings.onChange(() => presence.check());
  presence.start();
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
  // Linked devices (1.3): this device can join an account, or add another device to it.
  const link = new LinkService({
    identity,
    account,
    community,
    requestJson: createRequestJson((input, init) => net.fetch(input as string, init)),
    log,
    homeServer: () => homeAccount.locate(),
    onLinked: (url) => {
      settings.update({ server: { url, autoAccount: true } });
      community.ensureSocket();
    },
  });
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
    // Kept file copies stay under their size limit (the least recently used go first).
    void community.pruneAttachments();
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
  /** The display being shared, when a whole screen is (pointing maps onto it). */
  let sharedDisplay: string | null = null;
  /**
   * A screen main handed to the window that may still be captured. Main cannot see the
   * stream end, and the window's word is not proof (ADR 0007), so the bar stays until its
   * own Stop, the call ends, or the window's page goes away (crash, reload, navigation).
   */
  let captureGranted = false;
  const endShare = (): void => {
    captureGranted = false;
    sharedDisplay = null;
    indicator.hide();
  };
  callEnded = endShare;
  const indicator = new ShareIndicator(() => {
    endShare();
    if (!window.isDestroyed()) window.webContents.send(IPC.communityEvent, { t: 'stopScreenShare' });
  });
  // Remote assistance is consent-only (ADR 0007): only a screen picked in River's picker, and only
  // after main itself asks — a question the window's (untrusted) page can neither fake nor skip.
  uiSession().setDisplayMediaRequestHandler((_request, callback) => {
    const picked = chosenScreen;
    chosenScreen = null;
    if (!picked) return callback({});
    // Always answered exactly once: a failure while asking means "no", never a hanging request.
    let answered = false;
    const answer = (streams: Parameters<typeof callback>[0]): void => {
      if (answered) return;
      answered = true;
      callback(streams);
    };
    void desktopCapturer
      .getSources({ types: ['screen', 'window'] })
      .then(async (sources) => {
        const source = sources.find((s) => s.id === picked);
        if (!source || window.isDestroyed()) return answer({});
        const { response } = await dialog.showMessageBox(window, {
          type: 'question',
          title: 'River — share your screen',
          message: 'Share your screen?',
          detail: `People in this call will see “${source.name}” until you press Stop sharing on the red bar at the top of that screen.`,
          buttons: ['Share', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response !== 0) return answer({});
        sharedDisplay = source.id.startsWith('screen:') ? source.display_id || null : null;
        captureGranted = true;
        answer({ video: source });
        // The bar appears as soon as a screen is handed out, whatever the window reports later.
        indicator.show(sharedDisplay, []);
      })
      .catch((err: unknown) => {
        log.warn(`screen share request failed: ${(err as Error)?.message ?? String(err)}`);
        answer({});
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
    previewDeps: pinnedPreviewDeps,
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
    selectScreen: (id) => {
      chosenScreen = id;
    },
    share: {
      status: (sharing, viewers) => {
        if (sharing) indicator.show(sharedDisplay, viewers);
        // The window saying it stopped cannot hide the bar of a screen main handed out: the bar
        // says River reports it stopped, and goes with one click (or the call ending, or the page
        // going away). It never keeps claiming people can see the screen.
        else if (!captureGranted) indicator.hide();
        else indicator.stoppedInApp();
      },
      point: (x, y) => indicator.ping(x, y),
    },
    hosting,
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
        hosting: () => hosting.manager.status(),
        homeServerEnabled: homeAccount.enabled(),
        version: app.getVersion(),
        platform: `${process.platform}-${process.arch}${gpuState.disabled ? ' (graphics acceleration off)' : ''}`,
      }),
    openLogs: async () => {
      const { shell } = await import('electron');
      await shell.openPath(join(app.getPath('userData'), 'logs'));
    },
  });

  const window = createWindow();
  // The page that held a shared screen is gone (crashed, reloaded, navigated): so is the capture.
  window.webContents.on('render-process-gone', endShare);
  window.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) endShare();
  });
  window.webContents.once('destroyed', endShare);
  // Running for a while with a window up counts as a healthy start.
  window.once('ready-to-show', () => setTimeout(() => health.markHealthy(), HEALTHY_AFTER_MS));
  watchWindow(window, log, process.argv.includes('--hidden'));
  // Settings → Appearance → interface size.
  const applyZoom = (): void => {
    if (!window.isDestroyed()) window.webContents.setZoomFactor(settings.get().appearance.zoom);
  };
  window.webContents.on('did-finish-load', applyZoom);
  settings.onChange(applyZoom);
  // Settings → Privacy → Screen security (2.6): Windows and macOS keep River out of screenshots.
  const applyScreenSecurity = (): void => {
    if (!window.isDestroyed()) window.setContentProtection(settings.get().system.screenSecurity);
  };
  applyScreenSecurity();
  settings.onChange(applyScreenSecurity);
  app.on('child-process-gone', (_e, details) => {
    if (details.type !== 'GPU' || details.reason === 'clean-exit') return;
    log.warn(`graphics process stopped (${details.reason})`);
    if (recordGpuCrash(gpuStatePath(), details.reason)) {
      log.warn('graphics kept crashing; restarting without hardware acceleration');
      app.relaunch();
      app.exit(0);
    }
  });
  broadcastStorageStatus(window.webContents, storage);
  broadcastAccountStatus(window.webContents, account, homeAccount);
  broadcastCommunityEvents(window.webContents, community);
  broadcastDmEvents(window.webContents, dm);
  broadcastLinkStatus(window.webContents, link);
  broadcastSocialEvents(window.webContents, social);
  broadcastHostStatus(window.webContents, hosting);
  startMessageNotifications({ community, dm, settings: () => settings.get(), window });
  window.on('focus', () => window.flashFrame(false));
  if (updates) {
    const service = updates;
    broadcastUpdateStatus(window.webContents, service);
    // Only a change to the update settings (turning automatic checks on, a new channel) checks now.
    let lastUpdates = JSON.stringify(settings.get().updates);
    settings.onChange((s) => {
      const updatesNow = JSON.stringify(s.updates);
      if (updatesNow === lastUpdates) return;
      lastUpdates = updatesNow;
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
    // River lives in the tray, so "on quit" rarely comes: a verified update is installed by
    // itself while River is hidden or unused for a while, never during a call (2.10.13).
    let lastFocusAt: number | null = Date.now();
    window.on('focus', () => (lastFocusAt = Date.now()));
    window.on('blur', () => (lastFocusAt = Date.now()));
    setInterval(() => {
      const prefs = settings.get().updates;
      const now = new Date();
      const ok = shouldAutoInstall({
        ready: service.getStatus().state === 'ready',
        allowed: prefs.autoDownload && prefs.installOnQuit,
        inCall: inCallNow,
        windowVisible: !window.isDestroyed() && window.isVisible() && !window.isMinimized(),
        lastFocusAt: window.isFocused() ? now.getTime() : lastFocusAt,
        hosting: hosting.status().enabled,
        now: now.getTime(),
        hour: now.getHours(),
      });
      if (!ok) return;
      // Back in the tray after the update if that is where River was.
      if (!window.isVisible()) {
        try {
          writeFileSync(hiddenAfterUpdate(), '1');
        } catch {
          // shows the window after the update instead
        }
      }
      service.installNow();
    }, 60_000).unref();
  }

  // Started at sign-in: stay in the tray until the user opens River.
  const startedHidden = process.argv.includes('--hidden') || takeHiddenAfterUpdate();
  const show = (): void => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  window.once('ready-to-show', () => {
    if (!startedHidden) window.show();
  });
  // Windows and Linux start a second River with the link in its arguments: bring this one forward.
  app.on('second-instance', (_event, argv) => {
    show();
    openDeepLink(deepLinkInArgs(argv));
  });
  deliverDeepLink = (link) => {
    if (window.isDestroyed()) {
      pendingDeepLink = link;
      return;
    }
    // The UI takes it when it is ready for it (after unlocking and setting up), so keep it too.
    pendingDeepLink = link;
    window.webContents.send(IPC.appDeepLink, link);
    show();
  };

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
  // macOS: clicking River in the Dock brings back a window closed to the tray.
  app.on('activate', () => {
    if (!window.isDestroyed()) show();
  });
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

/**
 * The window never stays invisible or blank: it is shown after a few seconds
 * even if the first paint never comes, a crashed page is reloaded, and a page
 * that keeps crashing is replaced by a plain explanation.
 */
function watchWindow(window: BrowserWindow, log: ReturnType<typeof createFileLogger>, hidden: boolean): void {
  let painted = false;
  window.once('ready-to-show', () => {
    painted = true;
  });
  if (!hidden) {
    setTimeout(() => {
      if (painted || window.isDestroyed()) return;
      log.warn('window did not paint in time; showing it anyway');
      window.show();
    }, SHOW_WINDOW_FALLBACK_MS);
  }
  let reloads = 0;
  window.webContents.on('render-process-gone', (_e, details) => {
    log.warn(`interface process stopped (${details.reason}, exit ${details.exitCode})`);
    if (details.reason === 'clean-exit' || window.isDestroyed()) return;
    if (reloads < RENDERER_RELOADS) {
      reloads += 1;
      window.reload();
      return;
    }
    window.show();
    void dialog
      .showMessageBox(window, {
        type: 'error',
        title: "River's window keeps closing",
        message: "River's window keeps closing",
        detail: `The interface stopped ${reloads + 1} times (${details.reason}). Try again, or quit and start River with --disable-gpu. The log is in ${join(app.getPath('userData'), 'logs')}.`,
        buttons: ['Try again', 'Quit River'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          reloads = 0;
          window.reload();
        } else app.exit(1);
      });
  });
  window.webContents.on('did-fail-load', (_e, code, description, url) => {
    if (code === -3) return; // aborted by a newer navigation
    log.warn(`interface failed to load (${code} ${description}) ${url.startsWith('data:') ? '' : url}`);
  });
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
    backgroundColor: '#080b11',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 9 } }
      : { titleBarOverlay: { color: '#080b11', symbolColor: '#9aa7c7', height: 32 } }),
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
