import type { WordFilter } from './word-filter.ts';
import type { Poll } from './poll.ts';
import type { AdminOverview } from '@river/protocol/admin';
import type { ReleaseChannel } from '@river/release/channels';
import type { CreateCommunityOptions } from './templates.ts';
import type { AttachmentPointer, CommunityAction, CommunityActionResult } from './community-actions.ts';
import type { DmAction, DmActionResult, DmEvent } from './dm.ts';
import type { SocialAction, SocialActionResult, SocialEvent } from './social.ts';
import type { Settings, SettingsPatch } from './settings.ts';

/** Every IPC channel River uses. Main validates every payload; nothing else is exposed. */
export const IPC = {
  appInfo: 'river:app:info',
  appTakeDeepLink: 'river:app:take-deep-link',
  appDeepLink: 'river:app:deep-link',
  /** Something shared to River from another app (phones). */
  appShare: 'river:app:share',
  settingsGet: 'river:settings:get',
  settingsUpdate: 'river:settings:update',
  updatesStatus: 'river:updates:status',
  updatesCheck: 'river:updates:check',
  updatesInstall: 'river:updates:install',
  updatesOpenDownload: 'river:updates:open-download',
  updatesStatusChanged: 'river:updates:status-changed',
  securityStatus: 'river:security:status',
  hostStatus: 'river:host:status',
  hostEnable: 'river:host:enable',
  hostDisable: 'river:host:disable',
  hostBackup: 'river:host:backup',
  hostOpenFolder: 'river:host:open-folder',
  hostApproveAddress: 'river:host:approve-address',
  hostCheckAddress: 'river:host:check-address',
  hostStatusChanged: 'river:host:status-changed',
  adminOverview: 'river:admin:overview',
  adminSuspend: 'river:admin:suspend',
  adminUnsuspend: 'river:admin:unsuspend',
  adminDeleteAccount: 'river:admin:delete-account',
  adminDeleteCommunity: 'river:admin:delete-community',
  adminCreateSignup: 'river:admin:create-signup',
  adminDeleteSignup: 'river:admin:delete-signup',
  adminSignupMode: 'river:admin:signup-mode',
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
  accountSetUsername: 'river:account:set-username',
  accountDelete: 'river:account:delete',
  accountExport: 'river:account:export',
  accountRedeemSignup: 'river:account:redeem-signup',
  accountStartOver: 'river:account:start-over',
  usersLookup: 'river:users:lookup',
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
  voiceRelay: 'river:voice:relay',
  voiceCallRoom: 'river:voice:call-room',
  voiceRelayIn: 'river:voice:relay-in',
  diagnosticsRun: 'river:diagnostics:run',
  diagnosticsOpenLogs: 'river:diagnostics:open-logs',
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
  openUrl: 'river:link:open-url',
  appTitleBar: 'river:app:title-bar',
  linkPreview: 'river:link:preview',
} as const;

/**
 * Links the renderer may ask main to open directly. Links in messages go
 * through `links.openUrl`, which main opens only after the person confirms the
 * exact address in a native dialog the renderer cannot draw or skip.
 */
export const EXTERNAL_LINKS = {
  source: 'https://github.com/martex-dev/river',
  releases: 'https://github.com/martex-dev/river/releases',
  issues: 'https://github.com/martex-dev/river/issues',
  security: 'https://github.com/martex-dev/river/blob/main/SECURITY.md',
  privacy: 'https://github.com/martex-dev/river/blob/main/PRIVACY.md',
  threatModel: 'https://github.com/martex-dev/river/blob/main/THREAT_MODEL.md',
  license: 'https://github.com/martex-dev/river/blob/main/LICENSE',
  tailscale: 'https://tailscale.com/download',
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
  | {
      state: 'none';
      /** River is creating your account on River's server but cannot reach it yet; it keeps trying. */
      waiting?: boolean;
    }
  | {
      state: 'registered';
      /** Host (and port) of the server, for display. */
      server: string;
      serverUrl: string;
      /**
       * The address to put in links you share (invites, friend links). Usually serverUrl; on
       * the PC that hosts the server, where River talks to it over 127.0.0.1, its public address.
       */
      shareUrl: string;
      riverId: string;
      deviceId: number;
      devices: number;
      listVersion: number;
      connection: 'connecting' | 'online' | 'offline' | 'error';
      /**
       * The server answers but does not know this account any more (removed by its owner, or
       * the device was replaced): signing in cannot work until the account is set up again.
       */
      missing?: boolean;
      /** What people find you by (1.0.13); null until you choose one. */
      username: string | null;
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
  /** An emoji shown next to members' names (1.0.21), or null. */
  icon: string | null;
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
  /** Only people who may manage messages post here. */
  announcement: boolean;
  /** Seconds between your messages (0 = off). */
  slowmode: number;
  /** Most people in this voice channel at once (0 = no limit). */
  userLimit: number;
  /** Voice: members allowed to use Priority speaker here (1.0.33). */
  prioritySpeakers?: string[];
  /** A forum: every message starts a titled post (1.0.22). */
  forum: boolean;
  /** Tags posts in this forum can have (encrypted with the channel name). */
  tags: string[];
  /** A stage: invited speakers talk, everyone else listens (1.0.22). */
  stage: boolean;
  /** A media channel: shown as a gallery of pictures and videos (1.0.26). */
  media?: boolean;
  /** Age-restricted: people confirm they are 18 or older before opening it (1.0.27). */
  nsfw?: boolean;
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
  /** The raw action, e.g. "member.ban" (1.0.24), for filtering. */
  action?: string;
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
  /** Icon of the highest role that has one (1.0.21), or null. */
  roleIcon?: string | null;
  online: boolean;
  /** Idle or Do Not Disturb while online (1.0.17). */
  status?: 'idle' | 'dnd';
  /** Their custom status, if set and not expired (end-to-end encrypted). */
  customStatus?: { text: string; emoji: string } | null;
  /** About me, pronouns and banner colour (1.0.18). */
  bio?: string;
  pronouns?: string;
  banner?: number | null;
  owner: boolean;
  /** Hierarchy position (owner is highest). */
  rank: number;
  /** Timed out until then (cannot talk, react or join voice), or null. */
  timeoutUntil: string | null;
  /** The day they joined this community, YYYY-MM-DD (1.0.21). */
  joinedOn?: string;
  /** When temporary roles end, by role ID (1.0.30). */
  roleExpiry?: Record<string, string>;
}

/** One line of Settings → System → Connection check. Never contains content, keys or tokens. */
export interface DiagnosticCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  /** What the person can do about it, in plain words. */
  advice?: string;
}

export interface VoiceStateView {
  muted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  serverDeafened?: boolean;
  /** On a stage: asking to speak (1.0.22). */
  handRaised?: boolean;
  streaming: boolean;
  /** Their connection dropped; River is holding their seat while they reconnect. */
  reconnecting?: boolean;
}

export interface CommunityView {
  id: string;
  name: string;
  description: string;
  /** An emoji, or null for the name's initials. */
  icon: string | null;
  /** Your nickname here, or null if you use your River name. */
  myNickname: string | null;
  /** Your picture here, or null if you use your usual avatar (1.0.25). */
  myCommunityAvatar?: string | null;
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
  /** Onboarding (1.0.24): the rules, a welcome note, whether newcomers must accept, roles to pick. */
  rules: string[];
  welcomeNote: string;
  screening: boolean;
  selfRoles: string[];
  /** You have not accepted the rules yet, so you can only read. */
  myPending: boolean;
  /** The community's word filter (1.0.28), or null. */
  filter?: WordFilter | null;
  /** A picture (shown instead of the emoji icon) and a banner (1.0.29), as image data URLs. */
  art?: { icon: string | null; banner: string | null };
  /** Incoming webhooks of channels you can see (1.0.32). */
  webhooks?: WebhookView[];
}

export interface WebhookView {
  id: string;
  channelId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  revoked: boolean;
}

export interface ReactionView {
  tag: string;
  emoji: string;
  count: number;
  mine: boolean;
  users: string[];
}

/** A link preview made by the sender's app (1.0.23); readers never fetch anything. */
export interface LinkEmbed {
  url: string;
  title: string;
  description: string;
  site: string;
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
  /** Descriptions of attached pictures, by attachment ID (1.0.21). */
  alts?: Record<string, string>;
  mentionsMe: boolean;
  mine: boolean;
  /** Set on replies inside a thread: the thread's starting message. */
  threadId: string | null;
  /** The thread started from this message, if any. */
  thread: ThreadView | null;
  /** A poll, if this message is one (1.0.18). Votes are in `reactions` (see shared/poll.ts). */
  poll?: Poll | null;
  /** Forum post tags (1.0.22). */
  tags?: string[];
  /** A link preview the sender added (1.0.23). */
  embed?: LinkEmbed | null;
  /** A community sticker (1.0.24): its ID, shown from the community's stickers. */
  sticker?: string | null;
  /** Posted by an incoming webhook (1.0.32); `senderName` is the webhook's name. */
  webhook?: string;
}

export interface ThreadView {
  name: string;
  count: number;
  lastAt: string | null;
  archived: boolean;
  creator: string;
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
  | { t: 'voiceDisconnect'; moveTo?: string }
  /** Hang up the current call or voice channel (from the phone's "In a call" notification). */
  | { t: 'hangUp' }
  /** A community's events changed (fetch them again), or one you are interested in starts now. */
  | { t: 'events'; communityId: string }
  | { t: 'emojis'; communityId: string }
  | { t: 'reports'; communityId: string }
  | { t: 'sounds'; communityId: string }
  | { t: 'stickers'; communityId: string }
  | { t: 'voiceSound'; communityId: string; from: string; soundId: string }
  /** The server said no to something that is not a voice join (1.0.22). */
  | { t: 'refused'; reason: 'forbidden' | 'slow_down' }
  | { t: 'eventStarting'; communityId: string; eventId: string; name: string; channelId: string | null }
  /** Your server moved to a new address and River followed it. */
  | { t: 'serverMoved'; url: string }
  /** The server would not let you into a voice channel. */
  | { t: 'voiceRefused'; reason: 'full' | 'forbidden' }
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
  app: {
    info(): Promise<AppInfo>;
    /** A River link opened from a browser ("Open in River") before the window could take it. */
    takeDeepLink(): Promise<DeepLink | null>;
    onDeepLink(listener: (link: DeepLink) => void): () => void;
    /** Text and files shared to River from another app (phones; "Share → River"). */
    onShare(listener: (content: SharedContent) => void): () => void;
    /** Colours of the window buttons area (Windows/Linux), following the theme. */
    setTitleBar(colors: { color: string; symbol: string }): Promise<void>;
  };
  settings: { get(): Promise<Settings>; update(patch: SettingsPatch): Promise<Settings> };
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    install(): Promise<void>;
    openDownloadPage(): Promise<void>;
    onStatus(listener: (status: UpdateStatus) => void): () => void;
  };
  security: { status(): Promise<SecurityStatus> };
  /** River Host on this PC, if it runs here. */
  host: {
    status(): Promise<HostStatus>;
    /** Host communities on this PC from now on (also starts River with the PC). */
    enable(): Promise<Result<HostStatus>>;
    disable(): Promise<Result<HostStatus>>;
    backupNow(): Promise<Result<HostStatus>>;
    /** Opens the folder with the hosted data, backups and logs. */
    openFolder(): Promise<void>;
    /** Opens Tailscale's page to allow River's permanent address. */
    approveAddress(): Promise<boolean>;
    /** Looks for Tailscale again (just installed or signed in). */
    checkAddress(): Promise<HostStatus>;
    onStatus(listener: (status: HostStatus) => void): () => void;
  };
  /** Server operator tools; only work on the PC that hosts the server. */
  admin: {
    overview(): Promise<Result<AdminOverview>>;
    /** `until` null bans until lifted; an ISO time is a timeout. */
    suspend(riverId: string, until: string | null, reason?: string): Promise<Result<null>>;
    unsuspend(riverId: string): Promise<Result<null>>;
    deleteAccount(riverId: string): Promise<Result<null>>;
    deleteCommunity(communityId: string): Promise<Result<null>>;
    /** Create an account ahead of time; returns a sign-up link to send the person. */
    createSignup(username: string): Promise<Result<{ username: string; link: string; expiresAt: string }>>;
    deleteSignup(username: string): Promise<Result<null>>;
    setSignupMode(mode: 'open' | 'invite'): Promise<Result<null>>;
  };
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
    /** Choose or change your @username. */
    setUsername(username: string): Promise<Result<AccountStatus>>;
    /** Use an operator's sign-up link (`…/add#s=…`) to create this account. */
    redeemSignup(link: string): Promise<Result<AccountStatus>>;
    /** The server no longer knows this account: forget it here and create a new one. */
    startOver(): Promise<Result<AccountStatus>>;
    /** Delete your account from its server for good (1.0.18). */
    deleteAccount(): Promise<Result<null>>;
    /** Save a readable copy of your data (1.0.23); false when the save dialog was cancelled. */
    exportData(): Promise<Result<boolean>>;
    onStatus(listener: (status: AccountStatus) => void): () => void;
  };
  /** Find people by @username to add them. */
  users: {
    lookup(username: string): Promise<Result<{ username: string; riverId: string }>>;
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
    profile(): Promise<{
      name: string;
      avatar: string | null;
      bio: string;
      pronouns: string;
      banner: number | null;
    }>;
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
    /** Sends an encrypted voice frame through the server to people we cannot reach directly. */
    relay(to: string[], payload: Uint8Array): void;
    /** Joins (null: leaves) a 1:1 call's private relay room. */
    callRoom(room: string | null): Promise<void>;
    onRelay(listener: (from: string, payload: Uint8Array) => void): () => void;
  };
  storage: {
    status(): Promise<StorageStatus>;
    setupPassphrase(passphrase: string): Promise<PassphraseResult>;
    unlock(passphrase: string): Promise<PassphraseResult>;
    onStatus(listener: (status: StorageStatus) => void): () => void;
  };
  links: {
    open(id: ExternalLinkId): Promise<void>;
    /** A link from a message: main shows the real address and asks before opening it. */
    openUrl(url: string): Promise<boolean>;
    /** A preview for a link you are about to send, if you turned link previews on (1.0.23). */
    preview(url: string): Promise<LinkEmbed | null>;
  };
  diagnostics: {
    /** Server, relay and connection checks (the renderer adds network and microphone checks). */
    run(): Promise<DiagnosticCheck[]>;
    openLogs(): Promise<void>;
  };
}

/** What hosting on this PC is doing right now (see main/host/host-manager.ts). */
export interface HostRuntime {
  state: 'off' | 'preparing' | 'starting' | 'online' | 'reconnecting';
  /** The public address members reach, while it is reachable. */
  address: string | null;
  /** Members' apps follow the server to a new address by themselves. */
  followable: boolean;
  /** ISO time of the newest database backup. */
  lastBackupAt: string | null;
  instanceId?: string;
  /** 0–1 while the tunnel tool downloads (first time only). */
  progress?: number;
  message?: string;
  /** How members reach the server: a permanent Tailscale address, or a quick tunnel that changes. */
  via?: 'tailscale' | 'quick-tunnel';
  /** What Tailscale on this PC can do, for the "permanent address" steps (1.0.43). */
  permanent?: 'missing' | 'signed-out' | 'ready';
  /** Tailscale is waiting for its owner to allow the permanent address. */
  needsApproval?: boolean;
}

/** Hosting communities on this PC, as Settings and the start screen show it. */
export interface HostStatus extends HostRuntime {
  /** The user turned hosting on; River starts it with the PC. */
  enabled: boolean;
  /** Your own account is on this server. */
  yours: boolean;
  /** River Host, the separate host from 1.0.8, is set up ('installed') or running on this PC. */
  legacy: 'none' | 'installed' | 'running';
}

/** What another app shared to River. Nothing is sent until the person picks where and sends. */
export interface SharedContent {
  text: string;
  files: Array<{ name: string; type: string; data: Uint8Array }>;
}

/** A River link the operating system handed to River (river://open?link=…). */
export interface DeepLink {
  kind: 'invite' | 'friend' | 'signup';
  /** The https invite, friend or sign-up link itself. */
  link: string;
}
