import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { FeedView, PostView, ProfileView } from '../../../shared/social.ts';
import { useCommunity } from '../community/store.ts';
import {
  AttachmentList,
  PendingFiles,
  decryptToUrl,
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

const STORY_MS = 6000;

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function SocialPage(): ReactElement {
  const social = useSocial();
  const account = useRiver((r) => r.account);
  const me = useRiver((r) => r.identity);
  const [composer, setComposer] = useState<'post' | 'story' | null>(null);
  const [story, setStory] = useState<{ group: number; index: number } | null>(null);
  const [profile, setProfile] = useState<string | null>(null);

  useEffect(() => {
    void social.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.state]);

  if (account.state !== 'registered') {
    return (
      <div className="page">
        <header className="page__header">
          <div className="eyebrow">Social</div>
          <h1 className="page__title">Share with your people</h1>
          <p className="page__lead">
            Posts and stories go only to people you choose, end-to-end encrypted. Join a community or create
            an account first.
          </p>
        </header>
      </div>
    );
  }

  const feed = social.feed;
  return (
    <div className="social">
      <div className="social__main">
        <StoriesRail
          feed={feed}
          onOpen={(group) => setStory({ group, index: 0 })}
          onAdd={() => setComposer('story')}
        />
        <button className="social__compose glass" onClick={() => setComposer('post')}>
          <Avatar id={me?.riverId ?? 'me'} name={me?.displayName ?? 'You'} size={36} />
          <span className="muted">Share something with your friends…</span>
        </button>
        {feed && feed.posts.length === 0 && (
          <div className="social__empty glass">
            <h2>Nothing here yet</h2>
            <p className="muted">
              Posts from your contacts appear here. Add people in Messages (or from a community) and share
              your first post — only the people you choose can see it.
            </p>
          </div>
        )}
        {feed?.posts.map((p) => (
          <PostCard key={p.id} post={p} onProfile={setProfile} />
        ))}
      </div>
      <aside className="social__side">
        <MyCard onProfile={() => setProfile(useRiver.getState().identity?.riverId ?? null)} />
        <div className="glass social__friends">
          <div className="channel-group__head">
            <span>Friends — {feed?.friends.length ?? 0}</span>
          </div>
          {feed?.friends.map((f) => (
            <button key={f.riverId} className="dm-row" onClick={() => setProfile(f.riverId)}>
              <Avatar id={f.riverId} name={f.name} avatar={f.avatar} size={30} />
              <span className="dm-row__text">
                <strong>{f.name}</strong>
              </span>
            </button>
          ))}
          {feed?.friends.length === 0 && (
            <p className="muted small">Your friends are the people you have accepted in Messages.</p>
          )}
        </div>
      </aside>
      {composer && (
        <Composer kind={composer} friends={feed?.friends ?? []} onClose={() => setComposer(null)} />
      )}
      {story && feed && feed.stories[story.group] && (
        <StoryViewer feed={feed} at={story} onMove={setStory} onClose={() => setStory(null)} />
      )}
      {profile && (
        <ProfileModal riverId={profile} onClose={() => setProfile(null)} onOpenPost={() => undefined} />
      )}
    </div>
  );
}

function StoriesRail(props: {
  feed: FeedView | null;
  onOpen(group: number): void;
  onAdd(): void;
}): ReactElement {
  const me = useRiver((r) => r.identity);
  const groups = props.feed?.stories ?? [];
  const hasMine = groups.some((g) => g.mine);
  return (
    <div className="stories" aria-label="Stories">
      {!hasMine && (
        <button className="story-bubble" onClick={props.onAdd}>
          <span className="story-bubble__ring story-bubble__ring--add">
            <Avatar id={me?.riverId ?? 'me'} name={me?.displayName ?? 'You'} size={58} />
            <span className="story-bubble__plus">
              <PlusIcon size={14} />
            </span>
          </span>
          <span className="story-bubble__name">Your story</span>
        </button>
      )}
      {groups.map((g, i) => (
        <button key={g.riverId} className="story-bubble" onClick={() => props.onOpen(i)}>
          <span className={`story-bubble__ring ${g.unseen ? 'is-unseen' : ''}`}>
            <Avatar id={g.riverId} name={g.name} avatar={g.avatar} size={58} />
          </span>
          <span className="story-bubble__name">{g.mine ? 'Your story' : g.name}</span>
        </button>
      ))}
      {hasMine && (
        <button className="story-bubble" onClick={props.onAdd} title="Add to your story">
          <span className="story-bubble__ring story-bubble__ring--add">
            <span className="story-bubble__addicon">
              <PlusIcon size={22} />
            </span>
          </span>
          <span className="story-bubble__name">Add</span>
        </button>
      )}
    </div>
  );
}

function MyCard({ onProfile }: { onProfile(): void }): ReactElement {
  const identity = useRiver((r) => r.identity);
  return (
    <button className="glass social__me" onClick={onProfile}>
      <Avatar id={identity?.riverId ?? 'me'} name={identity?.displayName ?? 'You'} size={44} />
      <span className="dm-row__text">
        <strong>{identity?.displayName ?? 'You'}</strong>
        <span className="muted small">View your profile</span>
      </span>
    </button>
  );
}

function Composer(props: {
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
  const story = props.kind === 'story';

  const share = async (): Promise<void> => {
    if ((!text.trim() && !files.length) || busy) return;
    try {
      setBusy(files.length ? 'Encrypting photos…' : 'Sharing…');
      const attachments = files.length ? await uploadAll(files, () => undefined, 'dm') : [];
      setBusy('Sharing…');
      const done = await social.run({ a: 'post', kind: props.kind, text, attachments, audience });
      if (done) {
        useCommunity.getState().notify(story ? 'Added to your story' : 'Shared');
        props.onClose();
      }
    } catch (err) {
      useCommunity.getState().notify((err as Error).message || 'Could not share.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={story ? 'Add to your story' : 'Create post'} onClose={props.onClose}>
      <div className="composer">
        <textarea
          autoFocus
          value={text}
          maxLength={2000}
          rows={story ? 3 : 5}
          placeholder={story ? 'Say something (shown for 24 hours)…' : 'What do you want to share?'}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length) {
              e.preventDefault();
              setFiles([...files, ...pendingFrom(pasted)].slice(0, 10));
            }
          }}
        />
        {files.length > 0 && (
          <PendingFiles files={files} onRemove={(k) => setFiles(files.filter((f) => f.key !== k))} />
        )}
        <div className="composer__row">
          <button className="btn btn--ghost btn--small" onClick={() => fileRef.current?.click()}>
            📷 Photos & videos
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) setFiles([...files, ...pendingFrom(e.target.files)].slice(0, 10));
              e.target.value = '';
            }}
          />
          <select
            className="composer__audience"
            aria-label="Who can see this"
            value={audience === 'friends' ? 'friends' : 'custom'}
            onChange={(e) => setAudience(e.target.value === 'friends' ? 'friends' : [])}
          >
            <option value="friends">👥 All friends ({props.friends.length})</option>
            <option value="custom">🔒 Only people I choose</option>
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
          Encrypted separately for each person who can see it. River's server only relays ciphertext.
        </p>
        <div className="modal__foot">
          <button
            className="btn btn--primary"
            disabled={
              !!busy || (!text.trim() && !files.length) || (audience !== 'friends' && audience.length === 0)
            }
            onClick={() => void share()}
          >
            {busy ?? (story ? 'Share to story' : 'Post')}
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
  const myName = useRiver((r) => r.identity?.displayName) ?? 'You';
  return (
    <article className="post glass">
      <header className="post__head">
        <button className="post__author" onClick={() => onProfile(post.author)}>
          <Avatar id={post.author} name={post.authorName} avatar={post.authorAvatar} size={40} />
          <span className="dm-row__text">
            <strong>{post.authorName}</strong>
            <span className="muted small">
              {ago(post.createdAt)}
              {post.mine
                ? ` · shared with ${post.audience} ${post.audience === 1 ? 'person' : 'people'}`
                : ''}
            </span>
          </span>
        </button>
        {post.mine && (
          <button
            className="icon-btn"
            aria-label="Post options"
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
                title: 'Delete post',
                body: 'It will be removed for everyone you shared it with.',
                action: 'Delete',
                run: async () => {
                  await social.run({ a: 'deletePost', postId: post.id });
                },
              });
            }}
          >
            Delete post
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
          aria-label={liked ? 'Unlike' : 'Like'}
          onClick={() => void social.run({ a: 'react', postId: post.id, emoji: '❤️', on: !liked })}
        >
          {liked ? '❤️' : '🤍'}
        </button>
        <button
          className="post__like"
          aria-label="React"
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
          View all {post.comments.length} comments
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
          void social.run({ a: 'comment', postId: post.id, text });
        }}
      >
        <input
          value={comment}
          maxLength={1000}
          placeholder="Add a comment…"
          onChange={(e) => setComment(e.target.value)}
        />
        <button className="btn btn--link" disabled={!comment.trim()}>
          Post
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

function StoryViewer(props: {
  feed: FeedView;
  at: { group: number; index: number };
  onMove(at: { group: number; index: number } | null): void;
  onClose(): void;
}): ReactElement {
  const group = props.feed.stories[props.at.group]!;
  const story = group.stories[props.at.index]!;
  // The decrypted image, remembered with the story it belongs to.
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  const url = loaded?.id === story.id ? loaded.url : null;
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const social = useSocial();
  const image = story.attachments.find((a) => a.mime.startsWith('image/'));

  const next = (): void => {
    if (props.at.index + 1 < group.stories.length)
      props.onMove({ group: props.at.group, index: props.at.index + 1 });
    else if (props.at.group + 1 < props.feed.stories.length)
      props.onMove({ group: props.at.group + 1, index: 0 });
    else props.onClose();
  };
  const prev = (): void => {
    if (props.at.index > 0) props.onMove({ group: props.at.group, index: props.at.index - 1 });
    else if (props.at.group > 0) props.onMove({ group: props.at.group - 1, index: 0 });
  };

  useEffect(() => {
    let live = true;
    if (image) {
      void decryptToUrl(image)
        .then((u) => live && setLoaded({ id: story.id, url: u }))
        .catch(() => undefined);
    }
    if (!story.mine && !story.seen) void social.run({ a: 'seen', postId: story.id });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id]);

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(next, STORY_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="story-viewer" role="dialog" aria-label={`${group.name}'s story`}>
      <div
        className="story-viewer__frame"
        onMouseDown={() => setPaused(true)}
        onMouseUp={() => setPaused(false)}
      >
        <div className="story-viewer__bars">
          {group.stories.map((s, i) => (
            <span key={s.id} className="story-viewer__bar">
              <span
                className={`story-viewer__fill ${i < props.at.index ? 'is-done' : i === props.at.index && !paused ? 'is-running' : ''}`}
                style={{ animationDuration: `${STORY_MS}ms` }}
              />
            </span>
          ))}
        </div>
        <header className="story-viewer__head">
          <Avatar id={group.riverId} name={group.name} avatar={group.avatar} size={32} />
          <strong>{group.mine ? 'Your story' : group.name}</strong>
          <span className="muted small">{ago(story.createdAt)}</span>
          <button className="icon-btn" aria-label="Close story" onClick={props.onClose}>
            <XIcon />
          </button>
        </header>
        <div className="story-viewer__content">
          {url ? (
            <img src={url} alt="" />
          ) : (
            !image && <div className="story-viewer__textonly">{story.text}</div>
          )}
          {image && story.text && <div className="story-viewer__caption">{story.text}</div>}
        </div>
        <button className="story-viewer__nav story-viewer__nav--prev" aria-label="Previous" onClick={prev} />
        <button className="story-viewer__nav story-viewer__nav--next" aria-label="Next" onClick={next} />
        <footer className="story-viewer__foot">
          {story.mine ? (
            <span className="muted small">
              👁 Seen by {story.viewers.length}
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
                  .run({ a: 'send', peer: group.riverId, text: `Replied to your story: ${text}` })
                  .then((ok) => ok && useCommunity.getState().notify(`Sent to ${group.name}`));
              }}
            >
              <input
                value={reply}
                placeholder={`Reply to ${group.name}…`}
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

function ProfileModal(props: {
  riverId: string;
  onClose(): void;
  onOpenPost(id: string): void;
}): ReactElement {
  const social = useSocial();
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  useEffect(() => {
    void social.run({ a: 'profile', riverId: props.riverId }).then((p) => p && setProfile(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.riverId]);
  return (
    <Modal onClose={props.onClose} wide className="profile-modal">
      {!profile ? (
        <p className="muted">Loading…</p>
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
                    void social.run({ a: 'setBio', bio }).then(() => {
                      setProfile({ ...profile, bio });
                      setBio(null);
                    });
                  }}
                >
                  <textarea
                    value={bio}
                    maxLength={300}
                    rows={3}
                    onChange={(e) => setBio(e.target.value)}
                    autoFocus
                  />
                  <div className="button-row">
                    <button className="btn btn--primary btn--small">Save</button>
                    <button type="button" className="btn btn--link" onClick={() => setBio(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <p className="profile-modal__bio">
                  {profile.bio || (profile.isMe ? 'Add a short bio.' : '')}
                </p>
              )}
              <div className="button-row">
                {profile.isMe && bio === null && (
                  <button className="btn btn--ghost btn--small" onClick={() => setBio(profile.bio)}>
                    Edit bio
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
                    Message
                  </button>
                )}
              </div>
            </div>
            <button className="icon-btn profile-modal__close" aria-label="Close" onClick={props.onClose}>
              <XIcon />
            </button>
          </div>
          <div className="profile-modal__posts">
            {profile.posts.length === 0 && <p className="muted">No posts yet.</p>}
            {profile.posts.map((p) => (
              <PostCard key={p.id} post={p} onProfile={() => undefined} />
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
