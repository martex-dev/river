import { z } from 'zod';
import { RELEASE_CHANNELS } from '@river/release/channels';

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
  }),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  updates: { channel: 'stable', autoCheck: true, autoDownload: true, installOnQuit: true },
  appearance: { motion: 'system' },
  notifications: { preview: 'none' },
};

/** A partial update: each section may be omitted or partially specified. Unknown keys are rejected. */
export const settingsPatchSchema = z
  .object({
    updates: settingsSchema.shape.updates.partial().strict().optional(),
    appearance: settingsSchema.shape.appearance.partial().strict().optional(),
    notifications: settingsSchema.shape.notifications.partial().strict().optional(),
  })
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  return settingsSchema.parse({
    ...current,
    updates: { ...current.updates, ...patch.updates },
    appearance: { ...current.appearance, ...patch.appearance },
    notifications: { ...current.notifications, ...patch.notifications },
  });
}
