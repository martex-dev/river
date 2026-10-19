import { DEFAULT_KEYBINDS } from './keybinds.ts';
import { z } from 'zod';
import { RELEASE_CHANNELS } from '@river/release/channels';
import { DEFAULT_DESIGN, compactDesignImages, designSettingsSchema } from './design.ts';
import { NOTIFY_SOUNDS } from './notify-sounds.ts';
import { LANGUAGE_IDS } from './i18n/languages.ts';
import { msg } from './i18n/index.ts';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A River server base URL. HTTPS is required except for a server on this
 * computer (local development / self-hosting tests). Credentials, query strings
 * and fragments are refused; the result is normalised without a trailing slash.
 */
export const serverUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: msg('Enter a full address, like https://river.example.org') });
      return z.NEVER;
    }
    const local = LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      ctx.addIssue({ code: 'custom', message: msg('The server address must start with https://') });
      return z.NEVER;
    }
    if (url.username || url.password || url.search || url.hash) {
      ctx.addIssue({
        code: 'custom',
        message: msg('The address must not contain a password, query or #fragment'),
      });
      return z.NEVER;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  });

/**
 * A proxy's host: a name or IPv4 address, or an IPv6 address in brackets. No scheme, port,
 * credentials or path (those would be parsed differently by Chromium and by River's own code).
 */
export const proxyHostSchema = z
  .string()
  .trim()
  .max(253)
  .regex(
    /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]{2,45}\])$/,
    {
      message: msg('Enter a host name or address, like 127.0.0.1'),
    },
  );

/** Settings → Privacy → Proxy (2.13): where River's connections go first. */
export const proxySettingsSchema = z
  .object({
    /** off: connect directly. socks5: e.g. Tor (127.0.0.1:9050) or Tor Browser (9150). http: HTTP CONNECT. */
    mode: z.enum(['off', 'socks5', 'http']),
    host: proxyHostSchema,
    port: z.number().int().min(1).max(65_535),
  })
  .strict();
export type ProxySettings = z.infer<typeof proxySettingsSchema>;

/** The longest disappearing-messages timer: MAX_TIMER in dm.ts (not imported: dm.ts → settings.ts). */
const MAX_NEW_CHAT_TIMER = 28 * 86_400;

/** Keep direct messages and groups on this device only this many days (0 = keep them). */
export const HISTORY_DAY_CHOICES = [0, 1, 7, 30, 90, 365] as const;

const keyCombo = z
  .string()
  .max(64)
  .regex(/^(?:(?:Ctrl|Alt|Shift)\+){0,3}[A-Za-z0-9]{1,24}$|^$/);

export const settingsSchema = z.object({
  schemaVersion: z.literal(1),
  updates: z.object({
    channel: z.enum(RELEASE_CHANNELS),
    autoCheck: z.boolean(),
    autoDownload: z.boolean(),
    installOnQuit: z.boolean(),
  }),
  appearance: z.object({
    /** 'system' follows the OS reduced-motion preference. */
    motion: z.enum(['system', 'reduced', 'full']),
    /** Added in 1.0.9: how tightly messages are packed. */
    density: z.enum(['cozy', 'compact']),
    /** Added in 1.0.18: the whole interface's size (Ctrl+= / Ctrl+− / Ctrl+0). */
    zoom: z.number().min(0.7).max(1.6),
    /** Message text size in pixels. */
    fontSize: z.number().int().min(12).max(22),
    /** 'system' follows the locale. */
    clock: z.enum(['system', '12h', '24h']),
    /** Stronger text and borders; 'system' follows the OS high-contrast preference. */
    contrast: z.enum(['system', 'normal', 'high']),
    /** Added in 1.0.27: interface language ('system', the default, follows the computer or phone). */
    language: z.enum(['system', ...LANGUAGE_IDS]),
    /** Added in 1.0.23: add previews to links you send (River fetches the page from your computer). */
    linkPreviews: z.boolean(),
    /**
     * Added in 2.18: Calm mode — no confetti, bursts or bouncing; messages simply appear.
     * Reduced motion (system or River's) goes further and stops every non-essential animation.
     */
    calm: z.boolean(),
  }),
  /** Added in 1.0.45: skins, themes, personalisation and appearance profiles. */
  design: designSettingsSchema,
  notifications: z.object({
    /** Default 'none': notifications say "New River message" with no sender or content. */
    preview: z.enum(['none', 'sender', 'full']),
    /** Added in 0.3: desktop notifications on/off, for every message or only mentions. */
    desktop: z.boolean(),
    mode: z.enum(['all', 'mentions']),
    sounds: z.boolean(),
    /** Added in 1.0.1: 0–1, and which groups of sounds play. */
    soundVolume: z.number().min(0).max(1),
    soundGroups: z
      .object({
        messages: z.boolean(),
        voice: z.boolean(),
        calls: z.boolean(),
        social: z.boolean(),
        interface: z.boolean(),
      })
      .strict(),
    /** Added in 1.0.18: per-community and per-channel levels and mutes (see notify-rules.ts). */
    overrides: z.record(
      z.string().max(64),
      z
        .object({
          level: z.enum(['default', 'all', 'mentions', 'nothing']),
          muteUntil: z.string().max(40).nullable(),
          /** Added in 2.17: this chat's, channel's or community's notification sound (notify-sounds.ts). */
          sound: z.enum(NOTIFY_SOUNDS).optional(),
          /** Added in 2.17 (communities): @everyone and @here do not count as mentioning you. */
          suppressEveryone: z.boolean().optional(),
        })
        .strict(),
    ),
    /** Added in 1.0.23: tell me when someone reacts to my message (sound and a small notice). */
    reactions: z.boolean(),
    /** Added in 2.17: the unread count on River's taskbar or dock icon (and the iPhone's app icon). */
    badge: z.boolean(),
    /** Added in 2.17: a small banner inside River for messages in other chats while it is open. */
    banners: z.boolean(),
    /**
     * Added in 2.19: archived chats count towards the Chats and Home badges (and River's icon).
     * Off by default, as in Telegram; message requests never count.
     */
    countArchived: z.boolean(),
    /** Added in 1.0.20: no notifications or sounds between these local times (like Do Not Disturb). */
    quietHours: z
      .object({
        enabled: z.boolean(),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict(),
  }),
  /** Added in 0.0.2. */
  server: z.object({
    url: serverUrlSchema.nullable(),
    /** Create an account on River's server by itself (off after you delete your account, 1.0.18). */
    autoAccount: z.boolean(),
  }),
  /** Added in 0.3. */
  voice: z.object({
    inputDeviceId: z.string().max(256).nullable(),
    outputDeviceId: z.string().max(256).nullable(),
    inputMode: z.enum(['voice', 'push-to-talk']),
    /** KeyboardEvent.code of the push-to-talk key (works while River is focused). */
    pushToTalkKey: z.string().max(32),
    noiseSuppression: z.boolean(),
    echoCancellation: z.boolean(),
    /** Per-member playback volume, 0–2 (1 = 100%). */
    userVolumes: z.record(z.string().max(64), z.number().min(0).max(2)),
    /** Added in 1.0.20: voice activity sensitivity, 0–1 on the mic meter's scale; null = automatic. */
    sensitivity: z.number().min(0).max(1).nullable(),
    /** Added in 1.0.22: how loud other people's soundboard sounds play, 0–1 (0 = off). */
    soundboardVolume: z.number().min(0).max(1),
    /** Added in 2.0.4: everyone's voice, 0–2 (1 = 100%); null = automatic (louder on phones). */
    outputVolume: z.number().min(0).max(2).nullable(),
    /** Added in 1.0.26: leave a voice channel after this many minutes alone (0 = never). */
    leaveAloneMinutes: z.number().int().min(0).max(240),
    /** Added in 1.0.26: a soundboard sound played when you join voice, per community. */
    entranceSounds: z.record(z.string().max(64), z.string().max(64)),
    /** Added in 1.0.22: shortcuts for voice actions ("" = none); see keybinds.ts. */
    keybinds: z
      .object({
        toggleMute: keyCombo,
        toggleDeafen: keyCombo,
        toggleCamera: keyCombo,
        leaveVoice: keyCombo,
      })
      .strict(),
  }),
  /** Added in 1.0.7. */
  system: z.object({
    /** Open River (in the tray) when you sign in to your computer. */
    startAtLogin: z.boolean(),
    /** Closing the window keeps River running in the tray, so calls and messages keep arriving. */
    closeToTray: z.boolean(),
    /** Added in 1.2.0 (phones): ask for the fingerprint, face or screen lock when River opens. */
    appLock: z.boolean(),
    /** Added in 1.4.0 (Android): keep the connection while River is closed (a visible service). */
    background: z.boolean(),
    /** Added in 2.6.0: block screenshots and screen recording of River (Android, Windows, macOS). */
    screenSecurity: z.boolean(),
    /** Added in 2.11.0 (Android): the one-time "Get messages and calls when River is closed?" was answered. */
    backgroundAsked: z.boolean(),
    /** Added in 2.11.0 (Android): a new message lights up the screen for a few seconds when it is off. */
    wakeScreen: z.boolean(),
  }),
  /** Added in 1.0.11: communities hosted by this PC, from inside River. */
  hosting: z.object({
    /** Run the community server and its public address whenever River runs. */
    enabled: z.boolean(),
    /** Keep the PC from going to sleep while it hosts, so members can reach it. */
    keepAwake: z.boolean(),
  }),
  /** Added in 1.0.18: your order of communities and folders (see rail.ts). */
  rail: z.object({
    order: z.array(z.string().max(80)).max(1000),
    folders: z
      .array(
        z
          .object({
            id: z.string().max(40),
            name: z.string().max(40),
            color: z.number().int().min(0).max(0xffffff),
            items: z.array(z.string().max(64)).max(500),
            open: z.boolean(),
          })
          .strict(),
      )
      .max(200),
  }),
  /** Added in 1.0.17: how you appear to others. */
  presence: z.object({
    /** Online, Idle, Do Not Disturb (no notifications or sounds) or Invisible (appear offline). */
    status: z.enum(['online', 'idle', 'dnd', 'invisible']),
    /** Shown as Idle after 10 minutes away from the computer (while Online). */
    autoIdle: z.boolean(),
    /** Custom status, end-to-end encrypted inside your community profile. */
    customText: z.string().max(128),
    customEmoji: z.string().max(16),
    /** When the custom status clears itself (ISO time), or null for never. */
    customUntil: z.string().max(40).nullable(),
    /** Added in 2.6.0: send read receipts (off: you also do not see other people's). */
    readReceipts: z.boolean(),
    /** Added in 2.6.0: show "typing…" (off: you also do not see other people typing). */
    typingIndicators: z.boolean(),
  }),
  /** Added in 2.13: connections, and what this device keeps. */
  privacy: z.object({
    proxy: proxySettingsSchema,
    /** Delete this device's direct messages and group messages older than this many days (0 = never). */
    historyDays: z.number().int().min(0).max(3650),
    /** Disappearing-messages timer for chats you start from now on (seconds, 0 = off). */
    newChatTimer: z.number().int().min(0).max(MAX_NEW_CHAT_TIMER),
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  updates: { channel: 'stable', autoCheck: true, autoDownload: true, installOnQuit: true },
  appearance: {
    motion: 'system',
    density: 'cozy',
    zoom: 1,
    fontSize: 14,
    clock: 'system',
    contrast: 'system',
    linkPreviews: false,
    language: 'system',
    calm: false,
  },
  design: structuredClone(DEFAULT_DESIGN),
  notifications: {
    preview: 'none',
    desktop: true,
    mode: 'all',
    sounds: true,
    soundVolume: 0.8,
    soundGroups: { messages: true, voice: true, calls: true, social: true, interface: true },
    overrides: {},
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
    reactions: false,
    badge: true,
    banners: true,
    countArchived: false,
  },
  server: { url: null, autoAccount: true },
  voice: {
    inputDeviceId: null,
    outputDeviceId: null,
    inputMode: 'voice',
    pushToTalkKey: 'Backquote',
    noiseSuppression: true,
    echoCancellation: true,
    userVolumes: {},
    sensitivity: null,
    soundboardVolume: 0.6,
    outputVolume: null,
    keybinds: { ...DEFAULT_KEYBINDS },
    leaveAloneMinutes: 0,
    entranceSounds: {},
  },
  system: {
    startAtLogin: false,
    closeToTray: true,
    appLock: false,
    background: false,
    screenSecurity: false,
    backgroundAsked: false,
    wakeScreen: true,
  },
  hosting: { enabled: false, keepAwake: true },
  rail: { order: [], folders: [] },
  presence: {
    status: 'online',
    autoIdle: true,
    customText: '',
    customEmoji: '',
    customUntil: null,
    readReceipts: true,
    typingIndicators: true,
  },
  privacy: {
    proxy: { mode: 'off', host: '127.0.0.1', port: 9050 },
    historyDays: 0,
    newChatTimer: 0,
  },
};

export const SETTINGS_SECTIONS = [
  'updates',
  'appearance',
  'design',
  'notifications',
  'server',
  'voice',
  'system',
  'hosting',
  'rail',
  'presence',
  'privacy',
] as const;

/**
 * Brings a settings object written by an older River up to the current shape:
 * sections and keys that did not exist yet get their defaults. Existing values
 * are kept untouched (they are still validated afterwards).
 */
export function upgradeSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const section of SETTINGS_SECTIONS) {
    const current = out[section];
    const defaults = structuredClone(DEFAULT_SETTINGS[section]);
    if (current === undefined) out[section] = defaults;
    else if (current && typeof current === 'object' && !Array.isArray(current)) {
      out[section] = { ...defaults, ...(current as Record<string, unknown>) };
    }
  }
  return out;
}

/**
 * Removes keys a schema does not know, at every depth, leaving everything else for the schema to
 * check. A settings file may hold keys this River does not know (written by a newer version, or
 * one that dropped a setting); with nested .strict() objects one such key used to throw away its
 * whole section on load. Patches from the renderer stay strict (settingsPatchSchema).
 */
export function pruneUnknownKeys(schema: z.ZodType, value: unknown): unknown {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> & { type: string } } })._zod.def;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
      return pruneUnknownKeys(def.innerType as z.ZodType, value);
    case 'pipe':
      return pruneUnknownKeys(def.in as z.ZodType, value);
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const shape = def.shape as Record<string, z.ZodType>;
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (Object.hasOwn(shape, key)) out[key] = pruneUnknownKeys(shape[key]!, inner);
      }
      return out;
    }
    case 'array':
      return Array.isArray(value) ? value.map((v) => pruneUnknownKeys(def.element as z.ZodType, v)) : value;
    case 'record': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>))
        out[key] = pruneUnknownKeys(def.valueType as z.ZodType, inner);
      return out;
    }
    default:
      return value;
  }
}

/** A partial update: each section may be omitted or partially specified. Unknown keys are rejected. */
export const settingsPatchSchema = z
  .object({
    updates: settingsSchema.shape.updates.partial().strict().optional(),
    appearance: settingsSchema.shape.appearance.partial().strict().optional(),
    design: settingsSchema.shape.design.partial().strict().optional(),
    notifications: settingsSchema.shape.notifications.partial().strict().optional(),
    server: settingsSchema.shape.server.partial().strict().optional(),
    voice: settingsSchema.shape.voice.partial().strict().optional(),
    system: settingsSchema.shape.system.partial().strict().optional(),
    hosting: settingsSchema.shape.hosting.partial().strict().optional(),
    presence: settingsSchema.shape.presence.partial().strict().optional(),
    rail: settingsSchema.shape.rail.partial().strict().optional(),
    privacy: settingsSchema.shape.privacy.partial().strict().optional(),
  })
  .strict();

export type SettingsPatch = z.input<typeof settingsPatchSchema>;

/** Settings in their stored form: each background picture kept once (see compactDesignImages). */
export function normalizeSettings(settings: Settings): Settings {
  return { ...settings, design: compactDesignImages(settings.design) };
}

export function applySettingsPatch(current: Settings, patch: z.output<typeof settingsPatchSchema>): Settings {
  return normalizeSettings(applyPatch(current, patch));
}

function applyPatch(current: Settings, patch: z.output<typeof settingsPatchSchema>): Settings {
  return settingsSchema.parse({
    ...current,
    updates: { ...current.updates, ...patch.updates },
    appearance: { ...current.appearance, ...patch.appearance },
    design: { ...current.design, ...patch.design },
    notifications: { ...current.notifications, ...patch.notifications },
    server: { ...current.server, ...patch.server },
    voice: { ...current.voice, ...patch.voice },
    system: { ...current.system, ...patch.system },
    hosting: { ...current.hosting, ...patch.hosting },
    presence: { ...current.presence, ...patch.presence },
    rail: { ...current.rail, ...patch.rail },
    privacy: { ...current.privacy, ...patch.privacy },
  });
}
