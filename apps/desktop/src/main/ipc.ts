import { linkWarnings } from './link-warnings.ts';
import { fetchPreview, type PreviewDeps } from './link-preview.ts';
import { buildExport } from './data-export.ts';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { z } from 'zod';
import { MAX_RELAY_PAYLOAD, MAX_RELAY_RECIPIENTS, MAX_WATCHED_CALL_ROOMS } from '@river/protocol';
import { createCommunityOptionsSchema } from '../shared/templates.ts';
import { TRUSTED_RELEASE_KEYS } from '@river/release';
import {
  EXTERNAL_LINKS,
  IPC,
  type AccountActionResult,
  type AccountStatus,
  type AppInfo,
  type DeepLink,
  type IdentityInfo,
  type PassphraseResult,
  type PhoneFix,
  type PhoneStatus,
  type Result,
  type CommunityEvent,
  type SecurityStatus,
  type StorageStatus,
  type DiagnosticCheck,
  type UpdateStatus,
} from '../shared/ipc.ts';
import type { FetchBytes } from './http.ts';
import type { Hosting } from './host/hosting.ts';
import type { HomeAccount } from './home-server.ts';
import { isAllowedAppUrl } from './security.ts';
import { friendlyError } from './errors.ts';
import { parseSignup } from '../shared/invite-link.ts';
import { isHomeLink } from '../shared/home-server.ts';
import { checkServer } from './server-check.ts';
import { proxySettingsSchema, type ProxySettings } from '../shared/settings.ts';
import type { SettingsStore } from './settings-store.ts';
import { MIN_PASSPHRASE_LENGTH, WrongPassphraseError } from './storage/key-file.ts';
import type { StorageService } from './storage/storage-service.ts';
import type { IdentityService } from './identity/identity-service.ts';
import { UserFacingError, type AccountService } from './account/account-service.ts';
import { attachmentPointerSchema, type CommunityAction } from '../shared/community-actions.ts';
import type { CommunityService } from './community/community-service.ts';
import type { DmService } from './dm/dm-service.ts';
import type { LinkService } from './account/link-service.ts';
import type { SocialService } from './social/social-service.ts';
import type { BackupService } from './backup/backup-service.ts';
import { BackupError } from '@river/crypto';
import type { SocialAction } from '../shared/social.ts';
import type { DmAction, DmEvent } from '../shared/dm.ts';
import { desktopCapturer } from 'electron';
import { releasePageUrl } from './updater/verify-download.ts';

/** What the IPC layer needs of an updater: the desktop's UpdateService, or River for Android's. */
export interface UpdatesApi {
  getStatus(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  install(): void | Promise<void>;
  /** Downloads an available update when automatic download is off (Android does this in install()). */
  downloadNow?(): Promise<void>;
  onStatus(listener: (s: UpdateStatus) => void): () => void;
}

export interface IpcDeps {
  appInfo: () => AppInfo;
  settings: SettingsStore;
  updates: UpdatesApi | null;
  updatesDisabledReason: string;
  devServerUrl: string | undefined;
  /** Size-capped, time-limited fetch used for server checks. */
  fetchBytes: FetchBytes;
  storage: StorageService;
  identity: IdentityService;
  account: AccountService;
  link: LinkService;
  community: CommunityService;
  dm: DmService;
  social: SocialService;
  backup: BackupService;
  /** After a restore: reconnect and re-introduce ourselves to contacts. */
  afterRestore(): Promise<void>;
  /** Screen chosen in River's picker for the next screen share. */
  selectScreen(sourceId: string): void;
  /** Phones: loudspeaker or earpiece for calls (absent on computers); null: the call is over. */
  speaker?: (on: boolean | null) => void;
  /** Phones: a short vibration (absent on computers). */
  haptic?: (kind: 'tap' | 'select' | 'success' | 'warning') => void;
  /** Android: allow picture-in-picture while a call is on (absent elsewhere). */
  pip?: (on: boolean) => void;
  /** Android (2.11): what keeps River reachable while closed, and the phone's screens to fix it. */
  phone?: { status(): Promise<PhoneStatus>; fix(fix: PhoneFix): Promise<PhoneStatus> };
  /** How link previews reach the network (desktop only: phones make no previews). */
  previewDeps?: PreviewDeps;
  /** The "can see your screen" bar and pointing (desktop only; ADR 0007). */
  share?: { status(sharing: boolean, viewers: string[]): void; point(x: number, y: number): void };
  /** Creates the account on River's home server by itself. */
  homeAccount: Pick<
    HomeAccount,
    'ensure' | 'kick' | 'isWaiting' | 'needsInvite' | 'enabled' | 'locate' | 'isHomeServer'
  >;
  /** Settings → System → Connection check. */
  diagnostics(): Promise<DiagnosticCheck[]>;
  /** Settings → Privacy → Proxy → Test connection (computers only; phones have no proxy yet). */
  proxyCheck?: (proxy: ProxySettings) => Promise<DiagnosticCheck[]>;
  openLogs(): Promise<void>;
  /** A River link opened from a browser that the UI has not taken yet. */
  takeDeepLink(kind?: DeepLink['kind']): DeepLink | null;
  /** Hosting communities on this PC. */
  hosting: Pick<
    Hosting,
    | 'status'
    | 'enable'
    | 'disable'
    | 'backupNow'
    | 'openFolder'
    | 'approveAddress'
    | 'checkAddress'
    | 'adminOverview'
    | 'adminSuspend'
    | 'adminUnsuspend'
    | 'adminDeleteAccount'
    | 'adminDeleteCommunity'
    | 'adminCreateSignup'
    | 'adminDeleteSignup'
    | 'adminSetSignupMode'
  >;
}

/** Turns any error into a message that is safe to show. */
async function result<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}

const passphraseSchema = z.string().max(1024);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const linkIdSchema = z.enum(
  Object.keys(EXTERNAL_LINKS) as [keyof typeof EXTERNAL_LINKS, ...(keyof typeof EXTERNAL_LINKS)[]],
);

/** Rejects IPC from anything other than River's own UI (e.g. an injected frame). */
function assertTrustedSender(event: IpcMainInvokeEvent, devServerUrl: string | undefined): void {
  const url = event.senderFrame?.url ?? '';
  if (!isAllowedAppUrl(url, devServerUrl) || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC from untrusted frame rejected');
  }
}

export function registerIpc(deps: IpcDeps): void {
  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, deps.devServerUrl);
      return fn(event, ...args);
    });
  };

  handle(IPC.appInfo, () => deps.appInfo());
  handle(IPC.appTakeDeepLink, (_e, kind) =>
    deps.takeDeepLink(z.enum(['invite', 'friend', 'signup', 'device', 'call']).optional().parse(kind)),
  );
  handle(IPC.appPhoneStatus, () => deps.phone?.status() ?? null);
  handle(IPC.appPhoneFix, (_e, fix) => {
    const which = z.enum(['battery', 'fullScreen', 'notifications']).parse(fix);
    return deps.phone?.fix(which) ?? null;
  });
  handle(IPC.settingsGet, () => deps.settings.get());
  handle(IPC.settingsUpdate, (_e, patch) => deps.settings.update(patch));

  handle(
    IPC.updatesStatus,
    () => deps.updates?.getStatus() ?? { state: 'disabled', reason: deps.updatesDisabledReason },
  );
  handle(IPC.updatesCheck, () =>
    deps.updates ? deps.updates.check() : { state: 'disabled', reason: deps.updatesDisabledReason },
  );
  handle(IPC.updatesInstall, () => deps.updates?.install());
  handle(IPC.updatesDownload, () => deps.updates?.downloadNow?.());
  handle(IPC.updatesOpenDownload, async () => {
    const status = deps.updates?.getStatus();
    if (status && 'version' in status) await shell.openExternal(releasePageUrl(status.version));
    else await shell.openExternal(EXTERNAL_LINKS.releases);
  });

  handle(IPC.hostStatus, () => deps.hosting.status());
  handle(IPC.hostEnable, () => result(() => deps.hosting.enable()));
  handle(IPC.hostDisable, () => result(() => deps.hosting.disable()));
  handle(IPC.hostBackup, () => result(() => deps.hosting.backupNow()));
  handle(IPC.hostOpenFolder, () => deps.hosting.openFolder());
  handle(IPC.hostApproveAddress, () => deps.hosting.approveAddress());
  handle(IPC.hostCheckAddress, () => deps.hosting.checkAddress());
  const adminId = z.string().min(1).max(64);
  handle(IPC.adminOverview, () => result(() => deps.hosting.adminOverview()));
  handle(IPC.adminSuspend, (_e, riverId, until, reason) =>
    result(async () => {
      await deps.hosting.adminSuspend(
        adminId.parse(riverId),
        z.iso.datetime().nullable().parse(until),
        z.string().trim().max(200).optional().parse(reason),
      );
      return null;
    }),
  );
  handle(IPC.adminUnsuspend, (_e, riverId) =>
    result(async () => {
      await deps.hosting.adminUnsuspend(adminId.parse(riverId));
      return null;
    }),
  );
  handle(IPC.adminDeleteAccount, (_e, riverId) =>
    result(async () => {
      await deps.hosting.adminDeleteAccount(adminId.parse(riverId));
      return null;
    }),
  );
  handle(IPC.adminDeleteCommunity, (_e, id) =>
    result(async () => {
      await deps.hosting.adminDeleteCommunity(adminId.parse(id));
      return null;
    }),
  );
  const usernameArg = z.string().trim().max(64);
  handle(IPC.adminCreateSignup, (_e, username) =>
    result(async () => {
      const made = await deps.hosting.adminCreateSignup(usernameArg.parse(username));
      const base = deps.account.status();
      const server = base.state === 'registered' ? base.shareUrl : 'https://river.invalid';
      return { username: made.username, link: `${server}/add#s=${made.code}`, expiresAt: made.expiresAt };
    }),
  );
  handle(IPC.adminDeleteSignup, (_e, username) =>
    result(async () => {
      await deps.hosting.adminDeleteSignup(usernameArg.parse(username));
      return null;
    }),
  );
  handle(IPC.adminSignupMode, (_e, mode) =>
    result(async () => {
      await deps.hosting.adminSetSignupMode(z.enum(['open', 'invite']).parse(mode));
      return null;
    }),
  );
  handle(IPC.securityStatus, () =>
    securityStatus({
      updatesEnabled: deps.updates !== null,
      serverUrl: deps.settings.get().server.url,
      storage: deps.storage.getStatus(),
      identity: deps.identity.get(),
      account: deps.account.status(),
    }),
  );

  handle(IPC.storageStatus, () => deps.storage.getStatus());
  handle(IPC.communityList, (_e, mode) =>
    mode === 'connection-only' ? deps.community.connectionState() : result(() => deps.community.refresh()),
  );
  /**
   * An account for something the person asked for (Set up again, a first community): on
   * River's server when that is the one they were using (River saves its address once it
   * made the account there) or none was chosen, otherwise on the server they chose.
   */
  const accountOn = async (server: string | null): Promise<void> => {
    if (deps.account.status().state !== 'none') return;
    if (!server || (await deps.homeAccount.isHomeServer(server))) {
      await deps.homeAccount.ensure({ force: true });
      if (deps.account.status().state === 'none')
        throw new UserFacingError('River could not set up your account. Try again in a moment.');
      return;
    }
    await deps.account.register(server);
  };
  handle(IPC.communityCreate, (_e, name, rawOptions) =>
    result(async () => {
      const options = createCommunityOptionsSchema.parse(rawOptions ?? {});
      // Creating your first community also creates your account: on River's server, or on the
      // server the person named.
      if (deps.account.status().state === 'none') {
        if (options.serverUrl) {
          deps.settings.update({ server: { url: options.serverUrl } });
          await deps.account.register(options.serverUrl);
        } else {
          await accountOn(deps.settings.get().server.url);
        }
      }
      return deps.community.create(name, options.template);
    }),
  );
  handle(IPC.communityJoin, (_e, link) =>
    result(() =>
      deps.community.join(link, async (serverUrl) => {
        // A permanent link names River's server, wherever it is today.
        if (isHomeLink(serverUrl)) {
          await deps.homeAccount.ensure({ force: true });
          return;
        }
        try {
          await deps.account.register(serverUrl);
          deps.settings.update({ server: { url: serverUrl } });
        } catch (err) {
          // The link's address may be an old one of River's server (its host PC restarted):
          // create the account on River's server instead, where the invite code still works.
          if (!(err instanceof UserFacingError && err.unreachable) || !deps.homeAccount.enabled()) throw err;
          await deps.homeAccount.ensure({ force: true });
        }
      }),
    ),
  );
  handle(IPC.communityInvite, (_e, id) => result(() => deps.community.invite(z.string().parse(id))));
  handle(IPC.communityCreateChannel, (_e, id, kind, name) =>
    result(async () => {
      await deps.community.createChannel(z.string().parse(id), kind, name);
      return null;
    }),
  );
  handle(IPC.communityMessages, (_e, channelId) =>
    result(() => deps.community.messages(z.string().parse(channelId))),
  );
  handle(IPC.communitySend, (_e, channelId, text) =>
    result(() => deps.community.send(z.string().parse(channelId), text)),
  );
  handle(IPC.communityAction, (_e, action) => result(() => deps.community.action(action as CommunityAction)));
  handle(IPC.dmAction, (_e, action) => result(() => deps.dm.action(action as DmAction)));
  handle(IPC.backupStatus, () => deps.backup.status());
  handle(IPC.backupPhrase, () => deps.backup.phrase());
  handle(IPC.backupCreate, (event) =>
    result(async () => {
      const { file, createdAt } = deps.backup.create();
      const win = BrowserWindow.fromWebContents(event.sender);
      const name = `river-backup-${new Date().toISOString().slice(0, 10)}.riverbackup`;
      const options = {
        defaultPath: join(app.getPath('documents'), name),
        filters: [{ name: 'River backup', extensions: ['riverbackup'] }],
      };
      const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return false;
      await writeFile(choice.filePath, file);
      // Only a backup that is really on disk counts as "Last backup".
      deps.backup.saved(createdAt);
      return true;
    }),
  );
  handle(IPC.backupRestore, (_e, file, phrase) =>
    result(async () => {
      if (!(file instanceof Uint8Array) || file.byteLength > 1024 * 1024 * 1024) {
        throw new BackupError('That file is too large to be a River backup.');
      }
      deps.backup.restore(file, z.string().max(1000).parse(phrase));
      await deps.afterRestore();
      return null;
    }),
  );
  handle(IPC.socialAction, (_e, action) => result(() => deps.social.action(action as SocialAction)));
  handle(IPC.profileGet, () => deps.community.profile());
  handle(IPC.attachmentSave, (event, raw) =>
    result(async () => {
      const pointer = attachmentPointerSchema.parse(raw);
      const bytes = await deps.community.downloadAttachment(pointer);
      // Only a plain file name from the (untrusted) message; the user picks the folder.
      const safe =
        basename(pointer.name)
          // eslint-disable-next-line no-control-regex -- strips control characters from file names
          .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
          .replace(/^\.+/, '') || 'file';
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = { defaultPath: join(app.getPath('downloads'), safe) };
      const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return false;
      await writeFile(choice.filePath, bytes);
      return true;
    }),
  );
  handle(IPC.voiceJoin, (_e, channelId) =>
    result(() => {
      deps.community.voiceJoin(z.string().parse(channelId));
      return null;
    }),
  );
  handle(IPC.voiceLeave, () =>
    result(() => {
      deps.community.voiceLeave();
      return null;
    }),
  );
  handle(IPC.voiceSignal, (_e, to, channelId, payload) =>
    result(() => {
      deps.community.signal(z.string().parse(to), z.string().parse(channelId), payload);
      return null;
    }),
  );
  handle(IPC.voiceIceServers, () => deps.community.iceServers());
  // Voice relay frames: fire-and-forget (about 50 a second while talking), so no reply.
  const relayTo = z.array(z.uuid()).min(1).max(MAX_RELAY_RECIPIENTS);
  ipcMain.on(IPC.voiceRelay, (event, to: unknown, payload: unknown) => {
    try {
      assertTrustedSender(event as unknown as IpcMainInvokeEvent, deps.devServerUrl);
      if (!(payload instanceof Uint8Array) || payload.length > MAX_RELAY_PAYLOAD) return;
      deps.community.relaySend(relayTo.parse(to), payload);
    } catch {
      // invalid or untrusted: dropped
    }
  });
  ipcMain.on(IPC.voiceRelayAll, (event, payload: unknown) => {
    try {
      assertTrustedSender(event as unknown as IpcMainInvokeEvent, deps.devServerUrl);
      if (!(payload instanceof Uint8Array) || payload.length < 1 || payload.length > MAX_RELAY_PAYLOAD)
        return;
      deps.community.relaySendAll(payload);
    } catch {
      // invalid or untrusted: dropped
    }
  });
  handle(IPC.voiceRelayInfo, () => ({
    all: deps.community.relayAllSupported,
    groupCalls: deps.community.groupCallsSupported,
  }));
  handle(IPC.voiceCallRoom, (_e, room) => {
    deps.community.callRoom(room === null ? null : z.string().max(64).parse(room));
  });
  handle(IPC.voiceGroupCallRoom, (_e, room) => {
    deps.community.groupCallRoom(room === null ? null : z.string().max(64).parse(room));
  });
  handle(IPC.voiceWatchCallRooms, (_e, rooms) => {
    deps.community.watchCallRooms(z.array(z.string().max(64)).max(MAX_WATCHED_CALL_ROOMS).parse(rooms));
  });
  handle(IPC.diagnosticsRun, () => deps.diagnostics());
  handle(IPC.privacyProxyCheck, async (_e, raw) => {
    const proxy = proxySettingsSchema.parse(raw);
    if (proxy.mode === 'off' || !deps.proxyCheck) return [];
    return deps.proxyCheck(proxy);
  });
  handle(IPC.diagnosticsOpenLogs, () => deps.openLogs());
  handle(IPC.screenSources, async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });
  handle(IPC.screenSelect, (_e, id) => deps.selectScreen(z.string().max(200).parse(id)));
  handle(IPC.voiceSpeaker, (_e, on) => deps.speaker?.(z.boolean().nullable().parse(on)));
  const shareStatus = z.object({
    sharing: z.boolean(),
    viewers: z.array(z.string().max(64)).max(32),
  });
  ipcMain.on(IPC.screenShareStatus, (event, status: unknown) => {
    try {
      assertTrustedSender(event as unknown as IpcMainInvokeEvent, deps.devServerUrl);
      const s = shareStatus.parse(status);
      deps.share?.status(s.sharing, s.viewers);
    } catch {
      // invalid or untrusted: dropped
    }
  });
  const hapticKind = z.enum(['tap', 'select', 'success', 'warning']);
  ipcMain.on(IPC.appHaptic, (event, kind: unknown) => {
    try {
      assertTrustedSender(event as unknown as IpcMainInvokeEvent, deps.devServerUrl);
      deps.haptic?.(hapticKind.parse(kind));
    } catch {
      // invalid or untrusted: dropped
    }
  });
  ipcMain.on(IPC.voicePip, (event, on: unknown) => {
    try {
      assertTrustedSender(event as unknown as IpcMainInvokeEvent, deps.devServerUrl);
      deps.pip?.(z.boolean().parse(on));
    } catch {
      // invalid or untrusted: dropped
    }
  });
  const fraction = z.number().min(0).max(1);
  ipcMain.on(IPC.screenPoint, (event, x: unknown, y: unknown) => {
    try {
      assertTrustedSender(event as unknown as IpcMainInvokeEvent, deps.devServerUrl);
      deps.share?.point(fraction.parse(x), fraction.parse(y));
    } catch {
      // invalid or untrusted: dropped
    }
  });
  handle(IPC.accountStatus, () => accountView(deps.account, deps.homeAccount));
  handle(IPC.accountLinkStart, () => result(() => deps.link.start()));
  handle(IPC.accountLinkConfirm, () => result(() => deps.link.confirm()));
  handle(IPC.accountLinkJoin, (_e, code, deviceName) =>
    result(() => deps.link.join(z.string().max(2048).parse(code), deviceName)),
  );
  handle(IPC.accountLinkCancel, () => deps.link.cancel());
  handle(IPC.accountLinkAccept, () => result(() => deps.link.accept()));
  handle(IPC.accountLinkStatus, () => deps.link.status());
  handle(IPC.accountDevices, () => result(() => deps.link.devices()));
  handle(IPC.accountRemoveDevice, (_e, deviceId) =>
    result(async () => {
      await deps.link.remove(deviceId);
      return null;
    }),
  );
  handle(IPC.accountConnect, () => deps.account.connect());
  handle(IPC.accountSetUsername, (_e, username) =>
    result(() => deps.account.setUsername(z.string().max(64).parse(username))),
  );
  handle(IPC.accountStartOver, () =>
    result(async () => {
      const before = deps.account.status();
      if (before.state !== 'registered' || !before.missing)
        throw new UserFacingError('Your account is fine — nothing to set up again.');
      // The new account is made first; the old one is forgotten only once that worked (a refusal,
      // such as "the account is still there", leaves this device as it was and says why).
      if (await deps.homeAccount.isHomeServer(before.serverUrl)) {
        const url = await deps.homeAccount.locate().catch((err: unknown) => {
          throw new UserFacingError((err as Error).message, { unreachable: true });
        });
        await deps.account.register(url, undefined, { replaceMissing: true });
        deps.settings.update({ server: { url, autoAccount: true } });
      } else {
        await deps.account.register(before.serverUrl, undefined, { replaceMissing: true });
      }
      deps.community.stop();
      deps.community.ensureSocket();
      return deps.account.status();
    }),
  );
  // This device was removed from its account: forget it here, so it can be linked again.
  handle(IPC.accountRelink, () =>
    result(() => {
      deps.account.forgetForRelink();
      deps.community.stop();
      // Fresh protocol state for the device it becomes (like after a restore).
      deps.dm.afterRestore();
      return null;
    }),
  );
  handle(IPC.accountRedeemSignup, (_e, link) =>
    result(async () => {
      const parsed = parseSignup(z.string().max(2048).parse(link));
      if (!parsed) throw new UserFacingError('That is not a valid River sign-up link.');
      const server = isHomeLink(parsed.serverUrl) ? await deps.homeAccount.locate() : parsed.serverUrl;
      const status = await deps.account.register(server, parsed.code);
      deps.settings.update({ server: { url: server } });
      return status;
    }),
  );
  handle(IPC.accountDelete, () =>
    result(async () => {
      await deps.account.deleteAccount();
      deps.community.forgetAll();
      // Never quietly make a new account on River's server after this.
      deps.settings.update({ server: { autoAccount: false } });
      return null;
    }),
  );
  handle(IPC.accountExport, (event) =>
    result(async () => {
      const db = deps.storage.db();
      if (!db) throw new UserFacingError('Unlock River first.');
      const data = buildExport(db, deps.settings.get(), deps.appInfo().version);
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        defaultPath: join(
          app.getPath('documents'),
          `river-data-${new Date().toISOString().slice(0, 10)}.json`,
        ),
        filters: [{ name: 'River data (JSON)', extensions: ['json'] }],
      };
      const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return false;
      await writeFile(choice.filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    }),
  );
  handle(IPC.linkPreview, async (_e, raw) => {
    // Only for people who turned previews on, and only for links they are sending.
    if (!deps.settings.get().appearance.linkPreviews) return null;
    // Previews fetch the page from this computer, not through the proxy: none while one is on.
    if (deps.settings.get().privacy.proxy.mode !== 'off') return null;
    const url = safeExternalUrl(raw);
    // Only web pages have previews (not an email address or phone number).
    if (!url || !/^https?:$/.test(url.protocol) || !deps.previewDeps) return null;
    return fetchPreview(url.toString(), deps.previewDeps).catch(() => null);
  });
  handle(IPC.usersLookup, (_e, username) =>
    result(() => deps.account.lookupUser(z.string().max(64).parse(username))),
  );
  handle(IPC.accountRegister, async (): Promise<AccountActionResult> => {
    try {
      return { ok: true, status: await deps.account.register(deps.settings.get().server.url) };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof UserFacingError ? err.message : 'Something went wrong creating your account.',
      };
    }
  });
  handle(IPC.identityGet, () => deps.identity.get());
  handle(IPC.identityCreate, async (_e, displayName) => {
    const created = await deps.identity.create(displayName);
    // No server address, no button: the account follows the name.
    deps.homeAccount.kick();
    return created;
  });
  handle(IPC.identitySetName, (_e, displayName) => deps.identity.setDisplayName(displayName));
  handle(IPC.storageSetup, async (_e, raw): Promise<PassphraseResult> => {
    const passphrase = passphraseSchema.parse(raw);
    // Pressed twice: the first one is still setting up.
    if (deps.storage.isBusy() || deps.storage.getStatus().state !== 'setup-required')
      return { ok: false, reason: 'not-expected' };
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) return { ok: false, reason: 'too-short' };
    await deps.storage.setupPassphrase(passphrase);
    return { ok: true };
  });
  let failedUnlocks = 0;
  handle(IPC.storageUnlock, async (_e, raw): Promise<PassphraseResult> => {
    const passphrase = passphraseSchema.parse(raw);
    if (deps.storage.isBusy() || deps.storage.getStatus().state !== 'locked')
      return { ok: false, reason: 'not-expected' };
    try {
      await deps.storage.unlock(passphrase);
      failedUnlocks = 0;
      return { ok: true };
    } catch (err) {
      if (!(err instanceof WrongPassphraseError)) throw err;
      failedUnlocks += 1;
      // Slow down repeated guessing through the UI (offline guessing is bounded by Argon2id).
      await sleep(Math.min(5000, 250 * 2 ** failedUnlocks));
      return { ok: false, reason: 'wrong-passphrase' };
    }
  });
  handle(IPC.serverCheck, (_e, url) => checkServer(url, deps.fetchBytes));
  // The window-buttons area follows the theme (1.0.45). Only two hex colours are accepted.
  const titleBarSchema = z.object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    symbol: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  });
  handle(IPC.appTitleBar, async (event, raw) => {
    const { color, symbol } = titleBarSchema.parse(raw);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && process.platform !== 'darwin') {
      try {
        window.setTitleBarOverlay({ color, symbolColor: symbol, height: 32 });
      } catch {
        // no title bar overlay on this window
      }
    }
  });
  handle(IPC.openLink, async (_e, id) => {
    await shell.openExternal(EXTERNAL_LINKS[linkIdSchema.parse(id)]);
  });
  handle(IPC.openUrl, async (event, raw) => {
    const url = safeExternalUrl(raw);
    if (!url) return false;
    const window = BrowserWindow.fromWebContents(event.sender);
    // An email address or phone number (2.19): the mail or phone app, after the same question.
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
      const mail = url.protocol === 'mailto:';
      const ask = {
        type: 'question' as const,
        title: mail ? 'Write an email' : 'Call a number',
        message: mail ? 'Write to this address in your mail app?' : 'Call this number with your phone app?',
        detail: `${url.pathname}

Only do this if you trust the person who sent it.`,
        buttons: [mail ? 'Open mail app' : 'Call', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      };
      const { response } = window
        ? await dialog.showMessageBox(window, ask)
        : await dialog.showMessageBox(ask);
      if (response !== 0) return false;
      await shell.openExternal(url.href);
      return true;
    }
    const warnings = linkWarnings(url);
    const options = {
      type: warnings.some((w) => w.startsWith('⚠')) ? ('warning' as const) : ('question' as const),
      title: 'Open link',
      message: `Open this link in your browser?`,
      detail: `${url.hostname}

${url.href}
${warnings.length ? `\n${warnings.join('\n')}\n` : ''}
Links can lead anywhere. Only open it if you trust where it goes.`,
      buttons: ['Open link', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    };
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    await shell.openExternal(url.href);
    return true;
  });
}

/**
 * Every settings change reaches the UI, also the ones River makes itself (the phone turning
 * app lock off when it has no screen lock, hosting turning on start-at-login, a server move,
 * deleting the account), so the UI never shows a setting — or a protection — that is not so.
 */
export function broadcastSettings(
  target: WebContents,
  settings: Pick<SettingsStore, 'onChange'>,
): () => void {
  return settings.onChange((s) => {
    if (!target.isDestroyed()) target.send(IPC.settingsChanged, s);
  });
}

export function broadcastUpdateStatus(target: WebContents, updates: UpdatesApi): () => void {
  return updates.onStatus((status) => {
    if (!target.isDestroyed()) target.send(IPC.updatesStatusChanged, status);
  });
}

function accountView(
  account: AccountService,
  home: Pick<HomeAccount, 'isWaiting' | 'needsInvite'>,
): AccountStatus {
  const status = account.status();
  if (status.state !== 'none') return status;
  if (home.needsInvite()) return { state: 'none', needsInvite: true };
  return home.isWaiting() ? { state: 'none', waiting: true } : status;
}

export function broadcastAccountStatus(
  target: WebContents,
  account: AccountService,
  home: Pick<HomeAccount, 'isWaiting' | 'needsInvite' | 'onChange'>,
): () => void {
  const send = (): void => {
    if (!target.isDestroyed()) target.send(IPC.accountStatusChanged, accountView(account, home));
  };
  const offAccount = account.onStatus(send);
  const offHome = home.onChange(send);
  return () => {
    offAccount();
    offHome();
  };
}

export function broadcastLinkStatus(target: WebContents, link: LinkService): () => void {
  return link.onChange((progress) => {
    if (!target.isDestroyed()) target.send(IPC.accountLinkChanged, progress);
  });
}

export function broadcastSocialEvents(target: WebContents, social: SocialService): () => void {
  return social.onEvent((event) => {
    if (!target.isDestroyed()) target.send(IPC.socialEvent, event);
  });
}

export function broadcastDmEvents(target: WebContents, dm: DmService): () => void {
  return dm.onEvent((event: DmEvent) => {
    if (!target.isDestroyed()) target.send(IPC.dmEvent, event);
  });
}

export function broadcastCommunityEvents(target: WebContents, community: CommunityService): () => void {
  const offRelay = community.onRelay((from, payload) => {
    if (!target.isDestroyed()) target.send(IPC.voiceRelayIn, from, payload);
  });
  const off = community.onEvent((event: CommunityEvent) => {
    if (!target.isDestroyed()) target.send(IPC.communityEvent, event);
  });
  return () => {
    off();
    offRelay();
  };
}

export function broadcastHostStatus(target: WebContents, hosting: Hosting): () => void {
  return hosting.onStatus((status) => {
    if (!target.isDestroyed()) target.send(IPC.hostStatusChanged, status);
  });
}

export function broadcastStorageStatus(target: WebContents, storage: StorageService): () => void {
  return storage.onStatus((status) => {
    if (!target.isDestroyed()) target.send(IPC.storageStatusChanged, status);
  });
}

function storageItem(status: StorageStatus): SecurityStatus['items'][number] {
  const base = { id: 'storage', label: 'Encrypted local storage' };
  switch (status.state) {
    case 'open':
      return {
        ...base,
        indicator: 'active',
        value: status.protection === 'passphrase' ? 'Active · passphrase' : 'Active',
        detail:
          status.protection === 'passphrase'
            ? 'River\u2019s local database is encrypted with SQLCipher (AES-256). Its key is sealed with your passphrase (Argon2id), which River asks for each time it starts.'
            : `River\u2019s local database is encrypted with SQLCipher (AES-256). Its key is protected by ${status.keystore}, so other user accounts on this computer cannot read it.`,
      };
    case 'error':
      return { ...base, indicator: 'warning', value: 'Unavailable', detail: status.message };
    case 'opening':
      return {
        ...base,
        indicator: 'inactive',
        value: 'Opening…',
        detail: 'River is opening its local database.',
      };
    default:
      return {
        ...base,
        indicator: 'warning',
        value: 'Locked',
        detail: 'River\u2019s local data stays encrypted until you enter your passphrase.',
      };
  }
}

export function securityStatus({
  updatesEnabled,
  serverUrl,
  storage,
  identity,
  account,
}: {
  updatesEnabled: boolean;
  serverUrl: string | null;
  storage: StorageStatus;
  identity: IdentityInfo | null;
  account: AccountStatus;
}): SecurityStatus {
  const serverHost =
    account.state === 'registered' ? account.server : serverUrl ? new URL(serverUrl).host : null;
  return {
    items: [
      {
        id: 'e2ee',
        label: 'End-to-end encryption',
        indicator: 'active',
        value: 'Direct messages and communities',
        detail:
          'Direct messages and 1:1 call setup use the Signal protocol (libsignal: PQXDH with post-quantum keys and the Double Ratchet), so each message has its own key and past messages stay safe if a key leaks later. Communities encrypt names, messages and call setup with a shared community key (AES-256-GCM) that travels only inside invite links — anyone with an invite link can read the community, and removing someone does not change the key yet. Files use a fresh key each (AES-256-CBC + HMAC-SHA256). Voice, video and screen sharing go directly between participants, encrypted with DTLS-SRTP. The server still sees who messages whom and when.',
      },
      identity
        ? {
            id: 'identity',
            label: 'Identity',
            indicator: 'active',
            value: identity.fingerprint.split(' ').slice(0, 2).join(' ') + ' …',
            detail:
              'Your identity key was created on this device and its private half never leaves it. Contacts will verify the fingerprint below to make sure they are really talking to you.',
          }
        : {
            id: 'identity',
            label: 'Identity',
            indicator: 'inactive',
            value: 'Not created',
            detail: 'Create your identity to get a fingerprint your contacts can verify.',
          },
      {
        id: 'server',
        label: 'Server message access',
        indicator: 'inactive',
        value: serverHost ? `None · ${serverHost}` : 'No server configured',
        detail:
          account.state === 'registered'
            ? `Your account on ${serverHost} holds your River ID, your @username if you chose one, your public keys and your signed device list. Direct messages, community messages, profiles and files reach it only end-to-end encrypted — it passes them on and keeps them for devices that are offline, but cannot read them. It does see who messages whom and when.`
            : serverHost
              ? `River is set to use ${serverHost}, but you have no account there yet, so the server holds none of your data.`
              : 'River is not set to use any server, so no server holds any of your data.',
      },
      {
        id: 'updates',
        label: 'Update signatures',
        indicator: updatesEnabled ? 'active' : 'warning',
        value: updatesEnabled ? 'Enforced' : 'Updater off in this build',
        detail:
          'An update is installed only if its release manifest is signed by a River Ed25519 key built into this app and the downloaded file is listed in it.',
      },
      {
        id: 'sandbox',
        label: 'Interface sandbox',
        indicator: 'active',
        value: 'Active',
        detail:
          'The interface runs in a sandboxed process with a strict content security policy. It has no access to files, keys or the network.',
      },
      storageItem(storage),
      account.state === 'registered'
        ? {
            id: 'devices',
            label: 'Devices',
            indicator: account.connection === 'error' ? 'warning' : 'active',
            value: `${account.devices} · signed list v${account.listVersion}`,
            detail:
              account.connection === 'error'
                ? (account.message ?? 'The device list could not be verified.')
                : 'Your devices are listed in a record signed by your identity key. River checks that signature every time it connects, so the server cannot add a device to your account without you noticing.',
          }
        : {
            id: 'devices',
            label: 'Devices',
            indicator: 'inactive',
            value: 'This device only',
            detail:
              'Your device list starts when you create an account. Then you can link your other phones and computers in Settings → Account → Devices; each one is added to a list signed by your identity key.',
          },
    ],
    releaseKeys: TRUSTED_RELEASE_KEYS.map((k) => ({ keyId: k.keyId, comment: k.comment })),
  };
}

/**
 * A link from a message that may be offered to the browser: http(s) only, no embedded credentials.
 * Since 2.19 also an email address (mailto:) or a phone number (tel:) for the mail or phone app —
 * only a plain address or number: no ?subject=, ?body= or ?attach= a link could fill in for you.
 */
export function safeExternalUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') return plainContactUrl(url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

const MAIL_ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+$/;
const PHONE_NUMBER = /^\+?[0-9][0-9.-]{2,30}$/;

function plainContactUrl(url: URL): URL | null {
  if (url.search || url.hash || url.username || url.password || url.host) return null;
  const path = url.pathname;
  if (url.protocol === 'mailto:') return MAIL_ADDRESS.test(path) && path.length <= 254 ? url : null;
  return PHONE_NUMBER.test(path) ? url : null;
}
