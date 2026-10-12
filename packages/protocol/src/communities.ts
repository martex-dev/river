import { z } from 'zod';
import { base64Bytes, riverIdSchema } from './accounts.ts';
import { envelopeSchema } from './messaging.ts';

/**
 * Communities (protocol v1).
 *
 * Every human-readable value — community, channel and role names, topics,
 * member profiles, messages, reactions and call signalling — is end-to-end
 * encrypted by clients with the community key (AES-256-GCM). The key travels
 * only inside invite links (in the URL fragment, never sent to a server). The
 * server stores and relays ciphertext and knows membership, roles' permission
 * bits, channel kinds and timing, which it needs to enforce permissions.
 *
 * Compatibility: fields added after 0.2 are optional on input and extra on
 * output, so 0.2.x clients keep working while they auto-update.
 */
export const COMMUNITY_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const communityIdSchema = z.string().regex(COMMUNITY_ID_RE);
export const channelIdSchema = z.string().regex(COMMUNITY_ID_RE);
export const messageIdSchema = z.string().regex(COMMUNITY_ID_RE);
export const roleIdSchema = z.string().regex(COMMUNITY_ID_RE);
/** Encrypted attachment blobs (see packages/crypto attachment.ts). */
export const attachmentIdSchema = z.string().regex(COMMUNITY_ID_RE);
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const attachmentUploadResponseSchema = z.object({ id: attachmentIdSchema });
export const inviteCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
/** HMAC tag that lets the server group identical reactions without learning the emoji. */
export const reactionTagSchema = z.string().regex(/^[0-9a-f]{32}$/);

/** base64(nonce 12 ‖ ciphertext ‖ tag 16). */
export const sealedSchema = (max: number) => base64Bytes(undefined, max);
export const SEALED_SMALL = 2048;
export const SEALED_PROFILE = 96 * 1024;
export const SEALED_MESSAGE = 32 * 1024;
export const SEALED_SIGNAL = 32 * 1024;

export const channelKindSchema = z.enum(['text', 'voice']);
export type ChannelKind = z.infer<typeof channelKindSchema>;
/** Legacy membership marker kept for 0.2 clients; real authority comes from roles. */
export const roleSchema = z.enum(['owner', 'admin', 'member']);
export type Role = z.infer<typeof roleSchema>;

const permissionsSchema = z
  .number()
  .int()
  .min(0)
  .max(2 ** 30);

export const overwriteSchema = z.object({
  roleId: roleIdSchema,
  allow: permissionsSchema,
  deny: permissionsSchema,
});
export type OverwriteWire = z.infer<typeof overwriteSchema>;

export const channelSchema = z.object({
  id: channelIdSchema,
  kind: channelKindSchema,
  name: sealedSchema(SEALED_SMALL),
  position: z.number().int(),
  overwrites: z.array(overwriteSchema).default([]),
  /** The category the channel sits in, if any (1.0+). */
  parentId: channelIdSchema.nullable().default(null),
  /** When the newest message was sent, so clients can mark unread channels (1.0+). */
  lastMessageAt: z.string().max(40).nullable().default(null),
  /** The channel uses its category's permissions (1.0.6). */
  synced: z.boolean().default(false),
  /** Only people who may manage messages can post (1.0.7). */
  announcement: z.boolean().default(false),
  /** Seconds between messages from the same member; 0 = off (1.0.7). */
  slowmode: z.number().int().min(0).max(21_600).default(0),
  /** Most people in a voice channel at once; 0 = no limit (1.0.8). */
  userLimit: z.number().int().min(0).max(99).default(0),
  /** Every top-level message starts a titled thread: a post (1.0.22). */
  forum: z.boolean().default(false),
  /** A voice channel where only invited speakers talk; everyone else listens (1.0.22). */
  stage: z.boolean().default(false),
});
export type ChannelWire = z.infer<typeof channelSchema>;

/** A named group of channels in the sidebar (1.0+). */
export const categorySchema = z.object({
  id: channelIdSchema,
  name: sealedSchema(SEALED_SMALL),
  position: z.number().int(),
  /** Permissions channels synced to this category use (1.0.6). */
  overwrites: z.array(overwriteSchema).default([]),
});
export type CategoryWire = z.infer<typeof categorySchema>;

export const communityRoleSchema = z.object({
  id: roleIdSchema,
  /** Empty for @everyone (its ID equals the community ID). */
  name: z.string().max(4096),
  color: z.number().int().min(0).max(0xffffff),
  permissions: permissionsSchema,
  position: z.number().int().min(0),
});
export type RoleWire = z.infer<typeof communityRoleSchema>;

/** What others see of someone's presence (1.0.17). Invisible people are simply offline. */
export const presenceStatusSchema = z.enum(['online', 'idle', 'dnd']);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;
/** What someone may choose. */
export const chosenStatusSchema = z.enum(['online', 'idle', 'dnd', 'invisible']);
export type ChosenStatus = z.infer<typeof chosenStatusSchema>;

export const memberSchema = z.object({
  riverId: riverIdSchema,
  role: roleSchema,
  roles: z.array(roleIdSchema).default([]),
  profile: sealedSchema(SEALED_PROFILE),
  online: z.boolean().default(false),
  /** Idle or Do Not Disturb while online (1.0.17); absent means plain online. */
  status: presenceStatusSchema.optional(),
  /** Timed out until this moment (1.0.6); null when not timed out. */
  timeoutUntil: z.string().max(40).nullable().default(null),
  /** Has not accepted the community's rules yet, so can only read (1.0.24). */
  pending: z.boolean().optional(),
  /** The day they joined, YYYY-MM-DD (1.0.21). */
  joinedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type MemberWire = z.infer<typeof memberSchema>;

/** Sealed rules and welcome note, and how many self-assignable roles (1.0.24). */
export const SEALED_ONBOARDING = 16 * 1024;
export const MAX_SELF_ROLES = 25;
/** A community's sealed picture and banner (1.0.29). */
export const SEALED_ART = 160 * 1024;

export const communitySchema = z.object({
  id: communityIdSchema,
  meta: sealedSchema(SEALED_SMALL),
  ownerId: riverIdSchema.optional(),
  channels: z.array(channelSchema),
  members: z.array(memberSchema),
  roles: z.array(communityRoleSchema).default([]),
  categories: z.array(categorySchema).default([]),
  /** Current community key epoch; content is sealed with the newest key. */
  keyEpoch: z.number().int().min(0).default(0),
  /** A member was removed and the key has not been replaced yet. */
  rotationNeeded: z.boolean().default(false),
  /** Sealed { rules, welcome } (1.0.24). */
  onboarding: sealedSchema(SEALED_ONBOARDING).nullable().optional(),
  /** New members must accept the rules before taking part (1.0.24). */
  screening: z.boolean().optional(),
  /** Roles members may give themselves (1.0.24). */
  selfRoles: z.array(roleIdSchema).max(MAX_SELF_ROLES).optional(),
  /** Sealed { icon, banner } pictures (1.0.29). */
  art: sealedSchema(SEALED_ART).nullable().optional(),
});
export type CommunityWire = z.infer<typeof communitySchema>;
export const joinResponseSchema = communitySchema.extend({
  inviteCheck: z.string().max(4096).nullable().default(null),
});

export const createCommunityRequestSchema = z
  .object({
    id: communityIdSchema,
    meta: sealedSchema(SEALED_SMALL),
    profile: sealedSchema(SEALED_PROFILE),
    channels: z
      .array(
        z.object({ id: channelIdSchema, kind: channelKindSchema, name: sealedSchema(SEALED_SMALL) }).strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export type CreateCommunityRequest = z.infer<typeof createCommunityRequestSchema>;

export const updateCommunityRequestSchema = z.object({ meta: sealedSchema(SEALED_SMALL) }).strict();

/** Rules, screening and self-assignable roles (1.0.24). */
export const updateOnboardingRequestSchema = z
  .object({
    onboarding: sealedSchema(SEALED_ONBOARDING).nullable(),
    screening: z.boolean(),
    selfRoles: z.array(roleIdSchema).max(MAX_SELF_ROLES),
  })
  .strict();
export const updateArtRequestSchema = z.object({ art: sealedSchema(SEALED_ART).nullable() }).strict();
export const selfRolesRequestSchema = z.object({ roles: z.array(roleIdSchema).max(MAX_SELF_ROLES) }).strict();

export const createChannelRequestSchema = z
  .object({
    id: channelIdSchema,
    kind: channelKindSchema,
    name: sealedSchema(SEALED_SMALL),
    overwrites: z.array(overwriteSchema).max(50).optional(),
    parentId: channelIdSchema.nullable().optional(),
    forum: z.boolean().optional(),
    stage: z.boolean().optional(),
  })
  .strict();

export const updateChannelRequestSchema = z
  .object({
    name: sealedSchema(SEALED_SMALL).optional(),
    position: z.number().int().min(0).max(1000).optional(),
    overwrites: z.array(overwriteSchema).max(50).optional(),
    parentId: channelIdSchema.nullable().optional(),
    /** true: use the category's permissions again (drops the channel's own). */
    synced: z.boolean().optional(),
    announcement: z.boolean().optional(),
    slowmode: z.number().int().min(0).max(21_600).optional(),
    userLimit: z.number().int().min(0).max(99).optional(),
    forum: z.boolean().optional(),
    stage: z.boolean().optional(),
  })
  .strict();

export const createCategoryRequestSchema = z
  .object({ id: channelIdSchema, name: sealedSchema(SEALED_SMALL) })
  .strict();
export const updateCategoryRequestSchema = z
  .object({
    name: sealedSchema(SEALED_SMALL).optional(),
    overwrites: z.array(overwriteSchema).max(50).optional(),
  })
  .strict();

/** Time a member out until a moment (at most 28 days ahead), or end it with null. */
export const timeoutRequestSchema = z.object({ until: z.iso.datetime().nullable() }).strict();

export const auditEntrySchema = z.object({
  id: z.string().max(64),
  actor: riverIdSchema,
  action: z.string().max(40),
  /** A member, role, channel or category ID; never content. */
  target: z.string().max(64).nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
  at: z.string().max(40),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export const auditResponseSchema = z.object({ entries: z.array(auditEntrySchema) });
/**
 * The whole sidebar order in one request, so drag and drop is atomic: every
 * category and channel the caller can manage, with its new place.
 */
export const layoutRequestSchema = z
  .object({
    categories: z
      .array(z.object({ id: channelIdSchema, position: z.number().int().min(0).max(1000) }).strict())
      .max(100),
    channels: z
      .array(
        z
          .object({
            id: channelIdSchema,
            position: z.number().int().min(0).max(1000),
            parentId: channelIdSchema.nullable(),
            /** Also (un)sync the channel with its category's permissions. */
            synced: z.boolean().optional(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type LayoutRequest = z.infer<typeof layoutRequestSchema>;

export const createRoleRequestSchema = z
  .object({
    id: roleIdSchema,
    name: sealedSchema(SEALED_SMALL),
    color: z.number().int().min(0).max(0xffffff),
    permissions: permissionsSchema,
  })
  .strict();
export const updateRoleRequestSchema = z
  .object({
    name: sealedSchema(SEALED_SMALL).optional(),
    color: z.number().int().min(0).max(0xffffff).optional(),
    permissions: permissionsSchema.optional(),
    position: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export const memberRolesRequestSchema = z.object({ roles: z.array(roleIdSchema).max(50) }).strict();

export const inviteResponseSchema = z.object({ code: inviteCodeSchema, expiresAt: z.iso.datetime() });
/** Optional check value sealed with the key in the invite link, so joiners can verify the key. */
export const createInviteRequestSchema = z.object({ check: sealedSchema(SEALED_SMALL).optional() }).strict();
export const rotateKeyRequestSchema = z.object({ from: z.number().int().min(0) }).strict();
export const rotateKeyResponseSchema = z.object({ epoch: z.number().int().min(0) });
export const joinRequestSchema = z
  .object({ code: inviteCodeSchema, profile: sealedSchema(SEALED_PROFILE) })
  .strict();
export const profileRequestSchema = z.object({ profile: sealedSchema(SEALED_PROFILE) }).strict();
export const communitiesResponseSchema = z.object({ communities: z.array(communitySchema) });
export const bansResponseSchema = z.object({
  bans: z.array(
    z.object({
      riverId: riverIdSchema,
      bannedOn: z.string(),
      /** When a temporary ban ends (1.0.22); absent or null = for good. */
      until: z.string().max(40).nullable().optional(),
    }),
  ),
});

export const reactionSchema = z.object({
  tag: reactionTagSchema,
  /** The emoji, sealed; any reactor's copy decrypts to the same emoji. */
  emoji: sealedSchema(SEALED_SMALL),
  users: z.array(riverIdSchema),
});
export type ReactionWire = z.infer<typeof reactionSchema>;

export const messageSchema = z.object({
  id: messageIdSchema,
  channelId: channelIdSchema,
  sender: riverIdSchema,
  body: sealedSchema(SEALED_MESSAGE),
  sentAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable().default(null),
  pinned: z.boolean().default(false),
  reactions: z.array(reactionSchema).default([]),
  /** IDs of encrypted blobs; keys and names are inside the sealed body. */
  attachments: z.array(attachmentIdSchema).default([]),
  /** The thread this message is a reply in (the thread's starting message), or null (1.0.7). */
  threadId: messageIdSchema.nullable().default(null),
  /** The thread started from this message, if any (1.0.7). */
  thread: z
    .object({
      name: sealedSchema(SEALED_SMALL),
      count: z.number().int().min(0),
      lastAt: z.iso.datetime().nullable(),
      archived: z.boolean(),
      creator: riverIdSchema,
    })
    .nullable()
    .default(null),
});
export type MessageWire = z.infer<typeof messageSchema>;
export const sendMessageRequestSchema = z
  .object({
    id: messageIdSchema,
    body: sealedSchema(SEALED_MESSAGE),
    attachments: z.array(attachmentIdSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
    /** Reply inside the thread started from this message (1.0.7). */
    threadId: messageIdSchema.optional(),
    /** Start a thread from this message at once, with this sealed name: a forum post (1.0.22). */
    thread: z
      .object({ name: sealedSchema(SEALED_SMALL) })
      .strict()
      .optional(),
  })
  .strict();
export const createThreadRequestSchema = z.object({ name: sealedSchema(SEALED_SMALL) }).strict();
export const updateThreadRequestSchema = z
  .object({ name: sealedSchema(SEALED_SMALL).optional(), archived: z.boolean().optional() })
  .strict();
export const editMessageRequestSchema = z.object({ body: sealedSchema(SEALED_MESSAGE) }).strict();
/** Delete up to 100 messages of one channel at once (moderators, 1.0.24). */
export const bulkDeleteRequestSchema = z.object({ ids: z.array(messageIdSchema).min(1).max(100) }).strict();
export const reactRequestSchema = z.object({ emoji: sealedSchema(SEALED_SMALL) }).strict();
export const messagesResponseSchema = z.object({ messages: z.array(messageSchema) });

// ---- Realtime (WebSocket /v1/ws) -------------------------------------------------------------

// ---- Scheduled events (1.0.18) ----------------------------------------------------------------

export const SEALED_EVENT = 8 * 1024;
const isoTime = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be a time');

export const eventSchema = z.object({
  id: z.string().regex(COMMUNITY_ID_RE),
  communityId: communityIdSchema,
  createdBy: riverIdSchema,
  /** Sealed { name, description, place }. */
  data: sealedSchema(SEALED_EVENT),
  startsAt: isoTime,
  endsAt: isoTime,
  /** The voice channel it happens in, if any. */
  channelId: channelIdSchema.nullable(),
  canceled: z.boolean(),
  interested: z.array(riverIdSchema),
});
export type EventWire = z.infer<typeof eventSchema>;
export const eventsResponseSchema = z.object({ events: z.array(eventSchema) });
export const createEventRequestSchema = z
  .object({
    id: z.string().regex(COMMUNITY_ID_RE),
    data: sealedSchema(SEALED_EVENT),
    startsAt: isoTime,
    endsAt: isoTime,
    channelId: channelIdSchema.nullable(),
  })
  .strict();
export const updateEventRequestSchema = z
  .object({
    data: sealedSchema(SEALED_EVENT).optional(),
    startsAt: isoTime.optional(),
    endsAt: isoTime.optional(),
    channelId: channelIdSchema.nullable().optional(),
    canceled: z.boolean().optional(),
  })
  .strict();

// ---- Custom emoji (1.0.19) ---------------------------------------------------------------------

/** A sealed { name, image } — the image is a small PNG/WebP/GIF data URL. */
export const SEALED_EMOJI = 96 * 1024;
export const MAX_COMMUNITY_EMOJI = 100;
export const emojiSchema = z.object({
  id: z.string().regex(COMMUNITY_ID_RE),
  createdBy: riverIdSchema,
  data: sealedSchema(SEALED_EMOJI),
});
export const emojisResponseSchema = z.object({ emojis: z.array(emojiSchema) });
export const createEmojiRequestSchema = z
  .object({ id: z.string().regex(COMMUNITY_ID_RE), data: sealedSchema(SEALED_EMOJI) })
  .strict();

/** Rename (1.0.20): the whole sealed { name, image } is replaced. */
export const updateEmojiRequestSchema = z.object({ data: sealedSchema(SEALED_EMOJI) }).strict();

/** Stickers (1.0.24): a sealed { name, image }, image up to 320 px. */
export const SEALED_STICKER = 200 * 1024;
export const MAX_COMMUNITY_STICKERS = 60;
export const stickersResponseSchema = z.object({
  stickers: z.array(
    z.object({
      id: z.string().regex(COMMUNITY_ID_RE),
      createdBy: riverIdSchema,
      data: sealedSchema(SEALED_STICKER),
    }),
  ),
});
export const createStickerRequestSchema = z
  .object({ id: z.string().regex(COMMUNITY_ID_RE), data: sealedSchema(SEALED_STICKER) })
  .strict();

/** Moderator notes about a member (1.0.23): a sealed { text }. */
export const SEALED_NOTE = 4 * 1024;
export const MAX_NOTES_PER_MEMBER = 50;
export const createNoteRequestSchema = z
  .object({ id: z.string().regex(COMMUNITY_ID_RE), data: sealedSchema(SEALED_NOTE) })
  .strict();
export const notesResponseSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string().regex(COMMUNITY_ID_RE),
      author: riverIdSchema,
      data: sealedSchema(SEALED_NOTE),
      createdAt: z.string(),
    }),
  ),
});

/** A sealed { name, emoji, audio } soundboard sound (1.0.22); audio is a short clip as a data URL. */
export const SEALED_SOUND = 240 * 1024;
export const MAX_COMMUNITY_SOUNDS = 48;
/** Seconds between two sounds from the same person. */
export const SOUND_COOLDOWN_MS = 2500;
export const soundSchema = z.object({
  id: z.string().regex(COMMUNITY_ID_RE),
  createdBy: riverIdSchema,
  data: sealedSchema(SEALED_SOUND),
});
export const soundsResponseSchema = z.object({ sounds: z.array(soundSchema) });
export const createSoundRequestSchema = z
  .object({ id: z.string().regex(COMMUNITY_ID_RE), data: sealedSchema(SEALED_SOUND) })
  .strict();
export const updateSoundRequestSchema = z.object({ data: sealedSchema(SEALED_SOUND) }).strict();

/** A sealed { reason, text, senderName } — what the reporter saw (1.0.21). */
export const SEALED_REPORT = 8 * 1024;
export const reportStatusSchema = z.enum(['open', 'resolved', 'dismissed']);
export const createReportRequestSchema = z
  .object({
    id: z.string().regex(COMMUNITY_ID_RE),
    messageId: messageIdSchema,
    data: sealedSchema(SEALED_REPORT),
  })
  .strict();
export const reportSchema = z.object({
  id: z.string().regex(COMMUNITY_ID_RE),
  channelId: channelIdSchema,
  messageId: messageIdSchema,
  reporter: riverIdSchema,
  target: riverIdSchema,
  data: sealedSchema(SEALED_REPORT),
  status: reportStatusSchema,
  resolvedBy: riverIdSchema.nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export const reportsResponseSchema = z.object({ reports: z.array(reportSchema) });
export const updateReportRequestSchema = z.object({ status: reportStatusSchema }).strict();
/** Open reports one person may have in one community at a time. */
export const MAX_OPEN_REPORTS = 20;

/** Ban, optionally deleting the person's recent messages in the community (1.0.21). */
export const BAN_DELETE_CHOICES = [0, 3600, 6 * 3600, 24 * 3600, 3 * 24 * 3600, 7 * 24 * 3600] as const;
/** How long a temporary ban can last (1.0.22). */
export const BAN_DURATIONS = [3600, 24 * 3600, 7 * 24 * 3600, 30 * 24 * 3600] as const;
export const banRequestSchema = z
  .object({
    deleteMessagesSeconds: z
      .number()
      .int()
      .refine((n) => (BAN_DELETE_CHOICES as readonly number[]).includes(n))
      .optional(),
    /** Ban only for this long (1.0.22); absent = for good. */
    durationSeconds: z
      .number()
      .int()
      .refine((n) => (BAN_DURATIONS as readonly number[]).includes(n))
      .optional(),
  })
  .strict();
/** Most messages one ban deletes. */
export const MAX_BAN_DELETES = 1000;

/** Make another member the owner (1.0.19); only the owner may. */
export const transferOwnershipRequestSchema = z.object({ riverId: riverIdSchema }).strict();

export const callRoomSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** Most people in one private call room. */
export const MAX_CALL_ROOM = 8;

export const voiceStateSchema = z.object({
  muted: z.boolean(),
  deafened: z.boolean(),
  serverMuted: z.boolean(),
  /** A moderator turned their sound off for everyone (1.0.20); they hear nothing and cannot speak. */
  serverDeafened: z.boolean().optional(),
  /** On a stage: asking to speak (1.0.22). */
  handRaised: z.boolean().optional(),
  streaming: z.boolean(),
  /**
   * The member's connection to the server dropped; their seat is kept for a
   * short grace period while their app reconnects (1.0.16). Calls are peer to
   * peer, so audio usually keeps flowing meanwhile.
   */
  reconnecting: z.boolean().optional(),
});
export type VoiceState = z.infer<typeof voiceStateSchema>;

export const clientEventSchema = z.discriminatedUnion('t', [
  /** `status`: the presence to start with (so invisible people never flash online). */
  z.object({ t: z.literal('auth'), token: z.string().max(64), status: chosenStatusSchema.optional() }),
  z.object({ t: z.literal('presence.set'), status: chosenStatusSchema }),
  z.object({ t: z.literal('voice.join'), channelId: channelIdSchema }),
  z.object({ t: z.literal('voice.leave') }),
  z.object({
    t: z.literal('voice.state'),
    muted: z.boolean(),
    deafened: z.boolean(),
    streaming: z.boolean(),
    /** On a stage: raise or lower your hand (1.0.22). */
    handRaised: z.boolean().optional(),
  }),
  z.object({
    t: z.literal('voice.moderate'),
    target: riverIdSchema,
    serverMuted: z.boolean().optional(),
    serverDeafened: z.boolean().optional(),
    /** On a stage: invite to speak (true) or move back to the audience (false) (1.0.22). */
    speaker: z.boolean().optional(),
    disconnect: z.boolean().optional(),
  }),
  z.object({ t: z.literal('signal'), to: riverIdSchema, data: sealedSchema(SEALED_SIGNAL) }),
  z.object({ t: z.literal('typing'), channelId: channelIdSchema }),
  z.object({ t: z.literal('ping') }),
  /**
   * Join (or leave, with null) a private call room so the server may relay
   * encrypted voice between its members (1:1 calls, 1.0.16). The room ID is a
   * hash of the call's secret ID: the server learns that these people are in a
   * call together, nothing else.
   */
  z.object({ t: z.literal('call.room'), room: callRoomSchema.nullable() }),
  /** Play a soundboard sound to everyone in your voice channel (1.0.22). */
  z.object({ t: z.literal('voice.sound'), soundId: z.string().regex(COMMUNITY_ID_RE) }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

export const serverEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), riverId: riverIdSchema }),
  z.object({ t: z.literal('message'), communityId: communityIdSchema, message: messageSchema }),
  z.object({
    t: z.literal('message.delete'),
    communityId: communityIdSchema,
    channelId: channelIdSchema,
    messageId: messageIdSchema,
  }),
  z.object({ t: z.literal('member'), communityId: communityIdSchema, member: memberSchema }),
  z.object({ t: z.literal('channel'), communityId: communityIdSchema, channel: channelSchema }),
  /** Something structural changed (roles, channels, settings, membership): refetch the community. */
  z.object({ t: z.literal('community'), communityId: communityIdSchema }),
  /** You were removed (kicked, banned) or the community was deleted. */
  z.object({
    t: z.literal('removed'),
    communityId: communityIdSchema,
    reason: z.enum(['kicked', 'banned', 'left', 'deleted']),
  }),
  z.object({
    t: z.literal('voice'),
    communityId: communityIdSchema,
    channelId: channelIdSchema,
    participants: z.array(riverIdSchema),
    states: z.record(z.string(), voiceStateSchema).optional(),
  }),
  z.object({ t: z.literal('voice.disconnect') }),
  /** Someone in your voice channel played a soundboard sound (1.0.22). */
  z.object({
    t: z.literal('voice.sound'),
    communityId: communityIdSchema,
    channelId: channelIdSchema,
    from: riverIdSchema,
    soundId: z.string().regex(COMMUNITY_ID_RE),
  }),
  /** A community's soundboard changed (1.0.22). */
  z.object({ t: z.literal('sounds'), communityId: communityIdSchema }),
  /** A community's stickers changed (1.0.24). */
  z.object({ t: z.literal('stickers'), communityId: communityIdSchema }),
  /** A community's scheduled events changed: fetch them again (1.0.18). */
  z.object({ t: z.literal('events'), communityId: communityIdSchema }),
  /** A community's custom emoji changed (1.0.19). */
  z.object({ t: z.literal('emojis'), communityId: communityIdSchema }),
  /** A report was made or handled; sent to people who may review reports (1.0.21). */
  z.object({ t: z.literal('reports'), communityId: communityIdSchema }),
  z.object({
    t: z.literal('signal'),
    from: riverIdSchema,
    channelId: channelIdSchema,
    data: sealedSchema(SEALED_SIGNAL),
  }),
  z.object({
    t: z.literal('typing'),
    communityId: communityIdSchema,
    channelId: channelIdSchema,
    riverId: riverIdSchema,
  }),
  z.object({
    t: z.literal('presence'),
    riverId: riverIdSchema,
    online: z.boolean(),
    status: presenceStatusSchema.optional(),
  }),
  z.object({ t: z.literal('error'), code: z.string() }),
  z.object({ t: z.literal('pong') }),
  /** An end-to-end encrypted direct-message envelope for one of your devices. */
  z.object({ t: z.literal('dm'), envelope: envelopeSchema }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
