import { randomBytes } from 'node:crypto';
import type { AttachmentPointer } from '../../shared/community-actions.ts';
import {
  socialActionSchema,
  type FeedView,
  type PostView,
  type ProfileView,
  type SocialAction,
  type SocialActionResult,
  type SocialEvent,
} from '../../shared/social.ts';
import { CommunityError } from '../community/community-service.ts';
import type { DmService, SocialContent } from '../dm/dm-service.ts';
import type { IdentityService } from '../identity/identity-service.ts';
import type { Logger } from '../logger.ts';
import type { LocalDatabase } from '../storage/database.ts';

const STORY_MS = 24 * 60 * 60 * 1000;
const RELAY_DELAY_MS = 1500;

interface PostRow {
  id: string;
  author: string;
  kind: 'post' | 'story';
  body: string;
  audience: string;
  created_at: string;
  expires_at: string | null;
  seen: number;
}

interface Deps {
  db: () => LocalDatabase | null;
  identity: IdentityService;
  dm: DmService;
  log: Logger;
}

/**
 * Posts and stories. Each post is sent to every person in its audience as a
 * libsignal message; comments and reactions go to the author, whose River
 * relays a snapshot back to the audience. Nothing here is visible to the server.
 */
export class SocialService {
  private readonly deps: Deps;
  private readonly listeners = new Set<(e: SocialEvent) => void>();
  private readonly relayTimers = new Map<string, NodeJS.Timeout>();

  constructor(deps: Deps) {
    this.deps = deps;
    deps.dm.setSocialHandler((peer, content) => {
      try {
        this.receive(peer, content);
      } catch (err) {
        deps.log.warn(`Ignored a social update: ${(err as Error).message}`);
      }
    });
  }

  onEvent(listener: (e: SocialEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of this.listeners) l({ t: 'feed' });
  }

  private db(): LocalDatabase {
    const db = this.deps.db();
    if (!db) throw new CommunityError('River is locked.');
    return db;
  }

  private me(): string {
    return this.deps.identity.get()?.riverId ?? '';
  }

  private row(id: string): PostRow | undefined {
    return this.db().prepare('SELECT * FROM posts WHERE id = ?').get(id) as PostRow | undefined;
  }

  // ---- receiving ---------------------------------------------------------------------------------

  private receive(peer: string, c: SocialContent): void {
    const me = this.me();
    switch (c.t) {
      case 'post': {
        // Only people you accepted can put posts in your feed.
        if (this.deps.dm.contactState(peer) !== 'accepted' || this.row(c.postId)) return;
        const created = Date.parse(c.createdAt);
        const now = Date.now();
        const createdAt = new Date(Math.min(created, now + 60_000)).toISOString();
        const expiresAt =
          c.kind === 'story'
            ? new Date(
                Math.min(Date.parse(c.expiresAt ?? '') || created + STORY_MS, created + STORY_MS),
              ).toISOString()
            : null;
        this.db()
          .prepare(
            'INSERT INTO posts (id, author, kind, body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            c.postId,
            peer,
            c.kind,
            JSON.stringify({ text: c.text, attachments: c.attachments }),
            createdAt,
            expiresAt,
          );
        this.deps.dm.prefetch(c.attachments);
        this.changed();
        return;
      }
      case 'postDelete': {
        const post = this.row(c.postId);
        if (post && post.author === peer) {
          this.db().prepare('DELETE FROM posts WHERE id = ?').run(c.postId);
          this.changed();
        }
        return;
      }
      case 'postReact':
      case 'postComment': {
        // Someone in the audience reacted to or commented on *our* post.
        const post = this.row(c.postId);
        if (!post || post.author !== me) return;
        if (!(JSON.parse(post.audience) as string[]).includes(peer)) return;
        if (c.t === 'postReact') this.setReaction(c.postId, peer, c.emoji, c.on);
        else {
          this.db()
            .prepare(
              'INSERT OR IGNORE INTO post_comments (id, post_id, author, author_name, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(
              c.commentId,
              c.postId,
              peer,
              this.deps.dm.person(peer).name,
              c.text,
              new Date().toISOString(),
            );
        }
        this.changed();
        this.scheduleRelay(c.postId);
        return;
      }
      case 'postActivity': {
        // The author's snapshot of comments and reactions on their post.
        const post = this.row(c.postId);
        if (!post || post.author !== peer) return;
        const db = this.db();
        db.prepare('DELETE FROM post_comments WHERE post_id = ?').run(c.postId);
        for (const cm of c.comments) {
          db.prepare(
            'INSERT OR IGNORE INTO post_comments (id, post_id, author, author_name, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          ).run(cm.id, c.postId, cm.author, cm.authorName.slice(0, 64), cm.text, cm.createdAt);
        }
        db.prepare('DELETE FROM post_reactions WHERE post_id = ?').run(c.postId);
        for (const [emoji, users] of Object.entries(c.reactions).slice(0, 50)) {
          for (const u of users) {
            db.prepare('INSERT OR IGNORE INTO post_reactions (post_id, author, emoji) VALUES (?, ?, ?)').run(
              c.postId,
              u,
              emoji,
            );
          }
        }
        this.changed();
        return;
      }
      case 'storySeen': {
        const post = this.row(c.postId);
        if (!post || post.author !== me || post.kind !== 'story') return;
        if (!(JSON.parse(post.audience) as string[]).includes(peer)) return;
        this.db()
          .prepare('INSERT OR IGNORE INTO story_views (post_id, viewer, viewed_at) VALUES (?, ?, ?)')
          .run(c.postId, peer, new Date().toISOString());
        this.changed();
        return;
      }
    }
  }

  private setReaction(postId: string, who: string, emoji: string, on: boolean): void {
    if (on) {
      this.db()
        .prepare('INSERT OR IGNORE INTO post_reactions (post_id, author, emoji) VALUES (?, ?, ?)')
        .run(postId, who, emoji);
    } else {
      this.db()
        .prepare('DELETE FROM post_reactions WHERE post_id = ? AND author = ? AND emoji = ?')
        .run(postId, who, emoji);
    }
  }

  /** After comments or reactions change on our post, send everyone in its audience the new state. */
  private scheduleRelay(postId: string): void {
    clearTimeout(this.relayTimers.get(postId));
    this.relayTimers.set(
      postId,
      setTimeout(() => {
        this.relayTimers.delete(postId);
        void this.relay(postId).catch((err: unknown) =>
          this.deps.log.warn(`Relay failed: ${(err as Error).message}`),
        );
      }, RELAY_DELAY_MS),
    );
  }

  /** Sends the current comments and reactions of one of our posts to its audience now. */
  async relay(postId: string): Promise<void> {
    const post = this.row(postId);
    if (!post || post.author !== this.me()) return;
    const view = this.view(post);
    const reactions: Record<string, string[]> = {};
    for (const r of this.db()
      .prepare('SELECT author, emoji FROM post_reactions WHERE post_id = ?')
      .all(postId) as Array<{
      author: string;
      emoji: string;
    }>) {
      (reactions[r.emoji] ??= []).push(r.author);
    }
    const content: SocialContent = {
      v: 1,
      t: 'postActivity',
      postId,
      comments: view.comments.slice(-300).map((c) => ({
        id: c.id,
        author: c.author,
        authorName: c.authorName,
        text: c.text,
        createdAt: c.createdAt,
      })),
      reactions,
    };
    for (const peer of JSON.parse(post.audience) as string[]) {
      await this.deps.dm.sendSocial(peer, content).catch(() => undefined);
    }
  }

  // ---- actions -----------------------------------------------------------------------------------

  async action<A extends SocialAction>(raw: A): Promise<SocialActionResult<A>> {
    const act = socialActionSchema.parse(raw);
    const out = <T>(v: T): SocialActionResult<A> => v as unknown as SocialActionResult<A>;
    const me = this.me();
    switch (act.a) {
      case 'feed':
        return out(this.feed());
      case 'post': {
        const audience = act.audience === 'friends' ? this.deps.dm.friends() : [...new Set(act.audience)];
        if (!audience.length) {
          throw new CommunityError('Add some contacts first: posts are shared with people you message.');
        }
        const id = randomBytes(16).toString('base64url');
        const createdAt = new Date().toISOString();
        const expiresAt = act.kind === 'story' ? new Date(Date.now() + STORY_MS).toISOString() : null;
        this.db()
          .prepare(
            'INSERT INTO posts (id, author, kind, body, audience, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            me,
            act.kind,
            JSON.stringify({ text: act.text, attachments: act.attachments }),
            JSON.stringify(audience),
            createdAt,
            expiresAt,
          );
        this.changed();
        const content: SocialContent = {
          v: 1,
          t: 'post',
          postId: id,
          kind: act.kind,
          text: act.text,
          attachments: act.attachments,
          createdAt,
          ...(expiresAt ? { expiresAt } : {}),
        };
        let delivered = 0;
        for (const peer of audience) {
          try {
            await this.deps.dm.sendSocial(peer, content);
            delivered++;
          } catch (err) {
            this.deps.log.warn(`Post not delivered to one person: ${(err as Error).message}`);
          }
        }
        if (!delivered) throw new CommunityError('The post could not be delivered to anyone.');
        return out(this.view(this.row(id)!));
      }
      case 'deletePost': {
        const post = this.row(act.postId);
        if (!post) return out(null);
        if (post.author === me) {
          for (const peer of JSON.parse(post.audience) as string[]) {
            await this.deps.dm
              .sendSocial(peer, { v: 1, t: 'postDelete', postId: post.id })
              .catch(() => undefined);
          }
        }
        this.db().prepare('DELETE FROM posts WHERE id = ?').run(act.postId);
        this.changed();
        return out(null);
      }
      case 'react': {
        const post = this.row(act.postId);
        if (!post) return out(null);
        this.setReaction(act.postId, me, act.emoji, act.on);
        this.changed();
        if (post.author === me) this.scheduleRelay(post.id);
        else
          await this.deps.dm.sendSocial(post.author, {
            v: 1,
            t: 'postReact',
            postId: post.id,
            emoji: act.emoji,
            on: act.on,
          });
        return out(null);
      }
      case 'comment': {
        const post = this.row(act.postId);
        if (!post) return out(null);
        const commentId = randomBytes(16).toString('base64url');
        this.db()
          .prepare(
            'INSERT INTO post_comments (id, post_id, author, author_name, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(
            commentId,
            post.id,
            me,
            this.deps.dm.person(me).name,
            act.text.trim(),
            new Date().toISOString(),
          );
        this.changed();
        if (post.author === me) this.scheduleRelay(post.id);
        else {
          await this.deps.dm.sendSocial(post.author, {
            v: 1,
            t: 'postComment',
            postId: post.id,
            commentId,
            text: act.text.trim(),
          });
        }
        return out(null);
      }
      case 'seen': {
        const post = this.row(act.postId);
        if (!post || post.kind !== 'story' || post.author === me || post.seen) return out(null);
        this.db().prepare('UPDATE posts SET seen = 1 WHERE id = ?').run(post.id);
        this.changed();
        await this.deps.dm
          .sendSocial(post.author, { v: 1, t: 'storySeen', postId: post.id })
          .catch(() => undefined);
        return out(null);
      }
      case 'profile': {
        const who = act.riverId ?? me;
        const person = this.deps.dm.person(who);
        const rows = this.db()
          .prepare(
            `SELECT * FROM posts WHERE author = ? AND kind = 'post' ORDER BY created_at DESC LIMIT 200`,
          )
          .all(who) as PostRow[];
        const profile: ProfileView = {
          riverId: who,
          name: person.name,
          avatar: person.avatar,
          bio: person.bio,
          isMe: who === me,
          isContact: this.deps.dm.contactState(who) === 'accepted',
          posts: rows.map((r) => this.view(r)),
        };
        return out(profile);
      }
      case 'setBio':
        this.deps.dm.setMyBio(act.bio);
        return out(null);
    }
  }

  /** Deletes stories older than a day (ours and others'). */
  expireStories(): void {
    const n = this.db()
      .prepare(`DELETE FROM posts WHERE kind = 'story' AND expires_at IS NOT NULL AND expires_at < ?`)
      .run(new Date().toISOString()).changes;
    if (n) this.changed();
  }

  feed(): FeedView {
    this.expireStories();
    const me = this.me();
    const posts = (
      this.db()
        .prepare(`SELECT * FROM posts WHERE kind = 'post' ORDER BY created_at DESC LIMIT 300`)
        .all() as PostRow[]
    ).map((r) => this.view(r));
    const storyRows = this.db()
      .prepare(`SELECT * FROM posts WHERE kind = 'story' ORDER BY created_at ASC`)
      .all() as PostRow[];
    const byAuthor = new Map<string, PostView[]>();
    for (const r of storyRows) {
      const list = byAuthor.get(r.author) ?? [];
      list.push(this.view(r));
      byAuthor.set(r.author, list);
    }
    const stories = [...byAuthor.entries()]
      .map(([author, list]) => {
        const p = this.deps.dm.person(author);
        return {
          riverId: author,
          name: p.name,
          avatar: p.avatar,
          mine: author === me,
          stories: list,
          unseen: author !== me && list.some((s) => !s.seen),
        };
      })
      .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.unseen) - Number(a.unseen));
    const friends = this.deps.dm.friends().map((id) => {
      const p = this.deps.dm.person(id);
      return { riverId: id, name: p.name, avatar: p.avatar };
    });
    return { posts, stories, friends };
  }

  private view(r: PostRow): PostView {
    const me = this.me();
    const body = JSON.parse(r.body) as { text?: string; attachments?: AttachmentPointer[] };
    const author = this.deps.dm.person(r.author);
    const reactionRows = this.db()
      .prepare('SELECT author, emoji FROM post_reactions WHERE post_id = ?')
      .all(r.id) as Array<{
      author: string;
      emoji: string;
    }>;
    const grouped = new Map<string, string[]>();
    for (const x of reactionRows) grouped.set(x.emoji, [...(grouped.get(x.emoji) ?? []), x.author]);
    const comments = (
      this.db()
        .prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at')
        .all(r.id) as Array<{
        id: string;
        author: string;
        author_name: string;
        text: string;
        created_at: string;
      }>
    ).map((c) => ({
      id: c.id,
      author: c.author,
      authorName: c.author === me ? this.deps.dm.person(me).name : c.author_name,
      text: c.text,
      createdAt: c.created_at,
      mine: c.author === me,
    }));
    const audience = JSON.parse(r.audience) as string[];
    const viewers =
      r.author === me && r.kind === 'story'
        ? (
            this.db().prepare('SELECT viewer FROM story_views WHERE post_id = ?').all(r.id) as Array<{
              viewer: string;
            }>
          ).map((v) => ({ riverId: v.viewer, name: this.deps.dm.person(v.viewer).name }))
        : [];
    return {
      id: r.id,
      author: r.author,
      authorName: author.name,
      authorAvatar: author.avatar,
      mine: r.author === me,
      kind: r.kind,
      text: String(body.text ?? ''),
      attachments: body.attachments ?? [],
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      reactions: [...grouped.entries()].map(([emoji, users]) => ({
        emoji,
        count: users.length,
        mine: users.includes(me),
      })),
      comments,
      audience: audience.length,
      viewers,
      seen: r.seen === 1,
    };
  }
}
