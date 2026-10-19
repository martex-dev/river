import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, ChatMessage, CommunityView } from '../../../../shared/ipc.ts';
import { relativeTime } from '../../time.ts';
import { useCommunity } from '../store.ts';
import { Avatar, MenuItem, Modal, Popover, can, hex } from './common.tsx';
import { tr } from '../../i18n.ts';

type Sort = 'activity' | 'newest';

/** The posts of a forum, newest activity first (pure, for tests). */
export function forumPosts(
  messages: ChatMessage[],
  opts: { query: string; tag: string | null; sort: Sort },
): ChatMessage[] {
  const q = opts.query.trim().toLowerCase();
  return messages
    .filter((m) => !m.threadId)
    .filter((m) => !opts.tag || (m.tags ?? []).includes(opts.tag))
    .filter(
      (m) =>
        !q ||
        (m.thread?.name ?? '').toLowerCase().includes(q) ||
        m.text.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        // Pinned posts stay on top.
        Number(b.pinned) - Number(a.pinned) ||
        (opts.sort === 'newest'
          ? b.sentAt.localeCompare(a.sentAt)
          : (b.thread?.lastAt ?? b.sentAt).localeCompare(a.thread?.lastAt ?? a.sentAt)),
    );
}

/**
 * The post a message link in a forum opens: the post itself, or the post a loaded reply belongs to
 * (pure, for tests). Null when it is not loaded here.
 */
export function forumJumpTarget(
  messages: ChatMessage[],
  threads: Record<string, ChatMessage[]>,
  messageId: string,
): string | null {
  const m = messages.find((x) => x.id === messageId);
  if (m) return m.threadId ?? m.id;
  const posts = new Set(messages.map((x) => x.id));
  for (const [rootId, replies] of Object.entries(threads))
    if (posts.has(rootId) && replies.some((x) => x.id === messageId)) return rootId;
  return null;
}

/** A forum channel (1.0.22): posts as cards; open one to read and reply in its thread. */
export function ForumChannel(props: { community: CommunityView; channel: ChannelView }): ReactElement {
  const { community, channel } = props;
  const loaded = useCommunity((x) => x.messages[channel.id]);
  const messages = useMemo(() => loaded ?? [], [loaded]);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('activity');
  const [writing, setWriting] = useState(false);
  const posts = useMemo(() => forumPosts(messages, { query, tag, sort }), [messages, query, tag, sort]);
  const canPost = can(channel.permissions, Permission.SEND_MESSAGES);
  const canModerate = can(channel.permissions, Permission.MANAGE_MESSAGES);
  const [menu, setMenu] = useState<{ x: number; y: number; m: ChatMessage } | null>(null);
  // Opening a post loads its replies, so they show and live replies keep arriving.
  const open = (m: ChatMessage): void => void useCommunity.getState().showThread(channel.id, m.id);

  // A message link to a post here (or a reply in one): open that post once it is loaded.
  const pendingJump = useCommunity((x) => x.pendingJump);
  const ready = loaded !== undefined;
  useEffect(() => {
    if (!pendingJump || pendingJump.channelId !== channel.id || !ready) return;
    const target = pendingJump.messageId;
    let cancelled = false;
    void (async () => {
      const find = (): string | null => {
        const st = useCommunity.getState();
        return forumJumpTarget(st.messages[channel.id] ?? [], st.threads, target);
      };
      // Further back: older pages of posts (up to ~2000) until it is there.
      for (let i = 0; i < 20 && !find() && !cancelled; i++)
        if ((await useCommunity.getState().loadOlder(channel.id)) === 0) break;
      if (cancelled) return;
      useCommunity.setState({ pendingJump: null });
      const rootId = find();
      if (rootId) void useCommunity.getState().showThread(channel.id, rootId);
      else
        useCommunity.getState().notify(tr('Open the post to find that message; it could not be shown here.'));
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingJump, ready, channel.id]);
  return (
    <div className="chat forum">
      <header className="chat__head">
        <span className="channel__icon" aria-hidden="true">
          🗂️
        </span>
        <strong>{channel.name}</strong>
        {channel.topic && <span className="chat__topic">{channel.topic}</span>}
      </header>
      <div className="forum__bar">
        <input
          className="search"
          placeholder={tr('Search posts')}
          aria-label={tr('Search posts')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label={tr('Sort posts')} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="activity">{tr('Latest activity')}</option>
          <option value="newest">{tr('Newest posts')}</option>
        </select>
        {canPost && (
          <button className="btn btn--primary btn--small" onClick={() => setWriting(true)}>
            {tr('New post')}
          </button>
        )}
      </div>
      {channel.tags.length > 0 && (
        <div className="forum__tags" role="group" aria-label={tr('Filter by tag')}>
          {channel.tags.map((t) => (
            <button
              key={t}
              className={`chip forum__tag ${tag === t ? 'is-active' : ''}`}
              aria-pressed={tag === t}
              onClick={() => setTag(tag === t ? null : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="forum__posts">
        {posts.length === 0 && (
          <div className="forum__empty">
            <p className="muted">
              {messages.length === 0
                ? tr('No posts yet. Start the first conversation!')
                : tr('No posts match. Try another search or tag.')}
            </p>
            {canPost && messages.length === 0 && (
              <button className="btn btn--primary" onClick={() => setWriting(true)}>
                {tr('New post')}
              </button>
            )}
          </div>
        )}
        {posts.map((m) => {
          const member = community.members.find((x) => x.riverId === m.sender);
          return (
            <button
              key={m.id}
              className={`forum-post ${m.pinned ? 'is-pinned' : ''}`}
              onClick={() => open(m)}
              onContextMenu={(e) => {
                if (!canModerate) return;
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, m });
              }}
            >
              <span className="forum-post__title">
                {m.pinned && (
                  <span aria-label={tr('Pinned')} title={tr('Pinned')}>
                    📌{' '}
                  </span>
                )}
                {m.thread?.name ?? m.text.split('\n')[0]?.slice(0, 100) ?? tr('Post')}
              </span>
              {(m.tags ?? []).length > 0 && (
                <span className="forum-post__tags">
                  {m.tags!.map((t) => (
                    <span key={t} className="chip forum__tag">
                      {t}
                    </span>
                  ))}
                </span>
              )}
              <span className="forum-post__text muted small">{m.text.slice(0, 160)}</span>
              <span className="forum-post__meta small">
                <Avatar id={m.sender} name={m.senderName} avatar={member?.avatar} size={18} />
                <span style={member?.color ? { color: hex(member.color) } : undefined}>{m.senderName}</span>
                <span className="muted">
                  · 💬 {m.thread?.count ?? 0} · {relativeTime(m.thread?.lastAt ?? m.sentAt)}
                </span>
                {m.thread?.archived && <span className="muted">· {tr('closed')}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          <MenuItem
            onClick={() => {
              setMenu(null);
              void useCommunity.getState().run({ a: 'pin', messageId: menu.m.id, pinned: !menu.m.pinned });
            }}
          >
            {menu.m.pinned ? tr('Unpin post') : tr('Pin post')}
          </MenuItem>
          {menu.m.thread && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                void useCommunity.getState().run({
                  a: 'updateThread',
                  channelId: channel.id,
                  messageId: menu.m.id,
                  archived: !menu.m.thread?.archived,
                });
              }}
            >
              {menu.m.thread.archived ? tr('Reopen post') : tr('Close post')}
            </MenuItem>
          )}
        </Popover>
      )}
      {writing && <NewPostDialog channel={channel} onClose={() => setWriting(false)} onPosted={open} />}
    </div>
  );
}

function NewPostDialog(props: {
  channel: ChannelView;
  onClose(): void;
  onPosted(m: ChatMessage): void;
}): ReactElement {
  const s = useCommunity();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const post = async (): Promise<void> => {
    if (!title.trim() || !text.trim()) return;
    setBusy(true);
    const sent = await s.run({
      a: 'send',
      channelId: props.channel.id,
      text: text.trim(),
      title: title.trim(),
      ...(tags.length ? { tags } : {}),
    });
    setBusy(false);
    if (sent) {
      props.onClose();
      void s.loadMessages(props.channel.id);
      props.onPosted(sent);
    }
  };
  return (
    <Modal title={tr('New post in {name}', { name: props.channel.name })} onClose={props.onClose}>
      <form
        className="create-channel"
        onSubmit={(e) => {
          e.preventDefault();
          void post();
        }}
      >
        <label className="textfield">
          <span className="field__label">{tr('Title')}</span>
          <input autoFocus value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="textfield">
          <span className="field__label">{tr('Message')}</span>
          <textarea value={text} rows={5} maxLength={4000} onChange={(e) => setText(e.target.value)} />
        </label>
        {props.channel.tags.length > 0 && (
          <fieldset className="forum__tags">
            <legend className="field__label">{tr('Tags (up to 5)')}</legend>
            {props.channel.tags.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip forum__tag ${tags.includes(t) ? 'is-active' : ''}`}
                aria-pressed={tags.includes(t)}
                onClick={() =>
                  setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t].slice(0, 5))
                }
              >
                {t}
              </button>
            ))}
          </fieldset>
        )}
        <div className="modal__foot">
          <button type="button" className="btn btn--link" onClick={props.onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn--primary" disabled={!title.trim() || !text.trim() || busy}>
            {tr('Post')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Channel settings: forum switch and the tags people can pick. */
export function ForumSettings({ channel }: { channel: ChannelView }): ReactElement {
  const s = useCommunity();
  const [draft, setDraft] = useState('');
  const save = (tags: string[]): void => void s.run({ a: 'updateChannel', channelId: channel.id, tags });
  return (
    <div className="forum-settings">
      <div className="field__label">{tr('Post tags')}</div>
      <div className="forum__tags">
        {channel.tags.map((t) => (
          <span key={t} className="chip forum__tag">
            {t}
            <button
              type="button"
              className="forum__tag-x"
              aria-label={tr('Remove tag {name}', { name: t })}
              onClick={() => save(channel.tags.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="forum-settings__add"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim().slice(0, 24);
          if (!t || channel.tags.includes(t) || channel.tags.length >= 20) return;
          save([...channel.tags, t]);
          setDraft('');
        }}
      >
        <input
          value={draft}
          maxLength={24}
          placeholder={tr('Add a tag (e.g. Question)')}
          aria-label={tr('New tag')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn btn--small" disabled={!draft.trim() || channel.tags.length >= 20}>
          {tr('Add')}
        </button>
      </form>
    </div>
  );
}
