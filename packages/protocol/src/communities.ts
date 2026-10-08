import { z } from 'zod';
import { base64Bytes, riverIdSchema } from './accounts.ts';

/**
 * Communities (protocol v1, River 0.2).
 *
 * Every human-readable value — community name, channel names, member display
 * names, messages and call signalling — is end-to-end encrypted by clients with
 * the community key (AES-256-GCM). The key travels only inside invite links
 * (in the URL fragment, which is never sent to any server). The server stores
 * and relays ciphertext and knows membership, channel kinds and timing.
 */
export const COMMUNITY_ID_RE = /^[A-Za-z0-9_-]{22}$/;
export const communityIdSchema = z.string().regex(COMMUNITY_ID_RE);
export const channelIdSchema = z.string().regex(COMMUNITY_ID_RE);
export const messageIdSchema = z.string().regex(COMMUNITY_ID_RE);
export const inviteCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

/** base64(nonce 12 ‖ ciphertext ‖ tag 16). */
export const sealedSchema = (max: number) => base64Bytes(undefined, max);
export const SEALED_SMALL = 2048;
export const SEALED_MESSAGE = 32 * 1024;
export const SEALED_SIGNAL = 32 * 1024;

export const channelKindSchema = z.enum(['text', 'voice']);
export type ChannelKind = z.infer<typeof channelKindSchema>;
export const roleSchema = z.enum(['owner', 'admin', 'member']);
export type Role = z.infer<typeof roleSchema>;

export const channelSchema = z.object({
  id: channelIdSchema,
  kind: channelKindSchema,
  name: sealedSchema(SEALED_SMALL),
  position: z.number().int(),
});
export type ChannelWire = z.infer<typeof channelSchema>;

export const memberSchema = z.object({
  riverId: riverIdSchema,
  role: roleSchema,
  profile: sealedSchema(SEALED_SMALL),
});
export type MemberWire = z.infer<typeof memberSchema>;

export const communitySchema = z.object({
  id: communityIdSchema,
  meta: sealedSchema(SEALED_SMALL),
  channels: z.array(channelSchema),
  members: z.array(memberSchema),
});
export type CommunityWire = z.infer<typeof communitySchema>;

export const createCommunityRequestSchema = z
  .object({
    id: communityIdSchema,
    meta: sealedSchema(SEALED_SMALL),
    profile: sealedSchema(SEALED_SMALL),
    channels: z
      .array(
        z.object({ id: channelIdSchema, kind: channelKindSchema, name: sealedSchema(SEALED_SMALL) }).strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export type CreateCommunityRequest = z.infer<typeof createCommunityRequestSchema>;

export const createChannelRequestSchema = z
  .object({ id: channelIdSchema, kind: channelKindSchema, name: sealedSchema(SEALED_SMALL) })
  .strict();

export const inviteResponseSchema = z.object({ code: inviteCodeSchema, expiresAt: z.iso.datetime() });
export const joinRequestSchema = z
  .object({ code: inviteCodeSchema, profile: sealedSchema(SEALED_SMALL) })
  .strict();
export const profileRequestSchema = z.object({ profile: sealedSchema(SEALED_SMALL) }).strict();
export const communitiesResponseSchema = z.object({ communities: z.array(communitySchema) });

export const messageSchema = z.object({
  id: messageIdSchema,
  channelId: channelIdSchema,
  sender: riverIdSchema,
  body: sealedSchema(SEALED_MESSAGE),
  sentAt: z.iso.datetime(),
});
export type MessageWire = z.infer<typeof messageSchema>;
export const sendMessageRequestSchema = z
  .object({ id: messageIdSchema, body: sealedSchema(SEALED_MESSAGE) })
  .strict();
export const messagesResponseSchema = z.object({ messages: z.array(messageSchema) });

// ---- Realtime (WebSocket /v1/ws) -------------------------------------------------------------

export const clientEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('auth'), token: z.string().max(64) }),
  z.object({ t: z.literal('voice.join'), channelId: channelIdSchema }),
  z.object({ t: z.literal('voice.leave') }),
  z.object({ t: z.literal('signal'), to: riverIdSchema, data: sealedSchema(SEALED_SIGNAL) }),
  z.object({ t: z.literal('ping') }),
]);
export type ClientEvent = z.infer<typeof clientEventSchema>;

export const serverEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), riverId: riverIdSchema }),
  z.object({ t: z.literal('message'), communityId: communityIdSchema, message: messageSchema }),
  z.object({ t: z.literal('member'), communityId: communityIdSchema, member: memberSchema }),
  z.object({ t: z.literal('channel'), communityId: communityIdSchema, channel: channelSchema }),
  z.object({
    t: z.literal('voice'),
    communityId: communityIdSchema,
    channelId: channelIdSchema,
    participants: z.array(riverIdSchema),
  }),
  z.object({
    t: z.literal('signal'),
    from: riverIdSchema,
    channelId: channelIdSchema,
    data: sealedSchema(SEALED_SIGNAL),
  }),
  z.object({ t: z.literal('error'), code: z.string() }),
  z.object({ t: z.literal('pong') }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
