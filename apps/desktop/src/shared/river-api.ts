import type { DmEvent } from './dm.ts';
import type { SocialEvent } from './social.ts';
import {
  IPC,
  type AccountStatus,
  type CommunityEvent,
  type DeepLink,
  type HostStatus,
  type RiverApi,
  type StorageStatus,
  type UpdateStatus,
} from './ipc.ts';

/**
 * How River's UI reaches the client core: the same `window.river` on every
 * platform, over a transport — Electron IPC on the desktop (preload), the
 * app shell's bridge on phones (apps/mobile/ui/bridge.ts).
 */
export interface RiverTransport {
  invoke(channel: string, ...args: unknown[]): Promise<never>;
  send(channel: string, ...args: unknown[]): void;
  /** Subscribes to a core event; returns the unsubscribe function. */
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}

export function createRiverApi(t: RiverTransport): RiverApi {
  return {
    app: {
      info: () => t.invoke(IPC.appInfo),
      takeDeepLink: () => t.invoke(IPC.appTakeDeepLink),
      setTitleBar: (colors) => t.invoke(IPC.appTitleBar, colors),
      onDeepLink: (listener) => t.on(IPC.appDeepLink, (...args) => listener(args[0] as DeepLink)),
    },
    settings: {
      get: () => t.invoke(IPC.settingsGet),
      update: (patch) => t.invoke(IPC.settingsUpdate, patch),
    },
    updates: {
      status: () => t.invoke(IPC.updatesStatus),
      check: () => t.invoke(IPC.updatesCheck),
      install: () => t.invoke(IPC.updatesInstall),
      openDownloadPage: () => t.invoke(IPC.updatesOpenDownload),
      onStatus: (listener) => t.on(IPC.updatesStatusChanged, (...args) => listener(args[0] as UpdateStatus)),
    },
    security: { status: () => t.invoke(IPC.securityStatus) },
    host: {
      status: () => t.invoke(IPC.hostStatus),
      enable: () => t.invoke(IPC.hostEnable),
      disable: () => t.invoke(IPC.hostDisable),
      backupNow: () => t.invoke(IPC.hostBackup),
      openFolder: () => t.invoke(IPC.hostOpenFolder),
      approveAddress: () => t.invoke(IPC.hostApproveAddress),
      checkAddress: () => t.invoke(IPC.hostCheckAddress),
      onStatus: (listener) => t.on(IPC.hostStatusChanged, (...args) => listener(args[0] as HostStatus)),
    },
    admin: {
      overview: () => t.invoke(IPC.adminOverview),
      suspend: (riverId, until, reason) => t.invoke(IPC.adminSuspend, riverId, until, reason),
      unsuspend: (riverId) => t.invoke(IPC.adminUnsuspend, riverId),
      deleteAccount: (riverId) => t.invoke(IPC.adminDeleteAccount, riverId),
      deleteCommunity: (id) => t.invoke(IPC.adminDeleteCommunity, id),
      createSignup: (username) => t.invoke(IPC.adminCreateSignup, username),
      deleteSignup: (username) => t.invoke(IPC.adminDeleteSignup, username),
      setSignupMode: (mode) => t.invoke(IPC.adminSignupMode, mode),
    },
    server: { check: (url) => t.invoke(IPC.serverCheck, url) },
    identity: {
      get: () => t.invoke(IPC.identityGet),
      create: (displayName) => t.invoke(IPC.identityCreate, displayName),
      setDisplayName: (displayName) => t.invoke(IPC.identitySetName, displayName),
    },
    account: {
      status: () => t.invoke(IPC.accountStatus),
      register: () => t.invoke(IPC.accountRegister),
      connect: () => t.invoke(IPC.accountConnect),
      setUsername: (username) => t.invoke(IPC.accountSetUsername, username),
      redeemSignup: (link) => t.invoke(IPC.accountRedeemSignup, link),
      startOver: () => t.invoke(IPC.accountStartOver),
      deleteAccount: () => t.invoke(IPC.accountDelete),
      exportData: () => t.invoke(IPC.accountExport),
      onStatus: (listener) => t.on(IPC.accountStatusChanged, (...args) => listener(args[0] as AccountStatus)),
    },
    users: {
      lookup: (username) => t.invoke(IPC.usersLookup, username),
    },
    backup: {
      status: () => t.invoke(IPC.backupStatus),
      phrase: () => t.invoke(IPC.backupPhrase),
      create: () => t.invoke(IPC.backupCreate),
      restore: (file, phrase) => t.invoke(IPC.backupRestore, file, phrase),
    },
    social: {
      action: (action) => t.invoke(IPC.socialAction, action),
      onEvent: (listener) => t.on(IPC.socialEvent, (...args) => listener(args[0] as SocialEvent)),
    },
    dm: {
      action: (action) => t.invoke(IPC.dmAction, action),
      onEvent: (listener) => t.on(IPC.dmEvent, (...args) => listener(args[0] as DmEvent)),
    },
    community: {
      list: () => t.invoke(IPC.communityList),
      create: (name, options) => t.invoke(IPC.communityCreate, name, options),
      join: (link) => t.invoke(IPC.communityJoin, link),
      invite: (id) => t.invoke(IPC.communityInvite, id),
      createChannel: (id, kind, name) => t.invoke(IPC.communityCreateChannel, id, kind, name),
      messages: (channelId) => t.invoke(IPC.communityMessages, channelId),
      send: (channelId, text) => t.invoke(IPC.communitySend, channelId, text),
      connection: () => t.invoke(IPC.communityList, 'connection-only'),
      action: (action) => t.invoke(IPC.communityAction, action),
      profile: () => t.invoke(IPC.profileGet),
      saveAttachment: (pointer) => t.invoke(IPC.attachmentSave, pointer),
      onEvent: (listener) => t.on(IPC.communityEvent, (...args) => listener(args[0] as CommunityEvent)),
    },
    voice: {
      join: (channelId) => t.invoke(IPC.voiceJoin, channelId),
      leave: () => t.invoke(IPC.voiceLeave),
      signal: (to, channelId, payload) => t.invoke(IPC.voiceSignal, to, channelId, payload),
      iceServers: () => t.invoke(IPC.voiceIceServers),
      relay: (to, payload) => t.send(IPC.voiceRelay, to, payload),
      callRoom: (room) => t.invoke(IPC.voiceCallRoom, room),
      onRelay: (listener) =>
        t.on(IPC.voiceRelayIn, (...args) => listener(args[0] as string, args[1] as Uint8Array)),
      screenSources: () => t.invoke(IPC.screenSources),
      selectScreen: (id) => t.invoke(IPC.screenSelect, id),
    },
    storage: {
      status: () => t.invoke(IPC.storageStatus),
      setupPassphrase: (passphrase) => t.invoke(IPC.storageSetup, passphrase),
      unlock: (passphrase) => t.invoke(IPC.storageUnlock, passphrase),
      onStatus: (listener) => t.on(IPC.storageStatusChanged, (...args) => listener(args[0] as StorageStatus)),
    },
    links: {
      open: (id) => t.invoke(IPC.openLink, id),
      openUrl: (url) => t.invoke(IPC.openUrl, url),
      preview: (url) => t.invoke(IPC.linkPreview, url),
    },
    diagnostics: {
      run: () => t.invoke(IPC.diagnosticsRun),
      openLogs: () => t.invoke(IPC.diagnosticsOpenLogs),
    },
  };
}
