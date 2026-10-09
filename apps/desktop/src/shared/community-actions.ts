import { z } from 'zod';
import type { ChatMessage } from './ipc.ts';
import { communityIconSchema } from './templates.ts';

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

const b64 = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+=*$/)
    .refine(
      (v) => v.length % 4 === 0 && (v.length / 4) * 3 - (v.match(/=*$/)?.[0].length ?? 0) === bytes,
      `must be ${bytes} bytes`,
    );

/** Largest file River uploads (the server may allow less). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Everything needed to fetch and decrypt one attachment. It travels only
 * inside end-to-end encrypted message bodies.
 */
export const attachmentPointerSchema = z
  .object({
    id,
    key: b64(64),
    digest: b64(32),
    size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
    name: z.string().min(1).max(255),
    mime: z
      .string()
      .max(100)
      .regex(/^[\w.+-]+\/[\w.+-]+$/),
    width: z.number().int().min(1).max(20_000).optional(),
    height: z.number().int().min(1).max(20_000).optional(),
    /** Tiny blurred preview made on the sender's device. */
    thumb: z
      .string()
      .max(3000)
      .regex(/^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/]+=*$/)
      .optional(),
  })
  .strict();
export type AttachmentPointer = z.infer<typeof attachmentPointerSchema>;

const fileBytes = z.custom<Uint8Array>(
  (v) => v instanceof Uint8Array && v.byteLength <= MAX_ATTACHMENT_BYTES,
  'file too large',
);

export const communityActionSchema = z.discriminatedUnion('a', [
  z
    .object({
      a: z.literal('updateCommunity'),
      communityId: id,
      name,
      description: z.string().max(300),
      /** Omitted: keep the current icon; null: no icon. */
      icon: communityIconSchema.nullable().optional(),
    })
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
      parentId: id.nullable().optional(),
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
  z.object({ a: z.literal('createCategory'), communityId: id, name }).strict(),
  z.object({ a: z.literal('renameCategory'), communityId: id, categoryId: id, name }).strict(),
  z.object({ a: z.literal('deleteCategory'), communityId: id, categoryId: id }).strict(),
  /** A drag and drop in the sidebar: only the categories and channels that moved. */
  z
    .object({
      a: z.literal('layout'),
      communityId: id,
      categories: z.array(z.object({ id, position: z.number().int().min(0).max(1000) }).strict()).max(100),
      channels: z
        .array(
          z.object({ id, position: z.number().int().min(0).max(1000), parentId: id.nullable() }).strict(),
        )
        .max(500),
    })
    .strict(),
  /** You have seen this channel up to now. */
  z.object({ a: z.literal('markRead'), channelId: id }).strict(),
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
  z
    .object({
      a: z.literal('send'),
      channelId: id,
      text: z.string().max(4000),
      replyTo: id.optional(),
      attachments: z.array(attachmentPointerSchema).max(10).optional(),
    })
    .strict()
    .refine((v) => v.text.trim().length > 0 || (v.attachments?.length ?? 0) > 0, 'empty'),
  z
    .object({
      a: z.literal('upload'),
      name: z.string().min(1).max(255),
      mime: z.string().max(100),
      bytes: fileBytes,
      width: z.number().int().min(1).max(20_000).optional(),
      height: z.number().int().min(1).max(20_000).optional(),
      thumb: z.string().max(3000).optional(),
    })
    .strict(),
  z.object({ a: z.literal('download'), pointer: attachmentPointerSchema }).strict(),
  z.object({ a: z.literal('edit'), channelId: id, messageId: id, text }).strict(),
  z.object({ a: z.literal('deleteMessage'), messageId: id }).strict(),
  z.object({ a: z.literal('pin'), messageId: id, pinned: z.boolean() }).strict(),
  z.object({ a: z.literal('pins'), channelId: id }).strict(),
  /** Older messages, before an ISO timestamp (100 at a time). */
  z.object({ a: z.literal('history'), channelId: id, before: z.iso.datetime() }).strict(),
  /** Search a community's text channels (decrypted on this device). */
  z.object({ a: z.literal('search'), communityId: id, query: z.string().trim().min(2).max(100) }).strict(),
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
  createCategory: string;
  bans: BanView[];
  send: ChatMessage;
  pins: ChatMessage[];
  upload: AttachmentPointer;
  history: ChatMessage[];
  search: ChatMessage[];
  download: Uint8Array;
}

export type CommunityActionResult<A extends CommunityAction> = A['a'] extends keyof Results
  ? Results[A['a']]
  : null;
