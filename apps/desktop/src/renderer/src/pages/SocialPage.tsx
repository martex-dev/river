import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import type { FeedView, PostView, ProfileView } from '../../../shared/social.ts';
import { useCommunity } from '../community/store.ts';
import {
  AttachmentList,
  MAX_PENDING,
  PendingFiles,
  decryptToUrl,
  dropPreviews,
  pendingFrom,
  uploadAll,
  type PendingFile,
} from '../community/ui/Attachments.tsx';
import {
  Avatar,
  EmojiPicker,
  MenuItem,
  Modal,
  PlusIcon,
  Popover,
  RichText,
  TrashIcon,
  XIcon,
} from '../community/ui/common.tsx';
import { useDm } from '../dm/store.ts';
import { useSocial } from '../social/store.ts';
import { useRiver } from '../store.ts';
import { tr, trn } from '../i18n.ts';

const STORY_MS = 6000;
/** Media still not ready after this long: the viewer moves on instead of waiting forever. */
export const STORY_STALL_MS = STORY_MS + 4000;
/** A touch that moves down this far closes the story. */
const SWIPE_CLOSE_PX = 80;
/** A touch shorter than this (and that hardly moves) is a tap: previous or next. */
const TAP_MS = 250;

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return tr('just now');
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Where the story viewer is: whose stories and which one (by ID, so a re-sorted feed never moves it). */
export interface StoryAt {
  riverId: string;
  storyId: string;
  /** Its position when it was opened, to stay near if that story disappears. */
  index: number;
}

/** Whether a key press belongs to a text field (typing a reply), not to the story viewer. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el && 'tagName' in el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  );
}

export function SocialPage(): ReactElement {
  const social = useSocial();
  const account = useRiver((r) => r.account);
  const me = useRiver((r) => r.identity);
  const [composer, setComposer] = useState<'post' | 'story' | null>(null);
  const [story, setStory] = useState<StoryAt | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [friendsOpen, setFriendsOpen] = useState(false);

  useEffect(() => {
    void social.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.state]);

  if (account.state !== 'registered') {
    return (
      <div className="page">
        <header className="page__header">
          <div className="eyebrow">{tr('Social')}</div>
          <h1 className="page__title">{tr('Share with your people')}</h1>
          <p className="page__lead">
            {tr(
              'Posts and stories go only to people you choose, end-to-end encrypted. Join a community or create an account first.',
            )}
          </p>
        </header>
      </div>
    );
  }

  const feed = social.feed;
  const openMine = (): void => setProfile(useRiver.getState().identity?.riverId ?? null);
  const friendList = (
    <>
      {feed?.friends.map((f) => (
        <button
          key={f.riverId}
          className="dm-row"
          onClick={() => {
            setFriendsOpen(false);
            setProfile(f.riverId);
          }}
        >
          <Avatar id={f.riverId} name={f.name} avatar={f.avatar} size={30} />
          <span className="dm-row__text">
            <strong>{f.name}</strong>
          </span>
        </button>
      ))}
      {feed?.friends.length === 0 && (
        <p className="muted small">{tr('Your friends are the people you have accepted in Messages.')}</p>
      )}
    </>
  );
  return (
    <div className="social">
      <div className="social__main">
        {/* On a narrow window (a phone) the side column is hidden: your profile and friends are here. */}
        <div className="social__narrow">
          <MyCard onProfile={openMine} />
          <button className="btn btn--ghost btn--small" onClick={() => setFriendsOpen(true)}>
            {tr('Friends — {count}', { count: feed?.friends.length ?? 0 })}
          </button>
        </div>
        <StoriesRail
          feed={feed}
          onOpen={(g) => {
            const first = g.stories.findIndex((s) => !s.mine && !s.seen);
            const index = Math.max(0, first);
            const s = g.stories[index];
            if (s) setStory({ riverId: g.riverId, storyId: s.id, index });
          }}
          onAdd={() => setComposer('story')}
        />
        <button className="social__compose glass" onClick={() => setComposer('post')}>
          <Avatar id={me?.riverId ?? 'me'} name={me?.displayName ?? tr('You')} size={36} />
          <span className="muted">{tr('Share something with your friends…')}</span>
        </button>
        {feed && feed.posts.length === 0 && (
          <div className="social__empty glass">
            <h2>{tr('Nothing here yet')}</h2>
            <p className="muted">
              {tr(
                'Posts from your contacts appear here. Add people in Messages (or from a community) and share your first post — only the people you choose can see it.',
              )}
            </p>
          </div>
        )}
        {feed?.posts.map((p) => (
          <PostCard key={p.id} post={p} onProfile={setProfile} />
        ))}
      </div>
      <aside className="social__side">
        <MyCard onProfile={openMine} />
        <div className="glass social__friends">
          <div className="channel-group__head">
            <span>{tr('Friends — {count}', { count: feed?.friends.length ?? 0 })}</span>
          </div>
          {friendList}
        </div>
      </aside>
      {friendsOpen && (
        <Modal
          title={tr('Friends — {count}', { count: feed?.friends.length ?? 0 })}
          onClose={() => setFriendsOpen(false)}
        >
          <div className="social__friends">{friendList}</div>
        </Modal>
      )}
      {composer && (
        <Composer kind={composer} friends={feed?.friends ?? []} onClose={() => setComposer(null)} />
      )}
      {story && feed && (
        <StoryViewer feed={feed} at={story} onMove={setStory} onClose={() => setStory(null)} />
      )}
      {profile && (
        <ProfileModal riverId={profile} onClose={() => setProfile(null)} onOpenPost={() => undefined} />
      )}
    </div>
  );
}

export function StoriesRail(props: {
  feed: FeedView | null;
  onOpen(group: FeedView['stories'][number]): void;
  onAdd(): void;
}): ReactElement {
  const me = useRiver((r) => r.identity);
  const groups = props.feed?.stories ?? [];
  const hasMine = groups.some((g) => g.mine);
  return (
    <div className="stories" aria-label={tr('Stories')}>
      {!hasMine && (
        <button className="story-bubble" onClick={props.onAdd}>
          <span className="story-bubble__ring story-bubble__ring--add">
            <Avatar id={me?.riverId ?? 'me'} name={me?.displayName ?? tr('You')} size={58} />
            <span className="story-bubble__plus">
              <PlusIcon size={14} />
            </span>
          </span>
          <span className="story-bubble__name">{tr('Your story')}</span>
        </button>
      )}
      {groups.map((g) => (
        <button key={g.riverId} className="story-bubble" onClick={() => props.onOpen(g)}>
          <span className={`story-bubble__ring ${g.unseen ? 'is-unseen' : ''}`}>
            <Avatar id={g.riverId} name={g.name} avatar={g.avatar} size={58} />
          </span>
          <span className="story-bubble__name">{g.mine ? tr('Your story') : g.name}</span>
        </button>
      ))}
      {hasMine && (
        <button className="story-bubble" onClick={props.onAdd} title={tr('Add to your story')}>
          <span className="story-bubble__ring story-bubble__ring--add">
            <span className="story-bubble__addicon">
              <PlusIcon size={22} />
            </span>
          </span>
          <span className="story-bubble__name">{tr('Add')}</span>
        </button>
      )}
    </div>
  );
}

function MyCard({ onProfile }: { onProfile(): void }): ReactElement {
  const identity = useRiver((r) => r.identity);
  return (
    <button className="glass social__me" onClick={onProfile}>
      <Avatar id={identity?.riverId ?? 'me'} name={identity?.displayName ?? tr('You')} size={44} />
      <span className="dm-row__text">
        <strong>{identity?.displayName ?? tr('You')}</strong>
        <span className="muted small">{tr('View your profile')}</span>
      </span>
    </button>
  );
}

export function Composer(props: {
  kind: 'post' | 'story';
  friends: FeedView['friends'];
  onClose(): void;
}): ReactElement {
  const social = useSocial();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [audience, setAudience] = useState<'friends' | string[]>('friends');
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The previews still waiting, freed when the composer closes (shared, cancelled or closed).
  const waiting = useRef<PendingFile[]>([]);
  const story = props.kind === 'story';

  useEffect(() => {
    waiting.current = files;
  }, [files]);
  useEffect(() => () => dropPreviews(waiting.current), []);

  /** Adds files up to the limit; the previews of those that do not fit are freed at once. */
  const add = (more: Iterable<File>): void => {
    const all = [...files, ...pendingFrom(more)];
    dropPreviews(all.slice(MAX_PENDING));
    setFiles(all.slice(0, MAX_PENDING));
  };

  const share = async (): Promise<void> => {
    if ((!text.trim() && !files.length) || busy) return;
    try {
      setBusy(files.length ? tr('Encrypting photos…') : tr('Sharing…'));
      const attachments = files.length ? await uploadAll(files, () => undefined, 'dm') : [];
      setBusy(tr('Sharing…'));
      const done = await social.run({ a: 'post', kind: props.kind, text, attachments, audience });
      if (done) {
        useCommunity.getState().notify(story ? tr('Added to your story') : tr('Shared'));
        props.onClose();
      }
    } catch (err) {
      useCommunity.getState().notify((err as Error).message || tr('Could not share.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={story ? tr('Add to your story') : tr('Create post')} onClose={props.onClose}>
      <div className="composer">
        <textarea
          autoFocus
          value={text}
          maxLength={2000}
          rows={story ? 3 : 5}
          placeholder={story ? tr('Say something (shown for 24 hours)…') : tr('What do you want to share?')}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length) {
              e.preventDefault();
              add(pasted);
            }
          }}
        />
        {files.length > 0 && (
          <PendingFiles
            files={files}
            onRemove={(k) => {
              dropPreviews(files.filter((f) => f.key === k));
              setFiles(files.filter((f) => f.key !== k));
            }}
          />
        )}
        <div className="composer__row">
          <button className="btn btn--ghost btn--small" onClick={() => fileRef.current?.click()}>
            📷 {tr('Photos & videos')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            aria-label={tr('Add photos or videos')}
            onChange={(e) => {
              if (e.target.files?.length) add(e.target.files);
              e.target.value = '';
            }}
          />
          <select
            className="composer__audience"
            aria-label={tr('Who can see this')}
            value={audience === 'friends' ? 'friends' : 'custom'}
            onChange={(e) => setAudience(e.target.value === 'friends' ? 'friends' : [])}
          >
            <option value="friends">👥 {tr('All friends ({count})', { count: props.friends.length })}</option>
            <option value="custom">🔒 {tr('Only people I choose')}</option>
          </select>
        </div>
        {audience !== 'friends' && (
          <div className="people-list composer__people">
            {props.friends.map((f) => (
              <label key={f.riverId} className={`dm-row ${audience.includes(f.riverId) ? 'is-active' : ''}`}>
                <input
                  type="checkbox"
                  checked={audience.includes(f.riverId)}
                  onChange={() =>
                    setAudience(
                      audience.includes(f.riverId)
                        ? audience.filter((x) => x !== f.riverId)
                        : [...audience, f.riverId],
                    )
                  }
                />
                <Avatar id={f.riverId} name={f.name} avatar={f.avatar} size={26} />
                <strong>{f.name}</strong>
              </label>
            ))}
          </div>
        )}
        <p className="muted small">
          {tr("Encrypted separately for each person who can see it. River's server only relays ciphertext.")}
        </p>
        <div className="modal__foot">
          <button
            className="btn btn--primary"
            disabled={
              !!busy || (!text.trim() && !files.length) || (audience !== 'friends' && audience.length === 0)
            }
            onClick={() => void share()}
          >
            {busy ?? (story ? tr('Share to story') : tr('Post'))}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PostCard({ post, onProfile }: { post: PostView; onProfile(id: string): void }): ReactElement {
  const social = useSocial();
  const [comment, setComment] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const liked = post.reactions.some((r) => r.emoji === '❤️' && r.mine);
  const comments = showAll ? post.comments : post.comments.slice(-3);
  const myName = useRiver((r) => r.identity?.displayName) ?? tr('You');
  return (
    <article className="post glass">
      <header className="post__head">
        <button className="post__author" onClick={() => onProfile(post.author)}>
          <Avatar id={post.author} name={post.authorName} avatar={post.authorAvatar} size={40} />
          <span className="dm-row__text">
            <strong>{post.authorName}</strong>
            <span className="muted small">
              {ago(post.createdAt)}
              {post.mine ? ` · ${trn('shared with {count} people', post.audience)}` : ''}
            </span>
          </span>
        </button>
        {post.mine && (
          <button
            className="icon-btn"
            aria-label={tr('Post options')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.right - 200, y: r.bottom + 4 });
            }}
          >
            ⋯
          </button>
        )}
      </header>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          <MenuItem
            danger
            icon={<TrashIcon size={16} />}
            onClick={() => {
              setMenu(null);
              useCommunity.getState().setModal({
                kind: 'confirm',
                title: tr('Delete post'),
                body: tr('It will be removed for everyone you shared it with.'),
                action: tr('Delete'),
                run: async () => {
                  await social.run({ a: 'deletePost', postId: post.id });
                },
              });
            }}
          >
            {tr('Delete post')}
          </MenuItem>
        </Popover>
      )}
      {post.text && (
        <div className="post__text">
          <RichText text={post.text} names={[]} me={myName} />
        </div>
      )}
      {post.attachments.length > 0 && (
        <div className="post__media">
          <AttachmentList attachments={post.attachments} />
        </div>
      )}
      <div className="post__actions">
        <button
          className={`post__like ${liked ? 'is-on' : ''}`}
          aria-label={liked ? tr('Unlike') : tr('Like')}
          onClick={() => void social.run({ a: 'react', postId: post.id, emoji: '❤️', on: !liked })}
        >
          {liked ? '❤️' : '🤍'}
        </button>
        <button
          className="post__like"
          aria-label={tr('React')}
          onClick={(e) => setPicker({ x: e.clientX, y: e.clientY - 320 })}
        >
          😊
        </button>
        {post.reactions.length > 0 && (
          <span className="post__reactions">
            {post.reactions.map((r) => (
              <span key={r.emoji} className={`reaction ${r.mine ? 'is-mine' : ''}`}>
                {r.emoji} {r.count}
              </span>
            ))}
          </span>
        )}
      </div>
      {post.comments.length > 3 && !showAll && (
        <button className="btn btn--link post__more" onClick={() => setShowAll(true)}>
          {trn('View all {count} comments', post.comments.length)}
        </button>
      )}
      <div className="post__comments">
        {comments.map((c) => (
          <div key={c.id} className="post__comment">
            <strong>{c.authorName}</strong> {c.text}
            <span className="muted small"> · {ago(c.createdAt)}</span>
          </div>
        ))}
      </div>
      <form
        className="post__reply"
        onSubmit={(e) => {
          e.preventDefault();
          const text = comment.trim();
          if (!text) return;
          setComment('');
          void social.run({ a: 'comment', postId: post.id, text }).then((id) => {
            // Not sent (the reason was shown): what you wrote comes back, unless you started another.
            if (id === null) setComment((now) => now || text);
          });
        }}
      >
        <input
          value={comment}
          maxLength={1000}
          placeholder={tr('Add a comment…')}
          aria-label={tr('Add a comment')}
          onChange={(e) => setComment(e.target.value)}
        />
        <button className="btn btn--link" disabled={!comment.trim()}>
          {tr('Post')}
        </button>
      </form>
      {picker && (
        <Popover x={picker.x} y={picker.y} onClose={() => setPicker(null)}>
          <EmojiPicker
            onPick={(e) => {
              setPicker(null);
              void social.run({
                a: 'react',
                postId: post.id,
                emoji: e,
                on: !post.reactions.find((r) => r.emoji === e)?.mine,
              });
            }}
          />
        </Popover>
      )}
    </article>
  );
}

export function StoryViewer(props: {
  feed: FeedView;
  at: StoryAt;
  onMove(at: StoryAt): void;
  onClose(): void;
}): ReactElement | null {
  // The order of people when the viewer opened: marking a story seen re-sorts the feed, not this.
  const [order] = useState(() => props.feed.stories.map((g) => g.riverId));
  const group = props.feed.stories.find((g) => g.riverId === props.at.riverId);
  const found = group ? group.stories.findIndex((s) => s.id === props.at.storyId) : -1;
  // A story that disappeared (deleted, expired): the one now at its place, if any.
  const index = !group?.stories.length
    ? -1
    : found >= 0
      ? found
      : Math.min(props.at.index, group.stories.length - 1);
  const story = group && index >= 0 ? group.stories[index] : undefined;
  const media = story?.attachments.find((a) => a.mime.startsWith('image/') || a.mime.startsWith('video/'));
  const isVideo = !!media?.mime.startsWith('video/');
  // The decrypted picture or video, remembered with the story it belongs to.
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  const url = story && loaded?.id === story.id ? loaded.url : null;
  // Stories whose media is shown (or could not be loaded): only then does the timer run.
  const [ready, setReady] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [videoMs, setVideoMs] = useState<{ id: string; ms: number } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const brokenMedia = !!story && failed === story.id;
  const isReady = !!story && (!media || ready === story.id || brokenMedia);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const social = useSocial();
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; at: number; touch: boolean } | null>(null);
  const elapsed = useRef(0);
  const durationMs =
    isVideo && story && videoMs?.id === story.id && refused !== story.id ? videoMs.ms : STORY_MS;

  const goTo = (riverId: string, i: number): void => {
    const g = props.feed.stories.find((x) => x.riverId === riverId);
    const s = g?.stories[i];
    if (g && s) props.onMove({ riverId, storyId: s.id, index: i });
  };
  /** The next (or previous) person, in the order the viewer opened with, who still has stories. */
  const neighbour = (step: 1 | -1): string | undefined => {
    const at = order.indexOf(props.at.riverId);
    for (let i = at + step; i >= 0 && i < order.length; i += step) {
      const id = order[i]!;
      if (props.feed.stories.some((g) => g.riverId === id && g.stories.length)) return id;
    }
    return undefined;
  };
  const next = (): void => {
    if (!group) return props.onClose();
    if (index + 1 < group.stories.length) return goTo(group.riverId, index + 1);
    const who = neighbour(1);
    if (who) goTo(who, 0);
    else props.onClose();
  };
  const prev = (): void => {
    if (!group) return;
    if (index > 0) return goTo(group.riverId, index - 1);
    const who = neighbour(-1);
    if (who) goTo(who, 0);
  };
  // Timers and listeners always call the latest next/prev/close.
  const latest = useRef({ next, prev, close: props.onClose });
  useEffect(() => {
    latest.current = { next, prev, close: props.onClose };
  });

  // Gone (that person's stories all disappeared): the viewer closes; moved: it follows.
  useEffect(() => {
    if (!story) props.onClose();
    else if (story.id !== props.at.storyId)
      props.onMove({ riverId: props.at.riverId, storyId: story.id, index });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, props.at.storyId]);

  useEffect(() => {
    if (!story) return;
    let live = true;
    if (media) {
      void decryptToUrl(media)
        .then((u) => live && setLoaded({ id: story.id, url: u }))
        .catch(() => live && setFailed(story.id));
    }
    if (!story.mine && !story.seen) void social.run({ a: 'seen', postId: story.id });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // Each story starts from the beginning (declared before the timer, so it resets first).
  useEffect(() => {
    elapsed.current = 0;
  }, [story?.id]);

  // Pictures and text advance after STORY_MS of being shown (pauses do not count); a video when it ends.
  useEffect(() => {
    if (!story || !isReady || paused || (isVideo && !brokenMedia)) return;
    const started = Date.now();
    const t = window.setTimeout(() => latest.current.next(), Math.max(0, STORY_MS - elapsed.current));
    return () => {
      window.clearTimeout(t);
      elapsed.current += Date.now() - started;
    };
  }, [story?.id, story, isReady, paused, isVideo, brokenMedia]);

  // Media that never gets ready (its metadata never loads, decrypting hangs) does not freeze the
  // viewer (2.11.2): after a picture's time plus a margin it moves on. Holding still pauses it.
  useEffect(() => {
    if (!story || isReady || paused) return;
    const t = window.setTimeout(() => latest.current.next(), STORY_STALL_MS);
    return () => window.clearTimeout(t);
  }, [story?.id, story, isReady, paused]);

  // A video this device refuses to play never ends: it is shown for a picture's time instead.
  const playRefused = !!story && refused === story.id;
  useEffect(() => {
    if (!story || !isVideo || !playRefused || paused) return;
    const t = window.setTimeout(() => latest.current.next(), STORY_MS);
    return () => window.clearTimeout(t);
  }, [story?.id, story, isVideo, playRefused, paused]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const id = story?.id ?? null;
    try {
      if (paused) v.pause();
      else void Promise.resolve(v.play()).catch(() => setRefused(id));
    } catch {
      // media playback unavailable here: counts as refused
      queueMicrotask(() => setRefused(id));
    }
  }, [paused, url, story?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Writing a reply: the arrows move the cursor, and Esc leaves the box (the story stays).
      if (typing(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Escape') latest.current.close();
      if (e.key === 'ArrowRight') latest.current.next();
      if (e.key === 'ArrowLeft') latest.current.prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!group || !story) return null;

  /** Holding pauses; on touch a quick tap goes back or on, and a swipe down closes. */
  const down = (e: PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('input, form, .story-viewer__head')) return;
    const touch = e.pointerType !== 'mouse';
    press.current = { x: e.clientX, y: e.clientY, at: Date.now(), touch };
    setPaused(true);
    if (touch) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer already gone
      }
    }
  };
  const up = (e: PointerEvent<HTMLDivElement>): void => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    setPaused(false);
    if (!p.touch) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (dy > SWIPE_CLOSE_PX && Math.abs(dy) > Math.abs(dx)) return props.onClose();
    if (Date.now() - p.at < TAP_MS && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // With the pointer captured, the tap reaches the frame, not the buttons: decide by where it was.
      const rect = frameRef.current?.getBoundingClientRect();
      if (!rect || !rect.width) return;
      const at = (e.clientX - rect.left) / rect.width;
      if (at < 0.35) prev();
      else if (at > 0.65) next();
    }
  };
  const cancel = (): void => {
    if (!press.current) return;
    press.current = null;
    setPaused(false);
  };

  return (
    <div className="story-viewer" role="dialog" aria-label={tr("{name}'s story", { name: group.name })}>
      <div
        ref={frameRef}
        className="story-viewer__frame"
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') cancel();
        }}
      >
        <div className="story-viewer__bars">
          {group.stories.map((s, i) => (
            <span key={s.id} className="story-viewer__bar">
              <span
                className={`story-viewer__fill ${i < index ? 'is-done' : i === index && isReady ? 'is-running' : ''}`}
                style={{
                  animationDuration: `${durationMs}ms`,
                  animationPlayState: paused ? 'paused' : 'running',
                }}
              />
            </span>
          ))}
        </div>
        <header className="story-viewer__head">
          <Avatar id={group.riverId} name={group.name} avatar={group.avatar} size={32} />
          <strong>{group.mine ? tr('Your story') : group.name}</strong>
          <span className="muted small">{ago(story.createdAt)}</span>
          <button className="icon-btn" aria-label={tr('Close story')} onClick={props.onClose}>
            <XIcon />
          </button>
        </header>
        <div className="story-viewer__content">
          {media && brokenMedia ? (
            <div className="story-viewer__textonly muted small">{tr('This story could not be loaded.')}</div>
          ) : url && isVideo ? (
            <video
              key={story.id}
              ref={videoRef}
              src={url}
              muted
              autoPlay
              playsInline
              aria-label={story.text || tr('Video story')}
              onLoadedMetadata={(e) => {
                const ms = e.currentTarget.duration * 1000;
                if (Number.isFinite(ms) && ms > 0) setVideoMs({ id: story.id, ms });
                setReady(story.id);
              }}
              onEnded={() => latest.current.next()}
              onError={() => setFailed(story.id)}
            />
          ) : url ? (
            <img
              key={story.id}
              src={url}
              alt=""
              onLoad={() => setReady(story.id)}
              onError={() => setFailed(story.id)}
            />
          ) : (
            !media && <div className="story-viewer__textonly">{story.text}</div>
          )}
          {media && story.text && <div className="story-viewer__caption">{story.text}</div>}
        </div>
        <button
          className="story-viewer__nav story-viewer__nav--prev"
          aria-label={tr('Previous')}
          onClick={prev}
        />
        <button
          className="story-viewer__nav story-viewer__nav--next"
          aria-label={tr('Next')}
          onClick={next}
        />
        <footer className="story-viewer__foot">
          {story.mine ? (
            <span className="muted small">
              👁 {tr('Seen by {count}', { count: story.viewers.length })}
              {story.viewers.length ? `: ${story.viewers.map((v) => v.name).join(', ')}` : ''}
            </span>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = reply.trim();
                if (!text) return;
                setReply('');
                void useDm
                  .getState()
                  .run({
                    a: 'send',
                    peer: group.riverId,
                    text: tr('Replied to your story: {text}', { text }),
                  })
                  .then(
                    (ok) => ok && useCommunity.getState().notify(tr('Sent to {name}', { name: group.name })),
                  );
              }}
            >
              <input
                value={reply}
                placeholder={tr('Reply to {name}…', { name: group.name })}
                aria-label={tr('Reply to {name}', { name: group.name })}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                onChange={(e) => setReply(e.target.value)}
              />
            </form>
          )}
        </footer>
      </div>
    </div>
  );
}

export function ProfileModal(props: {
  riverId: string;
  onClose(): void;
  onOpenPost(id: string): void;
}): ReactElement {
  const social = useSocial();
  // Likes, comments and deletes change the feed: the profile's posts follow.
  const feed = useSocial((s) => s.feed);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    // Read directly: social.run() reloads the feed, which would bring us straight back here.
    void window.river.social.action({ a: 'profile', riverId: props.riverId }).then((res) => {
      if (!live) return;
      if (res.ok) setProfile(res.value as ProfileView);
      else useCommunity.getState().notify(res.message, 'error');
    });
    return () => {
      live = false;
    };
  }, [props.riverId, feed]);
  return (
    <Modal onClose={props.onClose} wide className="profile-modal">
      {!profile ? (
        <p className="muted">{tr('Loading…')}</p>
      ) : (
        <>
          <div className="profile-modal__head">
            <Avatar id={profile.riverId} name={profile.name} avatar={profile.avatar} size={96} />
            <div className="profile-modal__who">
              <h2>{profile.name}</h2>
              {bio !== null ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (saving) return;
                    setSaving(true);
                    void social.run({ a: 'setBio', bio }).then((saved) => {
                      setSaving(false);
                      // Not saved: the reason was shown and what you wrote stays to try again.
                      if (saved === null) return;
                      setProfile({ ...profile, bio: saved });
                      setBio(null);
                      useCommunity.getState().notify(tr('Bio saved'));
                    });
                  }}
                >
                  <textarea
                    value={bio}
                    maxLength={300}
                    rows={3}
                    aria-label={tr('Your bio')}
                    onChange={(e) => setBio(e.target.value)}
                    autoFocus
                  />
                  <div className="button-row">
                    <button className="btn btn--primary btn--small" disabled={saving}>
                      {saving ? tr('Saving…') : tr('Save')}
                    </button>
                    <button type="button" className="btn btn--link" onClick={() => setBio(null)}>
                      {tr('Cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="profile-modal__bio">
                  {profile.bio || (profile.isMe ? tr('Add a short bio.') : '')}
                </p>
              )}
              <div className="button-row">
                {profile.isMe && bio === null && (
                  <button className="btn btn--ghost btn--small" onClick={() => setBio(profile.bio)}>
                    {tr('Edit bio')}
                  </button>
                )}
                {!profile.isMe && (
                  <button
                    className="btn btn--primary btn--small"
                    onClick={() => {
                      props.onClose();
                      void useDm.getState().open(profile.riverId, profile.name);
                    }}
                  >
                    {tr('Message')}
                  </button>
                )}
              </div>
            </div>
            <button
              className="icon-btn profile-modal__close"
              aria-label={tr('Close')}
              onClick={props.onClose}
            >
              <XIcon />
            </button>
          </div>
          <div className="profile-modal__posts">
            {profile.posts.length === 0 && <p className="muted">{tr('No posts yet.')}</p>}
            {profile.posts.map((p) => (
              <PostCard key={p.id} post={p} onProfile={() => undefined} />
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
