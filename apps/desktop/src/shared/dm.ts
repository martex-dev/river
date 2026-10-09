import { z } from 'zod';
import {
  attachmentPointerSchema,
  MAX_ATTACHMENT_BYTES,
  type AttachmentPointer,
} from './community-actions.ts';

/** Direct messages as the renderer sees them (decrypted in main). */

export interface ConversationView {
  riverId: string;
  name: string;
  avatar: string | null;
  state: 'accepted' | 'request' | 'blocked';
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

export type DmEvent =
  | { t: 'conversations'; conversations: ConversationView[] }
  | { t: 'message'; message: DirectMessageView; isNew: boolean; senderName: string }
  | { t: 'remove'; peer: string; id: string }
  | { t: 'typing'; peer: string }
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

export const dmActionSchema = z.discriminatedUnion('a', [
  z.object({ a: z.literal('conversations') }).strict(),
  z.object({ a: z.literal('messages'), peer: riverId }).strict(),
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
      peer: riverId,
      text: z.string().max(4000),
      replyTo: id.optional(),
      attachments: z.array(attachmentPointerSchema).max(10).optional(),
    })
    .strict()
    .refine((v) => v.text.trim().length > 0 || (v.attachments?.length ?? 0) > 0, 'empty'),
  z
    .object({
      a: z.literal('edit'),
      peer: riverId,
      id,
      text: z
        .string()
        .max(4000)
        .refine((s) => s.trim().length > 0),
    })
    .strict(),
  z.object({ a: z.literal('delete'), peer: riverId, id, forEveryone: z.boolean() }).strict(),
  z
    .object({ a: z.literal('react'), peer: riverId, id, emoji: z.string().min(1).max(32), on: z.boolean() })
    .strict(),
  z.object({ a: z.literal('read'), peer: riverId }).strict(),
  z.object({ a: z.literal('typing'), peer: riverId }).strict(),
  z.object({ a: z.literal('accept'), peer: riverId }).strict(),
  z.object({ a: z.literal('block'), peer: riverId }).strict(),
  z.object({ a: z.literal('unblock'), peer: riverId }).strict(),
  z.object({ a: z.literal('removeConversation'), peer: riverId }).strict(),
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
}

export type DmActionResult<A extends DmAction> = A['a'] extends keyof DmResults ? DmResults[A['a']] : null;
