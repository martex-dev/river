import type { ActivitySummary } from './insights.ts';
import { POLL_LIMITS } from './poll.ts';
import { z } from 'zod';
import type { AuditView, ChatMessage } from './ipc.ts';
import { communityIconSchema } from './templates.ts';

/**
 * Community operations the renderer may request. Main parses every request
 * with this schema before acting, so the (untrusted) renderer can only ask
 * for these shapes; the server enforces permissions on top.
 */
const id = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const riverId = z.uuid();
const name = z.string().trim().min(1).max(64);
const soundName = z.string().trim().min(1).max(32);
/** A community picture or banner (1.0.29). */
export const ART_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
/** A sticker picture (1.0.24): PNG, WebP or GIF as a data URL. */
export const STICKER_IMAGE = /^data:image\/(png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
/** A link preview (1.0.23). */
export const linkEmbedSchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .regex(/^https?:\/\//),
    title: z.string().min(1).max(200),
    description: z.string().max(300),
    site: z.string().max(80),
  })
  .strict();
/** A forum tag (1.0.22). */
const forumTag = z.string().trim().min(1).max(24);
export const MAX_FORUM_TAGS = 20;
/** A soundboard clip as a data URL (1.0.22): mp3, ogg, wav or webm, at most 160 KB. */
export const SOUND_DATA_URL = /^data:audio\/(mpeg|ogg|wav|webm|x-wav);base64,[A-Za-z0-9+/]+=*$/;
export const SOUND_MAX_BYTES = 160 * 1024;
export const SOUND_AUDIO_CHARS = Math.ceil((SOUND_MAX_BYTES * 4) / 3) + 64;
/** A role icon: one emoji (a few code points), 1.0.21. */
const roleIcon = z.string().min(1).max(16);
/** How far back a ban may delete someone's messages (matches the server's list, 1.0.21). */
export const BAN_DELETE_CHOICES = [0, 3600, 6 * 3600, 24 * 3600, 3 * 24 * 3600, 7 * 24 * 3600] as const;
/** Temporary ban lengths (matches the server, 1.0.22). */
export const BAN_DURATIONS = [3600, 24 * 3600, 7 * 24 * 3600, 30 * 24 * 3600] as const;
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
  .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/);

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
/** A poll as sent (1.0.18 in channels, 2.10.4 in direct messages and groups). */
export const pollInputSchema = z
  .object({
    question: z.string().trim().min(1).max(POLL_LIMITS.question),
    options: z
      .array(z.string().trim().min(1).max(POLL_LIMITS.option))
      .min(POLL_LIMITS.minOptions)
      .max(POLL_LIMITS.maxOptions),
    multi: z.boolean(),
    endsAt: z
      .string()
      .max(40)
      .refine((v) => !Number.isNaN(Date.parse(v))),
  })
  .strict();

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

/** Custom emoji names: 2–32 letters, digits or underscores. */
export const EMOJI_NAME = /^[A-Za-z0-9_]{2,32}$/;

const eventTime = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be a time');

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
  // Onboarding (1.0.24): rules and welcome note sealed; screening and self-assignable roles enforced by the server.
  z
    .object({
      a: z.literal('updateOnboarding'),
      communityId: id,
      rules: z.array(z.string().trim().min(1).max(300)).max(20),
      welcome: z.string().max(1000),
      screening: z.boolean(),
      selfRoles: z.array(id).max(25),
    })
    .strict(),
  z.object({ a: z.literal('acceptRules'), communityId: id }).strict(),
  /** The community's picture and banner (1.0.29); omitted: keep, null: remove. */
  z
    .object({
      a: z.literal('updateArt'),
      communityId: id,
      icon: z.string().max(60_000).regex(ART_IMAGE).nullable().optional(),
      banner: z.string().max(110_000).regex(ART_IMAGE).nullable().optional(),
    })
    .strict(),
  /** The word filter (1.0.28), sealed with the rules. */
  z
    .object({
      a: z.literal('updateFilter'),
      communityId: id,
      words: z.array(z.string().trim().min(1).max(60)).max(200),
      mode: z.enum(['hide', 'block']),
    })
    .strict(),
  z.object({ a: z.literal('setSelfRoles'), communityId: id, roles: z.array(id).max(25) }).strict(),
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
      /** A forum channel (1.0.22). */
      forum: z.boolean().optional(),
      /** A stage channel (1.0.22). */
      stage: z.boolean().optional(),
      /** A media channel (1.0.26). */
      media: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      a: z.literal('updateChannel'),
      channelId: id,
      name: name.optional(),
      topic: z.string().max(300).optional(),
      overwrites: overwrites.optional(),
      /** true: use the category's permissions again. */
      synced: z.boolean().optional(),
      announcement: z.boolean().optional(),
      slowmode: z.number().int().min(0).max(21_600).optional(),
      userLimit: z.number().int().min(0).max(99).optional(),
      forum: z.boolean().optional(),
      stage: z.boolean().optional(),
      media: z.boolean().optional(),
      nsfw: z.boolean().optional(),
      tags: z.array(forumTag).max(MAX_FORUM_TAGS).optional(),
    })
    .strict(),
  z.object({ a: z.literal('moveChannel'), channelId: id, direction }).strict(),
  /** A copy with the same kind, category, permissions and settings (1.0.20); no messages. */
  z.object({ a: z.literal('duplicateChannel'), channelId: id, name }).strict(),
  z.object({ a: z.literal('deleteChannel'), channelId: id }).strict(),
  z.object({ a: z.literal('bulkDelete'), channelId: id, messageIds: z.array(id).min(1).max(100) }).strict(),
  z.object({ a: z.literal('createThread'), channelId: id, messageId: id, name }).strict(),
  z
    .object({
      a: z.literal('updateThread'),
      channelId: id,
      messageId: id,
      name: name.optional(),
      archived: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      a: z.literal('threadMessages'),
      channelId: id,
      messageId: id,
      before: z.iso.datetime().optional(),
    })
    .strict(),
  z.object({ a: z.literal('createCategory'), communityId: id, name }).strict(),
  z.object({ a: z.literal('renameCategory'), communityId: id, categoryId: id, name }).strict(),
  z.object({ a: z.literal('deleteCategory'), communityId: id, categoryId: id }).strict(),
  z.object({ a: z.literal('categoryPermissions'), communityId: id, categoryId: id, overwrites }).strict(),
  /** Time a member out until a moment, or end it with null. */
  z
    .object({ a: z.literal('timeout'), communityId: id, riverId, until: z.iso.datetime().nullable() })
    .strict(),
  z.object({ a: z.literal('audit'), communityId: id, before: z.iso.datetime().optional() }).strict(),
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
  /** Your name in one community (null: use your River name). */
  z.object({ a: z.literal('setNickname'), communityId: id, nickname: name.nullable() }).strict(),
  /** Keep an unsent message on this device until it is delivered (survives restarts). */
  z
    .object({
      a: z.literal('outboxSave'),
      localId: z.string().regex(/^local-[0-9]+-[0-9]+$/),
      channelId: id,
      text: z.string().max(4000),
      replyTo: id.optional(),
      threadId: id.optional(),
      attachments: z.array(attachmentPointerSchema).max(10).optional(),
      /** A reply that should not notify the person replied to: kept across restarts. */
      noPing: z.boolean().optional(),
      createdAt: z.iso.datetime(),
    })
    .strict(),
  z.object({ a: z.literal('outboxDelete'), localId: z.string().max(64) }).strict(),
  z.object({ a: z.literal('outboxList') }).strict(),
  /** Reconnect to the server right away instead of waiting for the next attempt. */
  z.object({ a: z.literal('reconnect') }).strict(),
  /** Mark a channel unread from a message on (that message and later ones count as new). */
  z.object({ a: z.literal('markUnread'), channelId: id, from: z.iso.datetime() }).strict(),
  /** You have seen this channel up to now. */
  z.object({ a: z.literal('markRead'), channelId: id }).strict(),
  z
    .object({
      a: z.literal('createRole'),
      communityId: id,
      name,
      color,
      permissions,
      mentionable: z.boolean().optional(),
      hoist: z.boolean().optional(),
      icon: roleIcon.nullable().optional(),
    })
    .strict(),
  z
    .object({
      a: z.literal('updateRole'),
      communityId: id,
      roleId: id,
      name: name.optional(),
      color: color.optional(),
      permissions: permissions.optional(),
      mentionable: z.boolean().optional(),
      hoist: z.boolean().optional(),
      icon: roleIcon.nullable().optional(),
    })
    .strict(),
  z.object({ a: z.literal('moveRole'), communityId: id, roleId: id, direction }).strict(),
  /** Drag a role to just above another one, or to the bottom with null (1.0.30). */
  z.object({ a: z.literal('placeRole'), communityId: id, roleId: id, aboveId: id.nullable() }).strict(),
  z.object({ a: z.literal('deleteRole'), communityId: id, roleId: id }).strict(),
  z.object({ a: z.literal('setMemberRoles'), communityId: id, riverId, roles: z.array(id).max(50) }).strict(),
  /** Give a role for a while (1.0.30). */
  z
    .object({
      a: z.literal('giveTempRole'),
      communityId: id,
      riverId,
      roleId: id,
      seconds: z.union([z.literal(3600), z.literal(86_400), z.literal(604_800), z.literal(2_592_000)]),
    })
    .strict(),
  z.object({ a: z.literal('kick'), communityId: id, riverId }).strict(),
  z
    .object({
      a: z.literal('ban'),
      communityId: id,
      riverId,
      /** Ban only for this long (1.0.22); absent = for good. */
      durationSeconds: z
        .number()
        .int()
        .refine((n) => (BAN_DURATIONS as readonly number[]).includes(n))
        .optional(),
      /** Also delete their messages from this many seconds back (1.0.21). */
      deleteMessagesSeconds: z
        .number()
        .int()
        .refine((n) => (BAN_DELETE_CHOICES as readonly number[]).includes(n))
        .optional(),
    })
    .strict(),
  z.object({ a: z.literal('unban'), communityId: id, riverId }).strict(),
  z.object({ a: z.literal('bans'), communityId: id }).strict(),
  /** Invites with who made them and who joined with them (1.0.31). */
  z.object({ a: z.literal('invites'), communityId: id }).strict(),
  /** Incoming webhooks (1.0.32, ADR 0004). */
  z
    .object({
      a: z.literal('createWebhook'),
      communityId: id,
      channelId: id,
      name: z.string().trim().min(1).max(40),
    })
    .strict(),
  z.object({ a: z.literal('revokeWebhook'), communityId: id, webhookId: id }).strict(),
  z.object({ a: z.literal('revokeInvite'), communityId: id, inviteId: z.string().max(64) }).strict(),
  z
    .object({
      a: z.literal('send'),
      channelId: id,
      text: z.string().max(4000),
      replyTo: id.optional(),
      attachments: z.array(attachmentPointerSchema).max(10).optional(),
      /** Descriptions of attached pictures, by attachment ID (1.0.21). */
      alts: z.record(id, z.string().trim().max(1000)).optional(),
      /** Send a community sticker (1.0.24); `text` may be empty. */
      sticker: id.optional(),
      /** A link preview made on this device (1.0.23). */
      embed: linkEmbedSchema.optional(),
      /** Start a forum post with this title (1.0.22). */
      title: z.string().trim().min(1).max(100).optional(),
      /** Forum post tags (1.0.22). */
      tags: z.array(forumTag).max(5).optional(),
      /** Reply inside the thread started from this message. */
      threadId: id.optional(),
      /** A reply that should not notify the person replied to (1.0.18). */
      noPing: z.boolean().optional(),
      /** Make this message a poll (1.0.18); `text` is the question. */
      poll: pollInputSchema.optional(),
    })
    .strict()
    .refine((v) => v.text.trim().length > 0 || (v.attachments?.length ?? 0) > 0 || !!v.sticker, 'empty'),
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
  // Favourite GIFs and pictures (1.0.25): kept on this device only.
  z.object({ a: z.literal('favoriteMedia'), pointer: attachmentPointerSchema, on: z.boolean() }).strict(),
  z.object({ a: z.literal('favoriteMediaList') }).strict(),
  z.object({ a: z.literal('removeFavorite'), id }).strict(),
  z.object({ a: z.literal('favoriteMediaBytes'), id }).strict(),
  z.object({ a: z.literal('sendFavorite'), channelId: id, id }).strict(),
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
      // Up to 64 characters so custom emoji (<:name:id>) can be reactions too.
      emoji: z.string().min(1).max(64),
      on: z.boolean(),
    })
    .strict(),
  z.object({ a: z.literal('typing'), channelId: id }).strict(),
  z
    .object({
      a: z.literal('voiceState'),
      muted: z.boolean(),
      deafened: z.boolean(),
      streaming: z.boolean(),
      handRaised: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      a: z.literal('moderateVoice'),
      riverId,
      serverMuted: z.boolean().optional(),
      serverDeafened: z.boolean().optional(),
      speaker: z.boolean().optional(),
      disconnect: z.boolean().optional(),
      moveTo: id.optional(),
    })
    .strict(),
  z
    .object({
      a: z.literal('setCommunityAvatar'),
      communityId: id,
      avatar: avatarSchema.nullable(),
    })
    .strict(),
  z
    .object({
      a: z.literal('setProfile'),
      /** Empty: no display name (it is optional, as when the identity was created). */
      name: z.string().trim().max(64).optional(),
      avatar: avatarSchema.nullable().optional(),
      /** About me (also your bio on your social profile). */
      bio: z.string().max(190).optional(),
      pronouns: z.string().max(40).optional(),
      banner: z.number().int().min(0).max(0xffffff).nullable().optional(),
    })
    .strict(),
  // Scheduled events (1.0.18): name, description and place are sealed with the community key.
  z.object({ a: z.literal('events'), communityId: id }).strict(),
  z
    .object({
      a: z.literal('createEvent'),
      communityId: id,
      name: z.string().trim().min(1).max(100),
      description: z.string().max(1000),
      place: z.string().max(200),
      startsAt: eventTime,
      endsAt: eventTime,
      channelId: id.nullable(),
    })
    .strict(),
  z
    .object({
      a: z.literal('updateEvent'),
      eventId: id,
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(1000).optional(),
      place: z.string().max(200).optional(),
      startsAt: eventTime.optional(),
      endsAt: eventTime.optional(),
      channelId: id.nullable().optional(),
      canceled: z.boolean().optional(),
    })
    .strict(),
  z.object({ a: z.literal('deleteEvent'), eventId: id }).strict(),
  z.object({ a: z.literal('eventInterest'), eventId: id, on: z.boolean() }).strict(),
  // Custom emoji (1.0.19): name and image are sealed with the community key.
  z.object({ a: z.literal('emojis'), communityId: id }).strict(),
  z
    .object({
      a: z.literal('addEmoji'),
      communityId: id,
      name: z.string().regex(EMOJI_NAME),
      image: z
        .string()
        .max(90_000)
        .regex(/^data:image\/(png|webp|gif);base64,[A-Za-z0-9+/]+=*$/),
    })
    .strict(),
  z.object({ a: z.literal('deleteEmoji'), emojiId: id }).strict(),
  z
    .object({ a: z.literal('renameEmoji'), communityId: id, emojiId: id, name: z.string().regex(EMOJI_NAME) })
    .strict(),
  // Reports (1.0.21): sent to the community's moderators, sealed with the community key.
  z
    .object({
      a: z.literal('report'),
      communityId: id,
      messageId: id,
      reason: z.string().trim().min(1).max(500),
      /** The message as the reporter sees it, kept with the report in case it is deleted. */
      text: z.string().max(2000),
      senderName: z.string().max(64),
    })
    .strict(),
  z.object({ a: z.literal('reports'), communityId: id }).strict(),
  /** Message activity for Insights (1.0.26), counted on this device. */
  z
    .object({ a: z.literal('activity'), communityId: id, days: z.union([z.literal(7), z.literal(30)]) })
    .strict(),
  // Stickers (1.0.24): name and picture sealed with the community key.
  z.object({ a: z.literal('stickers'), communityId: id }).strict(),
  z
    .object({
      a: z.literal('addSticker'),
      communityId: id,
      name: z.string().trim().min(1).max(30),
      image: z.string().max(190_000).regex(STICKER_IMAGE),
    })
    .strict(),
  z.object({ a: z.literal('deleteSticker'), stickerId: id }).strict(),
  // Moderator notes (1.0.23): sealed with the community key, listed only to moderators.
  z.object({ a: z.literal('notes'), communityId: id, riverId }).strict(),
  z
    .object({ a: z.literal('addNote'), communityId: id, riverId, text: z.string().trim().min(1).max(1000) })
    .strict(),
  z.object({ a: z.literal('deleteNote'), noteId: id }).strict(),
  // Soundboard (1.0.22): name, emoji and clip sealed with the community key.
  z.object({ a: z.literal('sounds'), communityId: id }).strict(),
  z
    .object({
      a: z.literal('addSound'),
      communityId: id,
      name: soundName,
      emoji: z.string().min(1).max(16).nullable(),
      audio: z.string().max(SOUND_AUDIO_CHARS).regex(SOUND_DATA_URL),
    })
    .strict(),
  z
    .object({
      a: z.literal('updateSound'),
      communityId: id,
      soundId: id,
      name: soundName.optional(),
      emoji: z.string().min(1).max(16).nullable().optional(),
    })
    .strict(),
  z.object({ a: z.literal('deleteSound'), soundId: id }).strict(),
  z.object({ a: z.literal('playSound'), soundId: id }).strict(),
  z
    .object({ a: z.literal('updateReport'), reportId: id, status: z.enum(['open', 'resolved', 'dismissed']) })
    .strict(),
  // Saved messages (1.0.19): kept only on this device.
  z.object({ a: z.literal('savedMessages') }).strict(),
  z.object({ a: z.literal('transferOwnership'), communityId: id, riverId }).strict(),
  z.object({ a: z.literal('saveMessage'), channelId: id, messageId: id, on: z.boolean() }).strict(),
]);

/** A message you saved for later (1.0.19). */
export interface SavedMessageView {
  messageId: string;
  communityId: string;
  channelId: string;
  senderName: string;
  text: string;
  sentAt: string;
  savedAt: string;
}

/** A community's custom emoji, decrypted (1.0.19). Used in text as `<:name:id>`. */
export interface ReportView {
  id: string;
  channelId: string;
  messageId: string;
  reporter: string;
  reporterName: string;
  target: string;
  targetName: string;
  reason: string;
  /** The reported message as the reporter saw it (they could have changed it; check the original if it still exists). */
  text: string;
  status: 'open' | 'resolved' | 'dismissed';
  resolvedBy: string | null;
  resolvedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const REPORT_REASONS = [
  'Spam',
  'Harassment or hate',
  'Inappropriate content',
  'Scam or phishing',
  'Something else',
];

export interface FavoriteMediaView {
  id: string;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
}

/** Most favourites, and the largest file kept as one (1.0.25). */
export const MAX_FAVORITE_MEDIA = 100;
export const MAX_FAVORITE_BYTES = 8 * 1024 * 1024;

export interface StickerView {
  id: string;
  name: string;
  image: string;
}

export interface NoteView {
  id: string;
  author: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface SoundView {
  id: string;
  name: string;
  emoji: string | null;
  /** data: URL of the clip. */
  audio: string;
}

export interface EmojiView {
  id: string;
  name: string;
  image: string;
}

/** A scheduled event, decrypted (1.0.18). */
export interface EventView {
  id: string;
  communityId: string;
  createdBy: string;
  name: string;
  description: string;
  /** Where, when it is not a voice channel ("Our usual café"). */
  place: string;
  startsAt: string;
  endsAt: string;
  channelId: string | null;
  canceled: boolean;
  interested: string[];
}

export type CommunityAction = z.input<typeof communityActionSchema>;

export interface InviteView {
  id: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: string | null;
  expiresAt: string;
  uses: number;
  maxUses: number;
  joined: string[];
}

export interface BanView {
  riverId: string;
  name: string;
  bannedOn: string;
  /** When a temporary ban ends, or null. */
  until: string | null;
}

interface Results {
  createRole: string;
  /** The secret webhook address, shown once. */
  createWebhook: string;
  invites: InviteView[];
  activity: ActivitySummary;
  favoriteMediaList: FavoriteMediaView[];
  favoriteMediaBytes: Uint8Array;
  stickers: StickerView[];
  addSticker: string;
  notes: NoteView[];
  addNote: string;
  sounds: SoundView[];
  addSound: string;
  report: string;
  reports: ReportView[];
  duplicateChannel: string;
  createCategory: string;
  outboxList: SavedOutgoing[];
  audit: AuditView[];
  bans: BanView[];
  send: ChatMessage;
  sendFavorite: ChatMessage;
  pins: ChatMessage[];
  upload: AttachmentPointer;
  history: ChatMessage[];
  threadMessages: ChatMessage[];
  search: ChatMessage[];
  download: Uint8Array;
  events: EventView[];
  createEvent: string;
  emojis: EmojiView[];
  addEmoji: string;
  savedMessages: SavedMessageView[];
}

export type CommunityActionResult<A extends CommunityAction> = A['a'] extends keyof Results
  ? Results[A['a']]
  : null;

/** An unsent message as kept on this device. */
export interface SavedOutgoing {
  localId: string;
  channelId: string;
  text: string;
  replyTo?: string;
  threadId?: string;
  attachments?: AttachmentPointer[];
  noPing?: boolean;
  createdAt: string;
}
