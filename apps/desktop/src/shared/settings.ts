import { z } from 'zod';
import { RELEASE_CHANNELS } from '@river/release/channels';

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
      ctx.addIssue({ code: 'custom', message: 'Enter a full address, like https://river.example.org' });
      return z.NEVER;
    }
    const local = LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      ctx.addIssue({ code: 'custom', message: 'The server address must start with https://' });
      return z.NEVER;
    }
    if (url.username || url.password || url.search || url.hash) {
      ctx.addIssue({
        code: 'custom',
        message: 'The address must not contain a password, query or #fragment',
      });
      return z.NEVER;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  });

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
  }),
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
        })
        .strict(),
    ),
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
  }),
  /** Added in 1.0.7. */
  system: z.object({
    /** Open River (in the tray) when you sign in to your computer. */
    startAtLogin: z.boolean(),
    /** Closing the window keeps River running in the tray, so calls and messages keep arriving. */
    closeToTray: z.boolean(),
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
  },
  notifications: {
    preview: 'none',
    desktop: true,
    mode: 'all',
    sounds: true,
    soundVolume: 0.8,
    soundGroups: { messages: true, voice: true, calls: true, social: true, interface: true },
    overrides: {},
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
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
  },
  system: { startAtLogin: false, closeToTray: true },
  hosting: { enabled: false, keepAwake: true },
  rail: { order: [], folders: [] },
  presence: { status: 'online', autoIdle: true, customText: '', customEmoji: '', customUntil: null },
};

export const SETTINGS_SECTIONS = [
  'updates',
  'appearance',
  'notifications',
  'server',
  'voice',
  'system',
  'hosting',
  'rail',
  'presence',
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

/** A partial update: each section may be omitted or partially specified. Unknown keys are rejected. */
export const settingsPatchSchema = z
  .object({
    updates: settingsSchema.shape.updates.partial().strict().optional(),
    appearance: settingsSchema.shape.appearance.partial().strict().optional(),
    notifications: settingsSchema.shape.notifications.partial().strict().optional(),
    server: settingsSchema.shape.server.partial().strict().optional(),
    voice: settingsSchema.shape.voice.partial().strict().optional(),
    system: settingsSchema.shape.system.partial().strict().optional(),
    hosting: settingsSchema.shape.hosting.partial().strict().optional(),
    presence: settingsSchema.shape.presence.partial().strict().optional(),
    rail: settingsSchema.shape.rail.partial().strict().optional(),
  })
  .strict();

export type SettingsPatch = z.input<typeof settingsPatchSchema>;

export function applySettingsPatch(current: Settings, patch: z.output<typeof settingsPatchSchema>): Settings {
  return settingsSchema.parse({
    ...current,
    updates: { ...current.updates, ...patch.updates },
    appearance: { ...current.appearance, ...patch.appearance },
    notifications: { ...current.notifications, ...patch.notifications },
    server: { ...current.server, ...patch.server },
    voice: { ...current.voice, ...patch.voice },
    system: { ...current.system, ...patch.system },
    hosting: { ...current.hosting, ...patch.hosting },
    presence: { ...current.presence, ...patch.presence },
    rail: { ...current.rail, ...patch.rail },
  });
}
