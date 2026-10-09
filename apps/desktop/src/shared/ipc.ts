import type { ReleaseChannel } from '@river/release/channels';
import type { CreateCommunityOptions } from './templates.ts';
import type { AttachmentPointer, CommunityAction, CommunityActionResult } from './community-actions.ts';
import type { DmAction, DmActionResult, DmEvent } from './dm.ts';
import type { SocialAction, SocialActionResult, SocialEvent } from './social.ts';
import type { Settings, SettingsPatch } from './settings.ts';

/** Every IPC channel River uses. Main validates every payload; nothing else is exposed. */
export const IPC = {
  appInfo: 'river:app:info',
  settingsGet: 'river:settings:get',
  settingsUpdate: 'river:settings:update',
  updatesStatus: 'river:updates:status',
  updatesCheck: 'river:updates:check',
  updatesInstall: 'river:updates:install',
  updatesOpenDownload: 'river:updates:open-download',
  updatesStatusChanged: 'river:updates:status-changed',
  securityStatus: 'river:security:status',
  serverCheck: 'river:server:check',
  storageStatus: 'river:storage:status',
  storageSetup: 'river:storage:setup-passphrase',
  storageUnlock: 'river:storage:unlock',
  storageStatusChanged: 'river:storage:status-changed',
  identityGet: 'river:identity:get',
  identityCreate: 'river:identity:create',
  identitySetName: 'river:identity:set-name',
  accountStatus: 'river:account:status',
  accountRegister: 'river:account:register',
  accountConnect: 'river:account:connect',
  accountStatusChanged: 'river:account:status-changed',
  communityList: 'river:community:list',
  communityCreate: 'river:community:create',
  communityJoin: 'river:community:join',
  communityInvite: 'river:community:invite',
  communityCreateChannel: 'river:community:create-channel',
  communityMessages: 'river:community:messages',
  communitySend: 'river:community:send',
  voiceJoin: 'river:voice:join',
  voiceLeave: 'river:voice:leave',
  voiceSignal: 'river:voice:signal',
  voiceIceServers: 'river:voice:ice-servers',
  screenSources: 'river:voice:screen-sources',
  screenSelect: 'river:voice:screen-select',
  communityEvent: 'river:community:event',
  dmAction: 'river:dm:action',
  socialAction: 'river:social:action',
  backupStatus: 'river:backup:status',
  backupPhrase: 'river:backup:phrase',
  backupCreate: 'river:backup:create',
  backupRestore: 'river:backup:restore',
  socialEvent: 'river:social:event',
  dmEvent: 'river:dm:event',
  communityAction: 'river:community:action',
  profileGet: 'river:profile:get',
  attachmentSave: 'river:attachment:save',
  openLink: 'river:link:open',
} as const;

/** Links the renderer may ask main to open. Arbitrary URLs are never accepted from the renderer. */
export const EXTERNAL_LINKS = {
  source: 'https://github.com/martex-dev/river',
  releases: 'https://github.com/martex-dev/river/releases',
  issues: 'https://github.com/martex-dev/river/issues',
  security: 'https://github.com/martex-dev/river/blob/main/SECURITY.md',
  privacy: 'https://github.com/martex-dev/river/blob/main/PRIVACY.md',
  threatModel: 'https://github.com/martex-dev/river/blob/main/THREAT_MODEL.md',
  license: 'https://github.com/martex-dev/river/blob/main/LICENSE',
} as const;
export type ExternalLinkId = keyof typeof EXTERNAL_LINKS;

export interface AppInfo {
  version: string;
  channel: ReleaseChannel;
  platform: string;
  arch: string;
  isPackaged: boolean;
  versions: { electron: string; chrome: string; node: string };
  /** Set when this version keeps failing to start after an update (automatic installs are paused). */
  startupProblem: string | null;
}

export type UpdateStatus =
  | { state: 'disabled'; reason: string }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; checkedAt: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'verifying'; version: string }
  | { state: 'ready'; version: string }
  | { state: 'manual'; version: string }
  | { state: 'error'; message: string; code?: string };

export type Indicator = 'active' | 'inactive' | 'planned' | 'warning';

export interface SecurityStatus {
  items: Array<{ id: string; label: string; indicator: Indicator; value: string; detail: string }>;
  releaseKeys: Array<{ keyId: string; comment?: string }>;
}

export type StorageStatus =
  | { state: 'opening' }
  /** No real OS keystore (e.g. Linux without a keyring): the user must choose a passphrase. */
  | { state: 'setup-required'; minLength: number }
  /** Passphrase-protected and waiting for the user. */
  | { state: 'locked' }
  | { state: 'open'; protection: 'os-keystore' | 'passphrase'; keystore: string; schema: number }
  | {
      state: 'error';
      code: 'keystore-unavailable' | 'newer-data' | 'migration-failed' | 'corrupt' | 'unknown';
      message: string;
    };

/** Everything the UI may know about the user's identity — public material only. */
export interface IdentityInfo {
  riverId: string;
  displayName: string | null;
  /** "AB73 29FA …" — SHA-256 of the identity public key, first 128 bits. */
  fingerprint: string;
  /** The same 16 bytes as Bytewords. */
  words: string[];
  createdAt: string;
}

export type AccountStatus =
  | { state: 'none' }
  | {
      state: 'registered';
      /** Host (and port) of the server, for display. */
      server: string;
      serverUrl: string;
      riverId: string;
      deviceId: number;
      devices: number;
      listVersion: number;
      connection: 'connecting' | 'online' | 'offline' | 'error';
      message?: string;
    };

export interface RoleView {
  id: string;
  /** "@everyone" for the base role. */
  name: string;
  color: number;
  permissions: number;
  position: number;
  everyone: boolean;
  /** Anyone may @mention this role (people with Mention everyone always can). */
  mentionable: boolean;
  /** Members with this role are listed in their own group. */
  hoist: boolean;
}

export interface ChannelView {
  id: string;
  kind: 'text' | 'voice';
  name: string;
  topic: string;
  position: number;
  overwrites: Array<{ roleId: string; allow: number; deny: number }>;
  /** My effective permissions in this channel. */
  permissions: number;
  /** @everyone cannot see it. */
  private: boolean;
  /** The category it sits in, or null. */
  parentId: string | null;
  /** Has messages newer than you last read here (kept across restarts). */
  unread: boolean;
  /** Where you stopped reading (this device), for the "New messages" divider. */
  lastReadAt: string | null;
  /** Uses its category's permissions. */
  synced: boolean;
}

export interface CategoryView {
  id: string;
  name: string;
  position: number;
  overwrites: Array<{ roleId: string; allow: number; deny: number }>;
}

/** One line of the audit log, already in words. */
export interface AuditView {
  id: string;
  actor: string;
  actorName: string;
  summary: string;
  at: string;
}

export interface MemberView {
  riverId: string;
  name: string;
  /** data: URL of a small image, or null. */
  avatar: string | null;
  roles: string[];
  /** Colour of the highest coloured role, or null. */
  color: number | null;
  online: boolean;
  owner: boolean;
  /** Hierarchy position (owner is highest). */
  rank: number;
  /** Timed out until then (cannot talk, react or join voice), or null. */
  timeoutUntil: string | null;
}

export interface VoiceStateView {
  muted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  streaming: boolean;
}

export interface CommunityView {
  id: string;
  name: string;
  description: string;
  /** An emoji, or null for the name's initials. */
  icon: string | null;
  ownerId: string;
  /** My community-wide permissions. */
  permissions: number;
  myRank: number;
  roles: RoleView[];
  categories: CategoryView[];
  channels: ChannelView[];
  members: MemberView[];
  /** voice channel ID → River IDs currently in it */
  voice: Record<string, string[]>;
  voiceStates: Record<string, VoiceStateView>;
}

export interface ReactionView {
  tag: string;
  emoji: string;
  count: number;
  mine: boolean;
  users: string[];
}

export interface ChatMessage {
  id: string;
  communityId: string;
  channelId: string;
  sender: string;
  senderName: string;
  text: string;
  sentAt: string;
  editedAt: string | null;
  pinned: boolean;
  reactions: ReactionView[];
  replyTo: string | null;
  attachments: AttachmentPointer[];
  mentionsMe: boolean;
  mine: boolean;
}

export type CommunityEvent =
  | { t: 'communities'; communities: CommunityView[] }
  | { t: 'message'; message: ChatMessage; isNew: boolean }
  | { t: 'messageDelete'; channelId: string; messageId: string }
  | {
      t: 'voice';
      communityId: string;
      channelId: string;
      participants: string[];
      states: Record<string, VoiceStateView>;
    }
  | { t: 'voiceDisconnect' }
  | { t: 'typing'; communityId: string; channelId: string; riverId: string }
  | { t: 'removed'; communityId: string; reason: 'kicked' | 'banned' | 'left' | 'deleted' }
  | { t: 'focusChannel'; communityId: string; channelId: string }
  | { t: 'signal'; from: string; channelId: string; data: unknown }
  /** `retryAt`: when the next reconnection attempt happens (epoch ms), while offline. */
  | { t: 'connection'; state: 'online' | 'offline' | 'connecting'; retryAt?: number }
  /** Unread counts found by catching up on channels (including while River was closed). */
  | { t: 'catchUp'; unread: Record<string, number>; mentions: Record<string, number> };

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
}

export type AccountActionResult = { ok: true; status: AccountStatus } | { ok: false; message: string };

export type PassphraseResult =
  { ok: true } | { ok: false; reason: 'wrong-passphrase' | 'too-short' | 'not-expected' };

export type ServerCheckResult =
  | { ok: true; url: string; version: string; protocol: number }
  | { ok: false; reason: 'invalid-url' | 'unreachable' | 'not-river' | 'incompatible'; message: string };

/** Shape of `window.river`, implemented by the preload script. */
export interface RiverApi {
  app: { info(): Promise<AppInfo> };
  settings: { get(): Promise<Settings>; update(patch: SettingsPatch): Promise<Settings> };
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    install(): Promise<void>;
    openDownloadPage(): Promise<void>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
  };
  security: { status(): Promise<SecurityStatus> };
  server: { check(url: string): Promise<ServerCheckResult> };
  identity: {
    get(): Promise<IdentityInfo | null>;
    create(displayName: string): Promise<IdentityInfo>;
    setDisplayName(displayName: string): Promise<IdentityInfo>;
  };
  account: {
    status(): Promise<AccountStatus>;
    /** Creates an account on the server set in Settings → Server. */
    register(): Promise<AccountActionResult>;
    connect(): Promise<AccountStatus>;
    onStatus(listener: (status: AccountStatus) => void): () => void;
  };
  backup: {
    status(): Promise<{ hasPhrase: boolean; lastBackupAt: string | null }>;
    /** The 18-word recovery phrase (created on first request). */
    phrase(): Promise<string[]>;
    /** Encrypts a backup and asks where to save it. */
    create(): Promise<Result<boolean>>;
    /** Fresh installs only: restores from a backup file and its recovery phrase. */
    restore(file: Uint8Array, phrase: string): Promise<Result<null>>;
  };
  social: {
    action<A extends SocialAction>(action: A): Promise<Result<SocialActionResult<A>>>;
    onEvent(listener: (event: SocialEvent) => void): () => void;
  };
  dm: {
    action<A extends DmAction>(action: A): Promise<Result<DmActionResult<A>>>;
    onEvent(listener: (event: DmEvent) => void): () => void;
  };
  community: {
    list(): Promise<Result<CommunityView[]>>;
    create(name: string, options?: CreateCommunityOptions): Promise<Result<CommunityView>>;
    join(inviteLink: string): Promise<Result<CommunityView>>;
    invite(communityId: string): Promise<Result<string>>;
    createChannel(communityId: string, kind: 'text' | 'voice', name: string): Promise<Result<null>>;
    messages(channelId: string): Promise<Result<ChatMessage[]>>;
    send(channelId: string, text: string): Promise<Result<ChatMessage>>;
    connection(): Promise<'online' | 'offline' | 'connecting'>;
    /** Every other community operation; validated in main against communityActionSchema. */
    action<A extends CommunityAction>(action: A): Promise<Result<CommunityActionResult<A>>>;
    profile(): Promise<{ name: string; avatar: string | null }>;
    /** Decrypts an attachment and asks where to save it. */
    saveAttachment(pointer: AttachmentPointer): Promise<Result<boolean>>;
    onEvent(listener: (event: CommunityEvent) => void): () => void;
  };
  voice: {
    join(channelId: string): Promise<Result<null>>;
    leave(): Promise<Result<null>>;
    signal(to: string, channelId: string, payload: unknown): Promise<Result<null>>;
    /** TURN relays offered by the server (may be empty). */
    iceServers(): Promise<Array<{ urls: string[]; username?: string; credential?: string }>>;
    screenSources(): Promise<ScreenSource[]>;
    selectScreen(sourceId: string): Promise<void>;
  };
  storage: {
    status(): Promise<StorageStatus>;
    setupPassphrase(passphrase: string): Promise<PassphraseResult>;
    unlock(passphrase: string): Promise<PassphraseResult>;
    onStatus(listener: (status: StorageStatus) => void): () => void;
  };
  links: { open(id: ExternalLinkId): Promise<void> };
}
