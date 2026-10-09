import { z } from 'zod';
import type { ChatMessage } from './ipc.ts';

/**
 * Community operations the renderer may request. Main parses every request
 * with this schema before acting, so the (untrusted) renderer can only ask
 * for these shapes; the server enforces permissions on top.
 */
const id = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const riverId = z.uuid();
const name = z.string().trim().min(1).max(64);
const text = z
  .string()
  .max(4000)
  .refine((s) => s.trim().length > 0, 'empty');
const permissions = z
  .number()
  .int()
  .min(0)
  .max(2 ** 30);
const color = z.number().int().min(0).max(0xffffff);
const overwrites = z.array(z.object({ roleId: id, allow: permissions, deny: permissions }).strict()).max(50);
const direction = z.union([z.literal(-1), z.literal(1)]);
/** A small square image chosen by the user, already resized by the renderer. */
export const avatarSchema = z
  .string()
  .max(60_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);

export const communityActionSchema = z.discriminatedUnion('a', [
  z
    .object({ a: z.literal('updateCommunity'), communityId: id, name, description: z.string().max(300) })
    .strict(),
  z.object({ a: z.literal('deleteCommunity'), communityId: id }).strict(),
  z.object({ a: z.literal('leave'), communityId: id }).strict(),
  z
    .object({
      a: z.literal('createChannel'),
      communityId: id,
      kind: z.enum(['text', 'voice']),
      name,
      topic: z.string().max(300).optional(),
      private: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      a: z.literal('updateChannel'),
      channelId: id,
      name: name.optional(),
      topic: z.string().max(300).optional(),
      overwrites: overwrites.optional(),
    })
    .strict(),
  z.object({ a: z.literal('moveChannel'), channelId: id, direction }).strict(),
  z.object({ a: z.literal('deleteChannel'), channelId: id }).strict(),
  z.object({ a: z.literal('createRole'), communityId: id, name, color, permissions }).strict(),
  z
    .object({
      a: z.literal('updateRole'),
      communityId: id,
      roleId: id,
      name: name.optional(),
      color: color.optional(),
      permissions: permissions.optional(),
    })
    .strict(),
  z.object({ a: z.literal('moveRole'), communityId: id, roleId: id, direction }).strict(),
  z.object({ a: z.literal('deleteRole'), communityId: id, roleId: id }).strict(),
  z.object({ a: z.literal('setMemberRoles'), communityId: id, riverId, roles: z.array(id).max(50) }).strict(),
  z.object({ a: z.literal('kick'), communityId: id, riverId }).strict(),
  z.object({ a: z.literal('ban'), communityId: id, riverId }).strict(),
  z.object({ a: z.literal('unban'), communityId: id, riverId }).strict(),
  z.object({ a: z.literal('bans'), communityId: id }).strict(),
  z.object({ a: z.literal('send'), channelId: id, text, replyTo: id.optional() }).strict(),
  z.object({ a: z.literal('edit'), channelId: id, messageId: id, text }).strict(),
  z.object({ a: z.literal('deleteMessage'), messageId: id }).strict(),
  z.object({ a: z.literal('pin'), messageId: id, pinned: z.boolean() }).strict(),
  z.object({ a: z.literal('pins'), channelId: id }).strict(),
  z
    .object({
      a: z.literal('react'),
      channelId: id,
      messageId: id,
      emoji: z.string().min(1).max(32),
      on: z.boolean(),
    })
    .strict(),
  z.object({ a: z.literal('typing'), channelId: id }).strict(),
  z
    .object({ a: z.literal('voiceState'), muted: z.boolean(), deafened: z.boolean(), streaming: z.boolean() })
    .strict(),
  z
    .object({
      a: z.literal('moderateVoice'),
      riverId,
      serverMuted: z.boolean().optional(),
      disconnect: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ a: z.literal('setProfile'), name: name.optional(), avatar: avatarSchema.nullable().optional() })
    .strict(),
]);

export type CommunityAction = z.input<typeof communityActionSchema>;

export interface BanView {
  riverId: string;
  name: string;
  bannedOn: string;
}

interface Results {
  createRole: string;
  bans: BanView[];
  send: ChatMessage;
  pins: ChatMessage[];
}

export type CommunityActionResult<A extends CommunityAction> = A['a'] extends keyof Results
  ? Results[A['a']]
  : null;
