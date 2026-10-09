import { z } from 'zod';
import {
  attachmentPointerSchema,
  MAX_ATTACHMENT_BYTES,
  type AttachmentPointer,
} from './community-actions.ts';

/** Direct messages as the renderer sees them (decrypted in main). */

export interface ConversationView {
  /** A River ID for a direct conversation, or a group ID. */
  riverId: string;
  kind: 'direct' | 'group';
  /** Group members (empty for direct conversations). */
  members: Array<{ riverId: string; name: string; avatar: string | null; admin: boolean }>;
  /** You can rename the group and add or remove people. */
  isAdmin: boolean;
  name: string;
  avatar: string | null;
  state: 'accepted' | 'request' | 'blocked' | 'left';
  last: { text: string; sentAt: string; mine: boolean } | null;
  unread: number;
  verified: boolean;
  /** The contact's safety number changed since you last looked. */
  keyChanged: boolean;
}

export interface DirectMessageView {
  id: string;
  peer: string;
  sender: string;
  senderName: string;
  mine: boolean;
  text: string;
  replyTo: string | null;
  attachments: AttachmentPointer[];
  sentAt: string;
  editedAt: string | null;
  deleted: boolean;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  reactions: Array<{ emoji: string; count: number; mine: boolean; users: string[] }>;
}

export interface FileView {
  pointer: AttachmentPointer;
  /** Conversation (person or group) or 'post'. */
  where: string;
  whereName: string;
  fromName: string;
  mine: boolean;
  sentAt: string;
}

export interface CallView {
  id: string;
  peer: string;
  name: string;
  avatar: string | null;
  direction: 'in' | 'out';
  video: boolean;
  answered: boolean;
  durationSec: number;
  startedAt: string;
}

export type DmEvent =
  | { t: 'conversations'; conversations: ConversationView[] }
  | { t: 'message'; message: DirectMessageView; isNew: boolean; senderName: string }
  | { t: 'remove'; peer: string; id: string }
  | { t: 'typing'; peer: string; who?: string }
  | { t: 'focus'; peer: string }
  | {
      t: 'call';
      peer: string;
      callId: string;
      kind: 'invite' | 'accept' | 'decline' | 'end' | 'signal' | 'busy';
      video: boolean;
      data?: unknown;
    };

const id = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const riverId = z.uuid();
/** A conversation: a person's River ID or a group ID. */
const conv = z.union([riverId, id]);

export const dmActionSchema = z.discriminatedUnion('a', [
  z.object({ a: z.literal('conversations') }).strict(),
  z.object({ a: z.literal('messages'), peer: conv }).strict(),
  z
    .object({
      a: z.literal('open'),
      peer: riverId,
      name: z.string().trim().min(1).max(64).optional(),
    })
    .strict(),
  z
    .object({
      a: z.literal('send'),
      peer: conv,
      text: z.string().max(4000),
      replyTo: id.optional(),
      attachments: z.array(attachmentPointerSchema).max(10).optional(),
    })
    .strict()
    .refine((v) => v.text.trim().length > 0 || (v.attachments?.length ?? 0) > 0, 'empty'),
  z
    .object({
      a: z.literal('edit'),
      peer: conv,
      id,
      text: z
        .string()
        .max(4000)
        .refine((s) => s.trim().length > 0),
    })
    .strict(),
  z.object({ a: z.literal('delete'), peer: conv, id, forEveryone: z.boolean() }).strict(),
  z
    .object({ a: z.literal('react'), peer: conv, id, emoji: z.string().min(1).max(32), on: z.boolean() })
    .strict(),
  z.object({ a: z.literal('read'), peer: conv }).strict(),
  z.object({ a: z.literal('typing'), peer: conv }).strict(),
  z.object({ a: z.literal('accept'), peer: conv }).strict(),
  z.object({ a: z.literal('block'), peer: riverId }).strict(),
  z.object({ a: z.literal('unblock'), peer: riverId }).strict(),
  z.object({ a: z.literal('removeConversation'), peer: conv }).strict(),
  z.object({ a: z.literal('safetyNumber'), peer: riverId }).strict(),
  z.object({ a: z.literal('setVerified'), peer: riverId, verified: z.boolean() }).strict(),
  z.object({ a: z.literal('acknowledgeKeyChange'), peer: riverId }).strict(),
  z
    .object({
      a: z.literal('upload'),
      name: z.string().min(1).max(255),
      mime: z.string().max(100),
      bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array && v.byteLength <= MAX_ATTACHMENT_BYTES),
      width: z.number().int().min(1).max(20_000).optional(),
      height: z.number().int().min(1).max(20_000).optional(),
      thumb: z.string().max(3000).optional(),
    })
    .strict(),
  z.object({ a: z.literal('myId') }).strict(),
  /** Every file shared in conversations and posts on this device. */
  z.object({ a: z.literal('files') }).strict(),
  /** Records a finished, missed or declined call. */
  z
    .object({
      a: z.literal('logCall'),
      peer: riverId,
      direction: z.enum(['in', 'out']),
      video: z.boolean(),
      answered: z.boolean(),
      durationSec: z
        .number()
        .int()
        .min(0)
        .max(7 * 86_400),
    })
    .strict(),
  z.object({ a: z.literal('calls') }).strict(),
  /** Searches all conversations on this device. */
  z.object({ a: z.literal('search'), query: z.string().trim().min(2).max(100) }).strict(),
  z
    .object({
      a: z.literal('createGroup'),
      name: z.string().trim().min(1).max(64),
      members: z.array(riverId).min(1).max(31),
    })
    .strict(),
  z.object({ a: z.literal('renameGroup'), peer: id, name: z.string().trim().min(1).max(64) }).strict(),
  z.object({ a: z.literal('addGroupMembers'), peer: id, members: z.array(riverId).min(1).max(31) }).strict(),
  z.object({ a: z.literal('removeGroupMember'), peer: id, member: riverId }).strict(),
  z.object({ a: z.literal('leaveGroup'), peer: id }).strict(),
  z
    .object({
      a: z.literal('call'),
      peer: riverId,
      callId: id,
      kind: z.enum(['invite', 'accept', 'decline', 'end', 'signal', 'busy']),
      video: z.boolean().optional(),
      /** WebRTC session description / ICE candidate. */
      data: z.unknown().optional(),
    })
    .strict(),
]);

export type DmAction = z.input<typeof dmActionSchema>;

interface DmResults {
  conversations: ConversationView[];
  messages: DirectMessageView[];
  open: ConversationView;
  send: DirectMessageView;
  safetyNumber: { digits: string; verified: boolean; theirName: string };
  upload: AttachmentPointer;
  myId: string;
  createGroup: ConversationView;
  search: DirectMessageView[];
  files: FileView[];
  calls: CallView[];
}

export type DmActionResult<A extends DmAction> = A['a'] extends keyof DmResults ? DmResults[A['a']] : null;
