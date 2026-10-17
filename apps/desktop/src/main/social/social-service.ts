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
/** How long a comment of ours survives the author's snapshots while they have not relayed it. */
const PENDING_COMMENT_MS = 7 * 24 * 60 * 60 * 1000;
/** Social updates that could not be sent are retried for this long, this many times. */
const OUTBOX_MS = 7 * 24 * 60 * 60 * 1000;
const OUTBOX_TRIES = 20;
const OUTBOX_MAX = 1000;
/** Retries run at most this often (on the feed opening, or when anything social arrives). */
const OUTBOX_EVERY_MS = 30_000;

/**
 * Something for one person that has not reached them yet: a post, a delete, a "seen", or
 * (`relay`) the latest comments and reactions of one of our posts, rebuilt when it is sent.
 */
interface OutboxItem {
  peer: string;
  postId: string;
  t: SocialContent['t'];
  content?: SocialContent;
  relay?: true;
  tries: number;
  at: number;
}

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
  private flushing = false;
  private lastFlush = 0;

  constructor(deps: Deps) {
    this.deps = deps;
    deps.dm.setSocialHandler((peer, content) => {
      try {
        this.receive(peer, content);
      } catch (err) {
        deps.log.warn(`Ignored a social update: ${(err as Error).message}`);
      }
    });
    // Blocking someone removes their posts and stories from this device.
    deps.dm.onBlocked((riverId) => {
      const n = this.db().prepare('DELETE FROM posts WHERE author = ?').run(riverId).changes;
      if (n) this.changed();
    });
  }

  /** Comments we sent on others' posts that their author has not relayed back yet. */
  private pendingComments(): Record<string, { postId: string; at: number }> {
    try {
      const row = this.db().prepare("SELECT value FROM meta WHERE key = 'social_pending_comments'").get() as
        { value: string } | undefined;
      const parsed: unknown = row ? JSON.parse(row.value) : {};
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, { postId: string; at: number }>)
        : {};
    } catch {
      return {};
    }
  }

  private setPendingComments(pending: Record<string, { postId: string; at: number }>): void {
    // A comment the author never relays is not kept forever.
    const cutoff = Date.now() - PENDING_COMMENT_MS;
    const kept = Object.fromEntries(
      Object.entries(pending)
        .filter(([, p]) => p.at > cutoff)
        .slice(-500),
    );
    this.db()
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('social_pending_comments', ?)")
      .run(JSON.stringify(kept));
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
    // Something arrived, so we are online: what could not be sent before goes now.
    this.flushSoon();
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
        // Someone you blocked or removed since sharing it no longer comments or reacts.
        if (this.deps.dm.contactState(peer) !== 'accepted') return;
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
        // Our own comments the author has not relayed yet stay (the snapshot predates them).
        const pending = this.pendingComments();
        const relayed = new Set(c.comments.map((cm) => cm.id));
        const before = Object.keys(pending).length;
        for (const id of Object.keys(pending)) if (relayed.has(id)) delete pending[id];
        const waiting = Object.entries(pending)
          .filter(([, p]) => p.postId === c.postId)
          .map(([id]) => id);
        db.prepare(
          `DELETE FROM post_comments WHERE post_id = ?
             AND NOT (author = ? AND id IN (SELECT value FROM json_each(?)))`,
        ).run(c.postId, me, JSON.stringify(waiting));
        if (Object.keys(pending).length !== before) this.setPendingComments(pending);
        for (const cm of c.comments) {
          // Never comments from people you blocked, whoever's post they are on.
          if (cm.author !== me && this.deps.dm.contactState(cm.author) === 'blocked') continue;
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
    const content = this.activity(post);
    // Only people who are still your contacts: not someone you blocked or removed since.
    for (const peer of this.reachable(post)) {
      try {
        await this.deps.dm.sendSocial(peer, content);
        this.unqueue((x) => x.peer === peer && x.postId === postId && x.t === 'postActivity');
      } catch {
        this.queue(peer, { postId, t: 'postActivity', relay: true });
      }
    }
  }

  /** The audience of one of our posts who are still accepted contacts. */
  private reachable(post: PostRow): string[] {
    return (JSON.parse(post.audience) as string[]).filter(
      (peer) => this.deps.dm.contactState(peer) === 'accepted',
    );
  }

  /** The snapshot of comments and reactions on one of our posts that its audience gets. */
  private activity(post: PostRow): SocialContent {
    const postId = post.id;
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
    return content;
  }

  // ---- retrying what could not be sent -----------------------------------------------------------

  private outbox(): OutboxItem[] {
    try {
      const row = this.db().prepare("SELECT value FROM meta WHERE key = 'social_outbox'").get() as
        { value: string } | undefined;
      const parsed: unknown = row ? JSON.parse(row.value) : [];
      return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
    } catch {
      return [];
    }
  }

  private setOutbox(items: OutboxItem[]): void {
    const cutoff = Date.now() - OUTBOX_MS;
    const kept = items.filter((x) => x.at > cutoff && x.tries < OUTBOX_TRIES).slice(-OUTBOX_MAX);
    this.db()
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('social_outbox', ?)")
      .run(JSON.stringify(kept));
  }

  /** Keeps something to send again later (one entry per person, post and kind: the latest wins). */
  private queue(peer: string, item: Pick<OutboxItem, 'postId' | 't' | 'content' | 'relay'>): void {
    const rest = this.outbox().filter(
      (x) => !(x.peer === peer && x.postId === item.postId && x.t === item.t),
    );
    this.setOutbox([...rest, { peer, ...item, tries: 0, at: Date.now() }]);
  }

  private unqueue(match: (x: OutboxItem) => boolean): void {
    const items = this.outbox();
    const rest = items.filter((x) => !match(x));
    if (rest.length !== items.length) this.setOutbox(rest);
  }

  /** Tries the outbox again, at most every OUTBOX_EVERY_MS (never while storage is locked). */
  private flushSoon(): void {
    if (this.flushing || Date.now() - this.lastFlush < OUTBOX_EVERY_MS || !this.deps.db()) return;
    void this.flushOutbox().catch((err: unknown) =>
      this.deps.log.warn(`Social retry failed: ${(err as Error).message}`),
    );
  }

  /** Sends again what could not be sent before. Returns how many items are still waiting. */
  async flushOutbox(): Promise<number> {
    if (this.flushing) return this.outbox().length;
    this.flushing = true;
    this.lastFlush = Date.now();
    try {
      const items = this.outbox();
      if (!items.length) return 0;
      const same = (a: OutboxItem, b: OutboxItem): boolean =>
        a.peer === b.peer && a.postId === b.postId && a.t === b.t && a.at === b.at;
      const left: OutboxItem[] = [];
      for (const item of items) {
        // Blocked or removed since: nothing more goes to them.
        if (this.deps.dm.contactState(item.peer) !== 'accepted') continue;
        let content = item.content;
        if (item.relay) {
          const post = this.row(item.postId);
          if (!post || post.author !== this.me() || !this.reachable(post).includes(item.peer)) continue;
          content = this.activity(post);
        } else if (item.t === 'post' && !this.row(item.postId)) continue;
        if (!content) continue;
        try {
          await this.deps.dm.sendSocial(item.peer, content);
        } catch {
          left.push({ ...item, tries: item.tries + 1 });
        }
      }
      // Anything queued (or taken back) while this ran is respected.
      const now = this.outbox();
      const added = now.filter((x) => !items.some((y) => same(x, y)));
      const stillQueued = left.filter((x) => now.some((y) => same(x, y)));
      const replaced = stillQueued.filter(
        (x) => !added.some((y) => y.peer === x.peer && y.postId === x.postId && y.t === x.t),
      );
      this.setOutbox([...replaced, ...added]);
      return replaced.length + added.length;
    } finally {
      this.flushing = false;
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
        // Only ever your friends, also when you pick people (the window's list is not trusted).
        const friends = this.deps.dm.friends();
        const audience =
          act.audience === 'friends'
            ? friends
            : [...new Set(act.audience)].filter((p) => friends.includes(p));
        if (!audience.length) {
          throw new CommunityError(
            act.audience === 'friends'
              ? 'Add some friends first: posts are shared with people who accepted you.'
              : 'None of the people you chose are your friends.',
          );
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
        const missed: string[] = [];
        for (const peer of audience) {
          try {
            await this.deps.dm.sendSocial(peer, content);
            delivered++;
          } catch (err) {
            missed.push(peer);
            this.deps.log.warn(`Post not delivered to one person: ${(err as Error).message}`);
          }
        }
        if (!delivered) {
          // Nobody got it: it is not kept as if shared (sharing again does not make a duplicate).
          this.db().prepare('DELETE FROM posts WHERE id = ?').run(id);
          this.changed();
          throw new CommunityError(
            'The post could not be delivered to anyone. Check your connection and try again.',
          );
        }
        // Those who did not get it yet get it later (a copy they already have is ignored).
        for (const peer of missed) this.queue(peer, { postId: id, t: 'post', content });
        return out(this.view(this.row(id)!));
      }
      case 'deletePost': {
        const post = this.row(act.postId);
        if (!post) return out(null);
        if (post.author === me) {
          // Copies not delivered yet never go out; the delete reaches those offline later.
          this.unqueue((x) => x.postId === post.id);
          const del: SocialContent = { v: 1, t: 'postDelete', postId: post.id };
          for (const peer of JSON.parse(post.audience) as string[]) {
            await this.deps.dm
              .sendSocial(peer, del)
              .catch(() => this.queue(peer, { postId: post.id, t: 'postDelete', content: del }));
          }
        }
        this.db().prepare('DELETE FROM posts WHERE id = ?').run(act.postId);
        this.changed();
        return out(null);
      }
      case 'react': {
        const post = this.row(act.postId);
        if (!post) return out(false);
        const had = !!this.db()
          .prepare('SELECT 1 FROM post_reactions WHERE post_id = ? AND author = ? AND emoji = ?')
          .get(post.id, me, act.emoji);
        this.setReaction(act.postId, me, act.emoji, act.on);
        this.changed();
        if (post.author === me) this.scheduleRelay(post.id);
        else {
          try {
            await this.deps.dm.sendSocial(post.author, {
              v: 1,
              t: 'postReact',
              postId: post.id,
              emoji: act.emoji,
              on: act.on,
            });
          } catch {
            // Not sent: it does not stay looking sent.
            this.setReaction(post.id, me, act.emoji, had);
            this.changed();
            throw new CommunityError('Your reaction could not be sent. Check your connection and try again.');
          }
        }
        return out(true);
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
          this.setPendingComments({
            ...this.pendingComments(),
            [commentId]: { postId: post.id, at: Date.now() },
          });
          try {
            await this.deps.dm.sendSocial(post.author, {
              v: 1,
              t: 'postComment',
              postId: post.id,
              commentId,
              text: act.text.trim(),
            });
          } catch {
            // Not sent: it is taken back (and the window keeps what you wrote) instead of looking sent.
            this.db().prepare('DELETE FROM post_comments WHERE id = ?').run(commentId);
            const { [commentId]: _gone, ...pending } = this.pendingComments();
            this.setPendingComments(pending);
            this.changed();
            throw new CommunityError('Your comment could not be sent. Check your connection and try again.');
          }
        }
        return out(commentId);
      }
      case 'seen': {
        const post = this.row(act.postId);
        if (!post || post.kind !== 'story' || post.author === me || post.seen) return out(null);
        this.db().prepare('UPDATE posts SET seen = 1 WHERE id = ?').run(post.id);
        this.changed();
        // Seen here at once; the author hears it now or, if that fails, later.
        const seen: SocialContent = { v: 1, t: 'storySeen', postId: post.id };
        await this.deps.dm
          .sendSocial(post.author, seen)
          .catch(() => this.queue(post.author, { postId: post.id, t: 'storySeen', content: seen }));
        return out(null);
      }
      case 'profile': {
        const who = act.riverId ?? me;
        const person = this.deps.dm.person(who);
        // Posts of someone blocked or removed are not shown (as in the feed).
        const rows = this.shown(who)
          ? (this.db()
              .prepare(
                `SELECT * FROM posts WHERE author = ? AND kind = 'post' ORDER BY created_at DESC LIMIT 200`,
              )
              .all(who) as PostRow[])
          : [];
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
        return out(this.deps.dm.setMyBio(act.bio));
    }
  }

  /** Deletes stories older than a day (ours and others'). */
  expireStories(): void {
    const n = this.db()
      .prepare(`DELETE FROM posts WHERE kind = 'story' AND expires_at IS NOT NULL AND expires_at < ?`)
      .run(new Date().toISOString()).changes;
    if (n) this.changed();
  }

  /** Whose posts and stories show: yours and your contacts' (never someone blocked or removed). */
  private shown(author: string): boolean {
    return author === this.me() || this.deps.dm.contactState(author) === 'accepted';
  }

  feed(): FeedView {
    this.expireStories();
    this.flushSoon();
    const me = this.me();
    const shown = (r: PostRow): boolean => this.shown(r.author);
    const posts = (
      this.db()
        .prepare(`SELECT * FROM posts WHERE kind = 'post' ORDER BY created_at DESC LIMIT 300`)
        .all() as PostRow[]
    )
      .filter(shown)
      .map((r) => this.view(r));
    const storyRows = (
      this.db().prepare(`SELECT * FROM posts WHERE kind = 'story' ORDER BY created_at ASC`).all() as PostRow[]
    ).filter(shown);
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
    )
      // Never comments from people you blocked.
      .filter((c) => c.author === me || this.deps.dm.contactState(c.author) !== 'blocked')
      .map((c) => ({
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
