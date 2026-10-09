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

export const memberSchema = z.object({
  riverId: riverIdSchema,
  role: roleSchema,
  roles: z.array(roleIdSchema).default([]),
  profile: sealedSchema(SEALED_PROFILE),
  online: z.boolean().default(false),
  /** Timed out until this moment (1.0.6); null when not timed out. */
  timeoutUntil: z.string().max(40).nullable().default(null),
});
export type MemberWire = z.infer<typeof memberSchema>;

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

export const createChannelRequestSchema = z
  .object({
    id: channelIdSchema,
    kind: channelKindSchema,
    name: sealedSchema(SEALED_SMALL),
    overwrites: z.array(overwriteSchema).max(50).optional(),
    parentId: channelIdSchema.nullable().optional(),
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
  bans: z.array(z.object({ riverId: riverIdSchema, bannedOn: z.string() })),
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
});
export type MessageWire = z.infer<typeof messageSchema>;
export const sendMessageRequestSchema = z
  .object({
    id: messageIdSchema,
    body: sealedSchema(SEALED_MESSAGE),
    attachments: z.array(attachmentIdSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  })
  .strict();
export const editMessageRequestSchema = z.object({ body: sealedSchema(SEALED_MESSAGE) }).strict();
export const reactRequestSchema = z.object({ emoji: sealedSchema(SEALED_SMALL) }).strict();
export const messagesResponseSchema = z.object({ messages: z.array(messageSchema) });

// ---- Realtime (WebSocket /v1/ws) -------------------------------------------------------------

export const voiceStateSchema = z.object({
  muted: z.boolean(),
  deafened: z.boolean(),
  serverMuted: z.boolean(),
  streaming: z.boolean(),
});
export type VoiceState = z.infer<typeof voiceStateSchema>;

export const clientEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('auth'), token: z.string().max(64) }),
  z.object({ t: z.literal('voice.join'), channelId: channelIdSchema }),
  z.object({ t: z.literal('voice.leave') }),
  z.object({
    t: z.literal('voice.state'),
    muted: z.boolean(),
    deafened: z.boolean(),
    streaming: z.boolean(),
  }),
  z.object({
    t: z.literal('voice.moderate'),
    target: riverIdSchema,
    serverMuted: z.boolean().optional(),
    disconnect: z.boolean().optional(),
  }),
  z.object({ t: z.literal('signal'), to: riverIdSchema, data: sealedSchema(SEALED_SIGNAL) }),
  z.object({ t: z.literal('typing'), channelId: channelIdSchema }),
  z.object({ t: z.literal('ping') }),
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
  z.object({ t: z.literal('presence'), riverId: riverIdSchema, online: z.boolean() }),
  z.object({ t: z.literal('error'), code: z.string() }),
  z.object({ t: z.literal('pong') }),
  /** An end-to-end encrypted direct-message envelope for one of your devices. */
  z.object({ t: z.literal('dm'), envelope: envelopeSchema }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
