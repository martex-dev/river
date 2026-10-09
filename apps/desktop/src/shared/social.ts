import { z } from 'zod';
import { attachmentPointerSchema, type AttachmentPointer } from './community-actions.ts';

/**
 * Social: posts and 24-hour stories shared with your accepted contacts (or
 * people you pick). Each post is end-to-end encrypted to every person in its
 * audience over libsignal; the server only relays ciphertext.
 */

export interface PostView {
  id: string;
  author: string;
  authorName: string;
  authorAvatar: string | null;
  mine: boolean;
  kind: 'post' | 'story';
  text: string;
  attachments: AttachmentPointer[];
  createdAt: string;
  expiresAt: string | null;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  comments: Array<{
    id: string;
    author: string;
    authorName: string;
    text: string;
    createdAt: string;
    mine: boolean;
  }>;
  /** For your own posts: how many people it was shared with. */
  audience: number;
  /** For your own stories: who has seen them. */
  viewers: Array<{ riverId: string; name: string }>;
  /** For others' stories: whether you have seen it. */
  seen: boolean;
}

export interface ProfileView {
  riverId: string;
  name: string;
  avatar: string | null;
  bio: string;
  isMe: boolean;
  isContact: boolean;
  posts: PostView[];
}

export interface FeedView {
  posts: PostView[];
  /** Active stories grouped by person, people with unseen stories first. */
  stories: Array<{
    riverId: string;
    name: string;
    avatar: string | null;
    mine: boolean;
    stories: PostView[];
    unseen: boolean;
  }>;
  friends: Array<{ riverId: string; name: string; avatar: string | null }>;
}

export type SocialEvent = { t: 'feed' };

const id = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const riverId = z.uuid();

export const socialActionSchema = z.discriminatedUnion('a', [
  z.object({ a: z.literal('feed') }).strict(),
  z
    .object({
      a: z.literal('post'),
      kind: z.enum(['post', 'story']),
      text: z.string().max(2000),
      attachments: z.array(attachmentPointerSchema).max(10),
      /** 'friends' = all accepted contacts, or a chosen list. */
      audience: z.union([z.literal('friends'), z.array(riverId).min(1).max(500)]),
    })
    .strict()
    .refine((v) => v.text.trim().length > 0 || v.attachments.length > 0, 'empty'),
  z.object({ a: z.literal('deletePost'), postId: id }).strict(),
  z.object({ a: z.literal('react'), postId: id, emoji: z.string().min(1).max(32), on: z.boolean() }).strict(),
  z
    .object({
      a: z.literal('comment'),
      postId: id,
      text: z
        .string()
        .max(1000)
        .refine((s) => s.trim().length > 0),
    })
    .strict(),
  z.object({ a: z.literal('seen'), postId: id }).strict(),
  z.object({ a: z.literal('profile'), riverId: riverId.optional() }).strict(),
  z.object({ a: z.literal('setBio'), bio: z.string().max(300) }).strict(),
]);

export type SocialAction = z.input<typeof socialActionSchema>;

interface SocialResults {
  feed: FeedView;
  post: PostView;
  profile: ProfileView;
}

export type SocialActionResult<A extends SocialAction> = A['a'] extends keyof SocialResults
  ? SocialResults[A['a']]
  : null;
