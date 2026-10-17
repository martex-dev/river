import { z } from 'zod';
import {
  attachmentPointerSchema,
  MAX_ATTACHMENT_BYTES,
  linkEmbedSchema,
  pollInputSchema,
  type AttachmentPointer,
} from './community-actions.ts';
import type { Poll } from './poll.ts';

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
  /** A group's emoji (1.0.25). */
  icon?: string | null;
  state: 'accepted' | 'request' | 'blocked' | 'left';
  /** You started this conversation and they have not answered yet (a sent friend request). */
  awaitingReply: boolean;
  last: { text: string; sentAt: string; mine: boolean } | null;
  unread: number;
  verified: boolean;
  /** The contact's safety number changed since you last looked. */
  keyChanged: boolean;
  /**
   * You verified this contact and their safety number changed since: River sends them nothing
   * until you compare safety numbers again (2.11).
   */
  verifiedChanged?: boolean;
  /** Disappearing messages timer in seconds (0 = off), 2.4. */
  timer?: number;
  /** Chat-list flags (2.1), kept on this device: pinned to the top, archived, marked unread. */
  pinned?: boolean;
  archived?: boolean;
  markedUnread?: boolean;
  /**
   * Note to self (2.9): your own notes. Kept on this device and copied to your linked devices;
   * nothing is sent to anyone else.
   */
  self?: boolean;
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
  /** Pinned in this conversation (1.0.29). */
  pinned?: boolean;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  reactions: Array<{ emoji: string; count: number; mine: boolean; users: string[] }>;
  /** When this device deletes the message (disappearing messages, 2.4). */
  expiresAt?: string | null;
  /** Sent without sound (2.5). */
  silent?: boolean;
  /** A poll (2.10.4); votes are encrypted reactions, as in channels. */
  poll?: Poll | null;
  /** A link preview made by the sender's app (2.10.6); readers never fetch anything. */
  embed?: z.infer<typeof linkEmbedSchema> | null;
  /** A notice in the conversation instead of a message, e.g. the disappearing-messages timer. */
  notice?: { timer: number } | null;
  /** Group members your message could not be delivered to (everyone else got it). */
  undeliveredTo?: string[];
}

/** A message waiting on this device to be sent later (2.5). */
export interface ScheduledView {
  id: string;
  peer: string;
  text: string;
  attachments: AttachmentPointer[];
  sendAt: string;
  silent: boolean;
  /** The last attempt failed (the device was offline); it is tried again. */
  failed: boolean;
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

/** How a call ended: answered, missed (no answer), declined, or answered but never connected. */
export type CallOutcome = 'answered' | 'missed' | 'declined' | 'failed';

export interface CallView {
  id: string;
  peer: string;
  name: string;
  avatar: string | null;
  direction: 'in' | 'out';
  video: boolean;
  answered: boolean;
  outcome: CallOutcome;
  durationSec: number;
  startedAt: string;
}

/** A chat folder (2.10.8): a named set of conversations, kept on this device. */
export interface ChatFolder {
  id: string;
  name: string;
  peers: string[];
}
export const MAX_FOLDERS = 10;

export type DmEvent =
  | { t: 'conversations'; conversations: ConversationView[] }
  | { t: 'message'; message: DirectMessageView; isNew: boolean; senderName: string }
  | { t: 'remove'; peer: string; id: string }
  | { t: 'typing'; peer: string; who?: string }
  | { t: 'focus'; peer: string }
  /** The list of messages waiting to be sent later changed (2.5). */
  | { t: 'scheduled' }
  /** A call was added to the call history. */
  | { t: 'calls' }
  | {
      t: 'call';
      peer: string;
      callId: string;
      /** `elsewhere` (2.11.1): answered or declined on another of your devices — stop ringing here. */
      kind: 'invite' | 'accept' | 'decline' | 'end' | 'signal' | 'busy' | 'elsewhere';
      video: boolean;
      data?: unknown;
    };

const id = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const riverId = z.uuid();
/** A conversation: a person's River ID or a group ID. */
const conv = z.union([riverId, id]);

/** Disappearing messages: the longest timer (4 weeks), and the choices offered. */
export const MAX_TIMER = 28 * 86_400;
export const TIMER_CHOICES = [0, 30, 300, 3600, 28_800, 86_400, 604_800, MAX_TIMER] as const;

/** "30 seconds", "1 hour", "1 week"… */
export function timerLabel(seconds: number): string {
  if (!seconds) return 'Off';
  const units: Array<[number, string]> = [
    [604_800, 'week'],
    [86_400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];
  for (const [size, name] of units) {
    if (seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  return `${seconds} seconds`;
}

export const dmActionSchema = z.discriminatedUnion('a', [
  z.object({ a: z.literal('conversations') }).strict(),
  z
    .object({
      a: z.literal('messages'),
      peer: conv,
      /** Also every message since this time (2.10.7: jump to a date or an older search result). */
      since: z.iso.datetime().optional(),
    })
    .strict(),
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
      /** Send without sound: the other side gets no notification (2.5). */
      silent: z.boolean().optional(),
      /** Make this message a poll (2.10.4); `text` is shown by apps without polls. */
      poll: pollInputSchema.optional(),
      /** A link preview made on this device, if you turned previews on (2.10.6). */
      embed: linkEmbedSchema.optional(),
    })
    .strict()
    .refine((v) => v.text.trim().length > 0 || (v.attachments?.length ?? 0) > 0, 'empty'),
  /** Send later (2.5): kept encrypted on this device and sent at `sendAt` while it is online. */
  z
    .object({
      a: z.literal('schedule'),
      peer: conv,
      text: z.string().max(4000),
      replyTo: id.optional(),
      attachments: z.array(attachmentPointerSchema).max(10).optional(),
      silent: z.boolean().optional(),
      sendAt: z.iso.datetime(),
    })
    .strict()
    .refine((v) => v.text.trim().length > 0 || (v.attachments?.length ?? 0) > 0, 'empty'),
  z.object({ a: z.literal('scheduled'), peer: conv }).strict(),
  z.object({ a: z.literal('cancelScheduled'), id }).strict(),
  z.object({ a: z.literal('sendScheduledNow'), id }).strict(),
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
  /** Disappearing messages (2.4): every new message in this conversation is deleted after `seconds`. */
  z
    .object({ a: z.literal('setTimer'), peer: conv, seconds: z.number().int().min(0).max(MAX_TIMER) })
    .strict(),
  /** Pin, archive or mark a conversation unread (2.1); kept in this device's encrypted database. */
  z
    .object({
      a: z.literal('chatFlags'),
      peer: conv,
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
      markedUnread: z.boolean().optional(),
    })
    .strict(),
  z.object({ a: z.literal('typing'), peer: conv }).strict(),
  z.object({ a: z.literal('accept'), peer: conv }).strict(),
  z.object({ a: z.literal('block'), peer: riverId }).strict(),
  z.object({ a: z.literal('unblock'), peer: riverId }).strict(),
  z.object({ a: z.literal('removeConversation'), peer: conv }).strict(),
  z.object({ a: z.literal('safetyNumber'), peer: riverId }).strict(),
  /** A call that is ringing right now (River opened from its "Incoming call" notification). */
  z.object({ a: z.literal('pendingCall') }).strict(),
  /** `digits`: the safety number the user compared (required to mark as verified). */
  z
    .object({
      a: z.literal('setVerified'),
      peer: riverId,
      verified: z.boolean(),
      digits: z
        .string()
        .regex(/^\d{60}$/)
        .optional(),
    })
    .strict(),
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
  /** Chat folders (2.10.8), kept on this device. */
  z.object({ a: z.literal('folders') }).strict(),
  z
    .object({
      a: z.literal('saveFolder'),
      /** Absent: a new folder. */
      id: id.optional(),
      name: z.string().trim().min(1).max(24),
      peers: z.array(conv).max(500),
    })
    .strict(),
  z.object({ a: z.literal('deleteFolder'), id }).strict(),
  /** Opens (and creates, the first time) the Note to self conversation (2.9). */
  z.object({ a: z.literal('noteToSelf') }).strict(),
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
      /** Why an unanswered call ended, when the window knows (a call you declined). */
      outcome: z.enum(['declined', 'failed']).optional(),
      durationSec: z
        .number()
        .int()
        .min(0)
        .max(7 * 86_400),
    })
    .strict(),
  z.object({ a: z.literal('calls') }).strict(),
  /** Searches all conversations on this device. */
  z
    .object({
      a: z.literal('search'),
      query: z.string().trim().min(2).max(100),
      /** Only this conversation (2.2). */
      peer: conv.optional(),
    })
    .strict(),
  z
    .object({
      a: z.literal('createGroup'),
      name: z.string().trim().min(1).max(64),
      members: z.array(riverId).min(1).max(31),
    })
    .strict(),
  z.object({ a: z.literal('pin'), peer: conv, id, pinned: z.boolean() }).strict(),
  z.object({ a: z.literal('renameGroup'), peer: id, name: z.string().trim().min(1).max(64) }).strict(),
  z.object({ a: z.literal('setGroupIcon'), peer: id, icon: z.string().min(1).max(16).nullable() }).strict(),
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
  safetyNumber: { digits: string; verified: boolean; changedSinceVerified?: boolean; theirName: string };
  upload: AttachmentPointer;
  myId: string;
  noteToSelf: ConversationView;
  createGroup: ConversationView;
  search: DirectMessageView[];
  files: FileView[];
  calls: CallView[];
  folders: ChatFolder[];
  saveFolder: ChatFolder[];
  deleteFolder: ChatFolder[];
  schedule: ScheduledView;
  scheduled: ScheduledView[];
  /** `answer`: it was answered on the phone's own call screen (Android, 2.11), so the window answers it. */
  pendingCall: (Extract<DmEvent, { t: 'call' }> & { answer?: boolean }) | null;
}

export type DmActionResult<A extends DmAction> = A['a'] extends keyof DmResults ? DmResults[A['a']] : null;
