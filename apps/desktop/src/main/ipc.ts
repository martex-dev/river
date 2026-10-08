import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { TRUSTED_RELEASE_KEYS } from '@river/release';
import { EXTERNAL_LINKS, IPC, type AppInfo, type SecurityStatus } from '../shared/ipc.ts';
import { isAllowedAppUrl } from './security.ts';
import type { SettingsStore } from './settings-store.ts';
import type { UpdateService } from './updater/update-service.ts';
import { releasePageUrl } from './updater/verify-download.ts';

export interface IpcDeps {
  appInfo: () => AppInfo;
  settings: SettingsStore;
  updates: UpdateService | null;
  updatesDisabledReason: string;
  devServerUrl: string | undefined;
}

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

  handle(IPC.securityStatus, () => securityStatus(deps.updates !== null));
  handle(IPC.openLink, async (_e, id) => {
    await shell.openExternal(EXTERNAL_LINKS[linkIdSchema.parse(id)]);
  });
}

export function broadcastUpdateStatus(target: WebContents, updates: UpdateService): () => void {
  return updates.onStatus((status) => {
    if (!target.isDestroyed()) target.send(IPC.updatesStatusChanged, status);
  });
}

export function securityStatus(updatesEnabled: boolean): SecurityStatus {
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
      {
        id: 'identity',
        label: 'Identity',
        indicator: 'planned',
        value: 'Not created',
        detail: 'Your cryptographic identity and verification fingerprint arrive in 0.0.4.',
      },
      {
        id: 'server',
        label: 'Server message access',
        indicator: 'inactive',
        value: 'No server connected',
        detail: 'This version does not connect to any River server, so no server holds any of your data.',
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
      {
        id: 'storage',
        label: 'Encrypted local storage',
        indicator: 'planned',
        value: 'Arrives in 0.0.3',
        detail:
          'Nothing private is stored yet. Conversations and keys will live in an encrypted local database.',
      },
      {
        id: 'devices',
        label: 'Devices',
        indicator: 'inactive',
        value: 'This device only',
        detail: 'Linking more devices arrives with accounts (0.1.x).',
      },
    ],
    releaseKeys: TRUSTED_RELEASE_KEYS.map((k) => ({ keyId: k.keyId, comment: k.comment })),
  };
}
