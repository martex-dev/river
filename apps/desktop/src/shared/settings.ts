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
  }),
  notifications: z.object({
    /** Default 'none': notifications say "New River message" with no sender or content. */
    preview: z.enum(['none', 'sender', 'full']),
    /** Added in 0.3: desktop notifications on/off, for every message or only mentions. */
    desktop: z.boolean(),
    mode: z.enum(['all', 'mentions']),
    sounds: z.boolean(),
  }),
  /** Added in 0.0.2. */
  server: z.object({
    url: serverUrlSchema.nullable(),
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
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  updates: { channel: 'stable', autoCheck: true, autoDownload: true, installOnQuit: true },
  appearance: { motion: 'system' },
  notifications: { preview: 'none', desktop: true, mode: 'all', sounds: true },
  server: { url: null },
  voice: {
    inputDeviceId: null,
    outputDeviceId: null,
    inputMode: 'voice',
    pushToTalkKey: 'Backquote',
    noiseSuppression: true,
    echoCancellation: true,
    userVolumes: {},
  },
};

export const SETTINGS_SECTIONS = ['updates', 'appearance', 'notifications', 'server', 'voice'] as const;

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
  });
}
