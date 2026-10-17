import { join } from 'node:path';
import { app } from 'electron';
import { channelOfVersion } from '@river/release/channels';
import type { AccountStatus, AppInfo, HostStatus } from '../../desktop/src/shared/ipc.ts';
import type { DmEvent } from '../../desktop/src/shared/dm.ts';
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
  broadcastSettings,
  broadcastSocialEvents,
  broadcastStorageStatus,
  broadcastUpdateStatus,
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
import {
  ask,
  emit,
  inbound,
  onDeepLink,
  onInvoke,
  onLifecycle,
  onUiGone,
  onWake,
  ready,
  ui,
  uiPresent,
} from './host.ts';
import { phonePlatform } from './platform.ts';
import { accountGone } from './account-gone.ts';
import { isFreshInstall } from './fresh-install.ts';
import { AndroidUpdateService, CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS } from './updater.ts';
import { TRUSTED_RELEASE_KEYS } from '@river/release';
import { parseDeepLink } from '../../desktop/src/main/deep-link.ts';
import { IPC, type DeepLink, type PhoneFix, type PhoneStatus } from '../../desktop/src/shared/ipc.ts';
import { silenced } from '../../desktop/src/shared/notify-rules.ts';

/**
 * River's client core on a phone: the desktop's services (accounts,
 * communities, direct messages, social, backup) and its validated IPC layer,
 * started without the parts only a computer has (hosting, tray, screen
 * picker). Android updates itself from signed releases (updater.ts); iOS cannot. The UI talks to it exactly as it talks to Electron's main
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
/** Sideloaded iPhone apps cannot replace themselves: iOS only installs an IPA that is signed again. */
const IOS_UPDATES =
  'River on iPhone cannot update itself: iOS only lets you install a new version by sideloading its IPA again. Get it from the download page.';

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

/** Android or iOS: the same core runs on both (the iOS shell says so; iPads look like Macs). */
const PLATFORM = phonePlatform();
/**
 * Whether River's screen is in front. The core starts in the background: Android can start it
 * with no screen at all (Stay connected), and the shell reports the foreground once the screen
 * is up. Until then notifications show, rather than being taken as seen.
 */
let foreground = false;
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
  // A new install: nothing of River on this phone yet. Checked before the logger writes `logs`.
  const freshInstall = isFreshInstall(userData);
  const log = createFileLogger(join(userData, 'logs'));
  log.info(`River ${app.getVersion()} starting on ${PLATFORM}`);

  const settingsPath = join(userData, 'settings.json');
  const settings = new SettingsStore(settingsPath, log);
  // Android (2.11): a new install stays connected, so messages and calls reach you while River is
  // closed (a visible "River is connected" notification shows meanwhile; Settings → System turns it
  // off). Existing installs are asked once instead (the UI's "Get messages and calls…" prompt).
  // Computers and iPhones keep the shared default (off).
  if (PLATFORM === 'android' && freshInstall) settings.update({ system: { background: true } });
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
    onCallChange: (active) => {
      inCall = active;
      if (!active) activeCall = null;
      // iPhone: only the call's state, for the proximity sensor (screen off at your ear).
      if (PLATFORM === 'ios') void ask('callState', { active }).catch(() => undefined);
      if (PLATFORM === 'android') {
        // Leaving a voice channel to answer a call is not the end of calls for now: River keeps
        // showing over the lock screen while that call rings or starts (2.11.3).
        const keepOverLock = !active && ringing !== null;
        void ask<string>('call', {
          active,
          ...(active ? { title: callTitle() } : {}),
          ...(keepOverLock ? { keepOverLock: true } : {}),
        }).then(
          (how) => {
            if (how !== 'hangup') return;
            // The UI ends the call itself (it tells the other side); without a UI the core does.
            if (uiPresent()) community.hangUp();
            else leaveCall();
          },
          () => undefined,
        );
      }
      // The call is on: its ringing is over. Asked after "call", so the shell already knows the
      // call is on and keeps it over the lock screen.
      if (active) ringOver();
    },
  });
  // ---- calls without a screen (Android, Stay connected) ----
  let inCall = false;
  /** The 1:1 call the UI started or accepted, so the core can end it if the UI goes away. */
  let activeCall: { peer: string; callId: string } | null = null;
  /** Who the "In a call" notification names: the person (unless previews hide names) or voice. */
  const callTitle = (): string => {
    if (!activeCall) return 'Voice channel';
    return settings.get().notifications.preview === 'none' ? 'River call' : dm.nameOf(activeCall.peer);
  };
  /**
   * The UI's WebView carries a call's media: when it is gone (River's screen closed while the
   * core stays connected), the call cannot go on. Leave the voice channel or the call's relay
   * room and tell the other side, rather than staying "in a call" with no sound.
   */
  const leaveCall = (): void => {
    const call = activeCall;
    activeCall = null;
    if (call)
      void dm.action({ a: 'call', peer: call.peer, callId: call.callId, kind: 'end' }).catch(() => undefined);
    if (!inCall) return;
    community.voiceLeave();
    community.callRoom(null);
  };
  onUiGone(leaveCall);
  /** An incoming call ringing now: the Android shell shows River over the lock screen meanwhile. */
  let ringing: string | null = null;
  const ringOver = (callId?: string): void => {
    if (ringing === null || (callId !== undefined && callId !== ringing)) return;
    ringing = null;
    if (PLATFORM === 'android') void ask('ringing', { on: false }).catch(() => undefined);
  };
  onInvoke((channel, args) => {
    if (channel !== IPC.dmAction) return;
    const a = args[0] as { a?: unknown; kind?: unknown; peer?: unknown; callId?: unknown } | null | undefined;
    if (!a || a.a !== 'call' || typeof a.peer !== 'string' || typeof a.callId !== 'string') return;
    if (a.kind === 'invite' || a.kind === 'accept') activeCall = { peer: a.peer, callId: a.callId };
    else if (a.kind === 'end' || a.kind === 'decline' || a.kind === 'busy') {
      if (activeCall?.callId === a.callId) activeCall = null;
      // Declined here: River no longer shows over the lock screen.
      ringOver(a.callId);
    }
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
  /**
   * Android (2.11): an incoming call rings like a phone call — the phone's ringtone, a call screen
   * over the lock screen, Answer and Decline in the notification. The shell answers how it ended
   * there: "accept" (River's screen opens and answers), "decline" (declined here, without River's
   * screen), or anything else (it stopped ringing for another reason).
   */
  const ringOnPhone = (e: Extract<DmEvent, { t: 'call' }>): void => {
    const s = settings.get();
    // Like a phone call, it rings whatever the message notifications are set to; only Do Not
    // Disturb and quiet hours keep it quiet (2.11.2).
    if (silenced(s)) return;
    // Already in a call: the caller hears "busy", and nothing takes over this screen or its sound.
    if (activeCall && activeCall.callId !== e.callId) {
      void dm.action({ a: 'call', peer: e.peer, callId: e.callId, kind: 'busy' }).catch(() => undefined);
      return;
    }
    const name = s.notifications.preview === 'none' ? 'Someone' : dm.nameOf(e.peer);
    void ask<string>('incomingCall', { callId: e.callId, name, video: e.video }).then(
      (how) => {
        if (ringing !== e.callId) return;
        if (how === 'accept') {
          // River's screen opens now: a window already open answers on this event, one that is
          // still starting finds the call as pendingCall with `answer`.
          dm.answerRinging(e.callId);
          emit(IPC.appPhoneCall, [{ callId: e.callId, action: 'answer' }]);
        } else if (how === 'decline') {
          void dm
            .action({ a: 'call', peer: e.peer, callId: e.callId, kind: 'decline' })
            .catch(() => undefined);
          void dm
            .action({
              a: 'logCall',
              peer: e.peer,
              direction: 'in',
              video: e.video,
              answered: false,
              outcome: 'declined',
              durationSec: 0,
            })
            .catch(() => undefined);
          emit(IPC.appPhoneCall, [{ callId: e.callId, action: 'decline' }]);
          ringOver(e.callId);
        }
      },
      () => undefined,
    );
  };
  dm.onEvent((e) => {
    if (e.t !== 'call') return;
    if (e.kind === 'invite') {
      // A second call while one rings never gets here: the caller hears "busy" (dm-service).
      ringing = e.callId;
      if (PLATFORM === 'android') ringOnPhone(e);
    } else if (e.kind !== 'signal') {
      // The caller gave up, or the other side ended the call.
      if (e.kind !== 'accept' && activeCall?.callId === e.callId) activeCall = null;
      ringOver(e.callId);
    }
  });
  // However a call stopped ringing (answered, declined, handled elsewhere, missed, timed out).
  dm.onRingEnd((end) => {
    ringOver(end.event.callId);
    // Missed while River's screen is closed (Stay connected): River's window would have kept the
    // record; without it the core does, so the call history shows it (and a notification says so:
    // notifications.ts). Answered on the call screen but never taken: it could not connect.
    if (end.how !== 'missed' || uiPresent()) return;
    void dm
      .action({
        a: 'logCall',
        peer: end.event.peer,
        direction: 'in',
        video: end.event.video,
        answered: false,
        durationSec: 0,
        callId: end.event.callId,
        ...(end.answeredOnPhone ? { outcome: 'failed' as const } : {}),
      })
      .catch(() => undefined);
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
  let lastAccount: AccountStatus | null = account.status();
  account.onStatus((s) => {
    // Signed out or removed: the account's message notifications go away (Android shell).
    if (PLATFORM === 'android' && accountGone(lastAccount, s))
      void ask('clearNotifications', {}).catch(() => undefined);
    lastAccount = s;
    if (s.state === 'registered' && s.connection === 'online') community.ensureSocket();
  });
  // Coming back to the app (or the network returning): reconnect now rather than after the backoff.
  onLifecycle((state) => {
    foreground = state === 'foreground';
    lastActive = Date.now();
    presence.check();
    if (foreground) community.reconnectNow();
  });
  // Android's watchdog (Stay connected, 2.11) wakes the phone every few minutes: with the screen
  // off the heartbeat may have slept through a dropped connection. Check it, or connect again.
  onWake(() => {
    if (storage.getStatus().state !== 'open') return;
    const status = account.status();
    if (status.state !== 'registered') return;
    if (status.connection !== 'online') void connectAll().catch(() => undefined);
    else community.probe();
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
  // Android: signed updates from GitHub Releases, installed by Android's own installer.
  const updates =
    PLATFORM === 'android'
      ? new AndroidUpdateService({
          currentVersion: app.getVersion(),
          preferences: () => settings.get().updates,
          ask: (kind, args) => ask(kind, args),
          dir: join(userData, 'updates'),
          trustedKeys: TRUSTED_RELEASE_KEYS,
          log,
        })
      : null;
  updates?.start();
  registerIpc({
    appInfo,
    settings,
    updates,
    updatesDisabledReason: IOS_UPDATES,
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
    // null: the 1:1 call is over (or never started): the phone's audio goes back to normal,
    // unless another call keeps it (2.11.3).
    speaker: (on) =>
      void (on === null ? ask('callAudio', { active: false }) : ask('speaker', { on })).catch(
        () => undefined,
      ),
    haptic: (kind) => void ask('haptic', { kind }).catch(() => undefined),
    pip: (on) => {
      if (PLATFORM === 'android') void ask('pip', { on }).catch(() => undefined);
    },
    // Android (2.11): what keeps River reachable while closed, read from the phone each time.
    ...(PLATFORM === 'android'
      ? {
          phone: {
            status: () => ask<PhoneStatus>('phoneStatus', {}),
            fix: (fix: PhoneFix) => ask<PhoneStatus>('phoneFix', { fix }),
          },
        }
      : {}),
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
  broadcastSettings(target, settings);
  broadcastAccountStatus(target, account, homeAccount);
  broadcastCommunityEvents(target, community);
  broadcastDmEvents(target, dm);
  broadcastLinkStatus(target, link);
  broadcastSocialEvents(target, social);
  if (updates) {
    broadcastUpdateStatus(target, updates);
    // As on the desktop: a change to the update settings (automatic checks on, a new channel) checks now.
    let lastUpdates = JSON.stringify(settings.get().updates);
    settings.onChange((s) => {
      const now = JSON.stringify(s.updates);
      if (now === lastUpdates) return;
      lastUpdates = now;
      if (s.updates.autoCheck && updates.getStatus().state === 'up-to-date') void updates.check();
    });
    const scheduledCheck = (): void => {
      if (settings.get().updates.autoCheck) void updates.check();
    };
    setTimeout(scheduledCheck, FIRST_CHECK_DELAY_MS);
    setInterval(scheduledCheck, CHECK_INTERVAL_MS);
  }
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
