import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { TRUSTED_RELEASE_KEYS } from '@river/release';
import {
  EXTERNAL_LINKS,
  IPC,
  type AccountActionResult,
  type AccountStatus,
  type AppInfo,
  type IdentityInfo,
  type PassphraseResult,
  type SecurityStatus,
  type StorageStatus,
} from '../shared/ipc.ts';
import type { FetchBytes } from './http.ts';
import { isAllowedAppUrl } from './security.ts';
import { checkServer } from './server-check.ts';
import type { SettingsStore } from './settings-store.ts';
import { MIN_PASSPHRASE_LENGTH, WrongPassphraseError } from './storage/key-file.ts';
import type { StorageService } from './storage/storage-service.ts';
import type { IdentityService } from './identity/identity-service.ts';
import { UserFacingError, type AccountService } from './account/account-service.ts';
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
        indicator: 'planned',
        value: 'Not active yet',
        detail:
          'This version cannot send messages. River messages will be end-to-end encrypted from the first release that can send them (0.2.0).',
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
