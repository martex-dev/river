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
import { createCommunityOptionsSchema } from '../shared/templates.ts';
import { TRUSTED_RELEASE_KEYS } from '@river/release';
import {
  EXTERNAL_LINKS,
  IPC,
  type AccountActionResult,
  type AccountStatus,
  type AppInfo,
  type HostStatus,
  type IdentityInfo,
  type PassphraseResult,
  type Result,
  type CommunityEvent,
  type SecurityStatus,
  type StorageStatus,
} from '../shared/ipc.ts';
import type { FetchBytes } from './http.ts';
import { isAllowedAppUrl } from './security.ts';
import { friendlyError } from './errors.ts';
import { checkServer } from './server-check.ts';
import type { SettingsStore } from './settings-store.ts';
import { MIN_PASSPHRASE_LENGTH, WrongPassphraseError } from './storage/key-file.ts';
import type { StorageService } from './storage/storage-service.ts';
import type { IdentityService } from './identity/identity-service.ts';
import { UserFacingError, type AccountService } from './account/account-service.ts';
import { attachmentPointerSchema, type CommunityAction } from '../shared/community-actions.ts';
import type { CommunityService } from './community/community-service.ts';
import type { DmService } from './dm/dm-service.ts';
import type { SocialService } from './social/social-service.ts';
import type { BackupService } from './backup/backup-service.ts';
import { BackupError } from '@river/crypto';
import type { SocialAction } from '../shared/social.ts';
import type { DmAction, DmEvent } from '../shared/dm.ts';
import { desktopCapturer } from 'electron';
import type { UpdateService } from './updater/update-service.ts';
import { releasePageUrl } from './updater/verify-download.ts';

export interface IpcDeps {
  appInfo: () => AppInfo;
  settings: SettingsStore;
  updates: UpdateService | null;
  updatesDisabledReason: string;
  devServerUrl: string | undefined;
  /** Size-capped, time-limited fetch used for server checks. */
  fetchBytes: FetchBytes;
  storage: StorageService;
  identity: IdentityService;
  account: AccountService;
  community: CommunityService;
  dm: DmService;
  social: SocialService;
  backup: BackupService;
  /** After a restore: reconnect and re-introduce ourselves to contacts. */
  afterRestore(): Promise<void>;
  /** Screen chosen in River's picker for the next screen share. */
  selectScreen(sourceId: string): void;
  /** Finds out whether River Host runs a server on this PC. */
  hostStatus(): Promise<HostStatus>;
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
  handle(IPC.updatesOpenDownload, async () => {
    const status = deps.updates?.getStatus();
    if (status && 'version' in status) await shell.openExternal(releasePageUrl(status.version));
    else await shell.openExternal(EXTERNAL_LINKS.releases);
  });

  handle(IPC.hostStatus, () => deps.hostStatus());
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
  handle(IPC.communityCreate, (_e, name, rawOptions) =>
    result(async () => {
      const options = createCommunityOptionsSchema.parse(rawOptions ?? {});
      // Creating your first community can also create your account, like joining does.
      if (deps.account.status().state === 'none') {
        if (!options.serverUrl)
          throw new UserFacingError('Enter the address of a River server to create your account on.');
        deps.settings.update({ server: { url: options.serverUrl } });
        await deps.account.register(options.serverUrl);
      }
      return deps.community.create(name, options.template);
    }),
  );
  handle(IPC.communityJoin, (_e, link) =>
    result(() =>
      deps.community.join(link, async (serverUrl) => {
        deps.settings.update({ server: { url: serverUrl } });
        await deps.account.register(serverUrl);
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
      const file = deps.backup.create();
      const win = BrowserWindow.fromWebContents(event.sender);
      const name = `river-backup-${new Date().toISOString().slice(0, 10)}.riverbackup`;
      const options = {
        defaultPath: join(app.getPath('documents'), name),
        filters: [{ name: 'River backup', extensions: ['riverbackup'] }],
      };
      const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return false;
      await writeFile(choice.filePath, file);
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
  handle(IPC.screenSources, async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });
  handle(IPC.screenSelect, (_e, id) => deps.selectScreen(z.string().max(200).parse(id)));
  handle(IPC.accountStatus, () => deps.account.status());
  handle(IPC.accountConnect, () => deps.account.connect());
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
  handle(IPC.identityCreate, (_e, displayName) => deps.identity.create(displayName));
  handle(IPC.identitySetName, (_e, displayName) => deps.identity.setDisplayName(displayName));
  handle(IPC.storageSetup, async (_e, raw): Promise<PassphraseResult> => {
    const passphrase = passphraseSchema.parse(raw);
    if (deps.storage.getStatus().state !== 'setup-required') return { ok: false, reason: 'not-expected' };
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) return { ok: false, reason: 'too-short' };
    await deps.storage.setupPassphrase(passphrase);
    return { ok: true };
  });
  let failedUnlocks = 0;
  handle(IPC.storageUnlock, async (_e, raw): Promise<PassphraseResult> => {
    const passphrase = passphraseSchema.parse(raw);
    if (deps.storage.getStatus().state !== 'locked') return { ok: false, reason: 'not-expected' };
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
  handle(IPC.openLink, async (_e, id) => {
    await shell.openExternal(EXTERNAL_LINKS[linkIdSchema.parse(id)]);
  });
}

export function broadcastUpdateStatus(target: WebContents, updates: UpdateService): () => void {
  return updates.onStatus((status) => {
    if (!target.isDestroyed()) target.send(IPC.updatesStatusChanged, status);
  });
}

export function broadcastAccountStatus(target: WebContents, account: AccountService): () => void {
  return account.onStatus((status) => {
    if (!target.isDestroyed()) target.send(IPC.accountStatusChanged, status);
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
  return community.onEvent((event: CommunityEvent) => {
    if (!target.isDestroyed()) target.send(IPC.communityEvent, event);
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
            ? `Your account on ${serverHost} holds only your River ID, your public identity key and your signed device list. It cannot read anything you write: there is no messaging yet, and when it arrives the server will only ever relay encrypted messages.`
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
              'Your device list starts when you create an account. Linking more devices comes later in 0.1.x.',
          },
    ],
    releaseKeys: TRUSTED_RELEASE_KEYS.map((k) => ({ keyId: k.keyId, comment: k.comment })),
  };
}
