import { z } from 'zod';
import { serverUrlSchema } from './settings.ts';

/**
 * Starting layouts for a new community, so creating one is a single click.
 * Names are only suggestions: everything can be renamed, moved or deleted.
 */
export interface CommunityTemplate {
  id: TemplateId;
  label: string;
  emoji: string;
  description: string;
  /** Groups of channels; `category: null` means channels without a category. */
  layout: Array<{ category: string | null; channels: Array<{ kind: 'text' | 'voice'; name: string }> }>;
}

export const TEMPLATE_IDS = ['friends', 'gaming', 'study', 'club', 'blank'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const COMMUNITY_TEMPLATES: readonly CommunityTemplate[] = [
  {
    id: 'friends',
    label: 'Friends',
    emoji: '🫶',
    description: 'Chat, memes and a place to hang out.',
    layout: [
      {
        category: 'Text channels',
        channels: [
          { kind: 'text', name: 'general' },
          { kind: 'text', name: 'memes' },
          { kind: 'text', name: 'photos' },
        ],
      },
      {
        category: 'Voice channels',
        channels: [
          { kind: 'voice', name: 'Lounge' },
          { kind: 'voice', name: 'Movie night' },
        ],
      },
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming',
    emoji: '🎮',
    description: 'Find a squad, share clips, jump into voice.',
    layout: [
      {
        category: 'Info',
        channels: [
          { kind: 'text', name: 'welcome' },
          { kind: 'text', name: 'announcements' },
        ],
      },
      {
        category: 'Chat',
        channels: [
          { kind: 'text', name: 'general' },
          { kind: 'text', name: 'clips' },
          { kind: 'text', name: 'looking-for-group' },
        ],
      },
      {
        category: 'Voice',
        channels: [
          { kind: 'voice', name: 'Squad 1' },
          { kind: 'voice', name: 'Squad 2' },
          { kind: 'voice', name: 'AFK' },
        ],
      },
    ],
  },
  {
    id: 'study',
    label: 'Study group',
    emoji: '📚',
    description: 'Homework help, notes and quiet study rooms.',
    layout: [
      {
        category: 'Study',
        channels: [
          { kind: 'text', name: 'general' },
          { kind: 'text', name: 'homework-help' },
          { kind: 'text', name: 'notes-and-resources' },
        ],
      },
      {
        category: 'Rooms',
        channels: [
          { kind: 'voice', name: 'Study room' },
          { kind: 'voice', name: 'Quiet room' },
        ],
      },
    ],
  },
  {
    id: 'club',
    label: 'Club or team',
    emoji: '🏆',
    description: 'Announcements, events and meetups.',
    layout: [
      {
        category: 'Info',
        channels: [
          { kind: 'text', name: 'announcements' },
          { kind: 'text', name: 'events' },
        ],
      },
      {
        category: 'Talk',
        channels: [
          { kind: 'text', name: 'general' },
          { kind: 'text', name: 'ideas' },
        ],
      },
      { category: 'Voice', channels: [{ kind: 'voice', name: 'Meeting room' }] },
    ],
  },
  {
    id: 'blank',
    label: 'Start from scratch',
    emoji: '✨',
    description: 'One text and one voice channel.',
    layout: [
      {
        category: null,
        channels: [
          { kind: 'text', name: 'general' },
          { kind: 'voice', name: 'Lounge' },
        ],
      },
    ],
  },
];

export function templateById(id: TemplateId | undefined): CommunityTemplate {
  return COMMUNITY_TEMPLATES.find((t) => t.id === id) ?? COMMUNITY_TEMPLATES.at(-1)!;
}

/** Options the renderer may pass when creating a community (validated in main). */
export const createCommunityOptionsSchema = z
  .object({
    template: z.enum(TEMPLATE_IDS).optional(),
    /** Only used when this device has no account yet: the server to create one on. */
    serverUrl: serverUrlSchema.optional(),
  })
  .strict();
export type CreateCommunityOptions = z.input<typeof createCommunityOptionsSchema>;
