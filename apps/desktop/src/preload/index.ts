import type { DmEvent } from '../shared/dm.ts';
import type { SocialEvent } from '../shared/social.ts';
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type AccountStatus,
  type CommunityEvent,
  type HostStatus,
  type RiverApi,
  type StorageStatus,
  type UpdateStatus,
} from '../shared/ipc.ts';

// The only surface the UI gets. No Node, no ipcRenderer, no arbitrary channels.
const api: RiverApi = {
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    openDownloadPage: () => ipcRenderer.invoke(IPC.updatesOpenDownload),
    onStatus: (listener) => {
      const handler = (_event: unknown, status: UpdateStatus): void => listener(status);
      ipcRenderer.on(IPC.updatesStatusChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.updatesStatusChanged, handler);
      };
    },
  },
  security: { status: () => ipcRenderer.invoke(IPC.securityStatus) },
  host: {
    status: () => ipcRenderer.invoke(IPC.hostStatus),
    enable: () => ipcRenderer.invoke(IPC.hostEnable),
    disable: () => ipcRenderer.invoke(IPC.hostDisable),
    backupNow: () => ipcRenderer.invoke(IPC.hostBackup),
    openFolder: () => ipcRenderer.invoke(IPC.hostOpenFolder),
    onStatus: (listener) => {
      const handler = (_event: unknown, status: HostStatus): void => listener(status);
      ipcRenderer.on(IPC.hostStatusChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.hostStatusChanged, handler);
      };
    },
  },
  admin: {
    overview: () => ipcRenderer.invoke(IPC.adminOverview),
    suspend: (riverId, until, reason) => ipcRenderer.invoke(IPC.adminSuspend, riverId, until, reason),
    unsuspend: (riverId) => ipcRenderer.invoke(IPC.adminUnsuspend, riverId),
    deleteAccount: (riverId) => ipcRenderer.invoke(IPC.adminDeleteAccount, riverId),
    deleteCommunity: (id) => ipcRenderer.invoke(IPC.adminDeleteCommunity, id),
    createSignup: (username) => ipcRenderer.invoke(IPC.adminCreateSignup, username),
    deleteSignup: (username) => ipcRenderer.invoke(IPC.adminDeleteSignup, username),
    setSignupMode: (mode) => ipcRenderer.invoke(IPC.adminSignupMode, mode),
  },
  server: { check: (url) => ipcRenderer.invoke(IPC.serverCheck, url) },
  identity: {
    get: () => ipcRenderer.invoke(IPC.identityGet),
    create: (displayName) => ipcRenderer.invoke(IPC.identityCreate, displayName),
    setDisplayName: (displayName) => ipcRenderer.invoke(IPC.identitySetName, displayName),
  },
  account: {
    status: () => ipcRenderer.invoke(IPC.accountStatus),
    register: () => ipcRenderer.invoke(IPC.accountRegister),
    connect: () => ipcRenderer.invoke(IPC.accountConnect),
    setUsername: (username) => ipcRenderer.invoke(IPC.accountSetUsername, username),
    redeemSignup: (link) => ipcRenderer.invoke(IPC.accountRedeemSignup, link),
    onStatus: (listener) => {
      const handler = (_event: unknown, status: AccountStatus): void => listener(status);
      ipcRenderer.on(IPC.accountStatusChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.accountStatusChanged, handler);
      };
    },
  },
  users: {
    lookup: (username) => ipcRenderer.invoke(IPC.usersLookup, username),
  },
  backup: {
    status: () => ipcRenderer.invoke(IPC.backupStatus),
    phrase: () => ipcRenderer.invoke(IPC.backupPhrase),
    create: () => ipcRenderer.invoke(IPC.backupCreate),
    restore: (file, phrase) => ipcRenderer.invoke(IPC.backupRestore, file, phrase),
  },
  social: {
    action: (action) => ipcRenderer.invoke(IPC.socialAction, action),
    onEvent: (listener) => {
      const handler = (_event: unknown, e: SocialEvent): void => listener(e);
      ipcRenderer.on(IPC.socialEvent, handler);
      return () => {
        ipcRenderer.removeListener(IPC.socialEvent, handler);
      };
    },
  },
  dm: {
    action: (action) => ipcRenderer.invoke(IPC.dmAction, action),
    onEvent: (listener) => {
      const handler = (_event: unknown, e: DmEvent): void => listener(e);
      ipcRenderer.on(IPC.dmEvent, handler);
      return () => {
        ipcRenderer.removeListener(IPC.dmEvent, handler);
      };
    },
  },
  community: {
    list: () => ipcRenderer.invoke(IPC.communityList),
    create: (name, options) => ipcRenderer.invoke(IPC.communityCreate, name, options),
    join: (link) => ipcRenderer.invoke(IPC.communityJoin, link),
    invite: (id) => ipcRenderer.invoke(IPC.communityInvite, id),
    createChannel: (id, kind, name) => ipcRenderer.invoke(IPC.communityCreateChannel, id, kind, name),
    messages: (channelId) => ipcRenderer.invoke(IPC.communityMessages, channelId),
    send: (channelId, text) => ipcRenderer.invoke(IPC.communitySend, channelId, text),
    connection: () => ipcRenderer.invoke(IPC.communityList, 'connection-only'),
    action: (action) => ipcRenderer.invoke(IPC.communityAction, action),
    profile: () => ipcRenderer.invoke(IPC.profileGet),
    saveAttachment: (pointer) => ipcRenderer.invoke(IPC.attachmentSave, pointer),
    onEvent: (listener) => {
      const handler = (_event: unknown, e: CommunityEvent): void => listener(e);
      ipcRenderer.on(IPC.communityEvent, handler);
      return () => {
        ipcRenderer.removeListener(IPC.communityEvent, handler);
      };
    },
  },
  voice: {
    join: (channelId) => ipcRenderer.invoke(IPC.voiceJoin, channelId),
    leave: () => ipcRenderer.invoke(IPC.voiceLeave),
    signal: (to, channelId, payload) => ipcRenderer.invoke(IPC.voiceSignal, to, channelId, payload),
    iceServers: () => ipcRenderer.invoke(IPC.voiceIceServers),
    screenSources: () => ipcRenderer.invoke(IPC.screenSources),
    selectScreen: (id) => ipcRenderer.invoke(IPC.screenSelect, id),
  },
  storage: {
    status: () => ipcRenderer.invoke(IPC.storageStatus),
    setupPassphrase: (passphrase) => ipcRenderer.invoke(IPC.storageSetup, passphrase),
    unlock: (passphrase) => ipcRenderer.invoke(IPC.storageUnlock, passphrase),
    onStatus: (listener) => {
      const handler = (_event: unknown, status: StorageStatus): void => listener(status);
      ipcRenderer.on(IPC.storageStatusChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC.storageStatusChanged, handler);
      };
    },
  },
  links: { open: (id) => ipcRenderer.invoke(IPC.openLink, id) },
};

contextBridge.exposeInMainWorld('river', api);
