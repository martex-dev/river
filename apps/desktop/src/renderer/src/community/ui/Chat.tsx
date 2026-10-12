import { StickerButton, StickerImage } from './Stickers.tsx';
import { SavedPanel } from './Saved.tsx';
import { CreatePollDialog, PollView } from './Poll.tsx';
import { isVote } from '../../../../shared/poll.ts';
import { hasCriteria, parseSearch } from '../../../../shared/search-query.ts';
import { clockDateTime, clockTime } from '../../time.ts';
import { formatMessageLink } from '../message-link.ts';
import { ProfileCard } from './Members.tsx';
import { ForwardDialog } from './Forward.tsx';
import { useRiver } from '../../store.ts';
import { replaceCustomShortcodes, replaceShortcodes, searchEmoji, useEmojiIndex } from '../emoji-data.ts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, ChatMessage, CommunityView, LinkEmbed } from '../../../../shared/ipc.ts';
import { useShallow } from 'zustand/react/shallow';
import { useOutbox, type Outgoing } from '../outbox.ts';
import { useDraft } from '../drafts.ts';
import { play } from '../sound.ts';
import { typingNames, useCommunity } from '../store.ts';
import {
  AttachmentList,
  PendingFiles,
  UploadCancelled,
  pendingFrom,
  uploadAll,
  type PendingFile,
} from './Attachments.tsx';
import {
  Avatar,
  EditIcon,
  EmojiGlyph,
  EmojiPicker,
  customEmojiText,
  HashIcon,
  Highlight,
  MenuItem,
  PinIcon,
  PlusIcon,
  Popover,
  QUICK_REACTIONS,
  ReplyIcon,
  RichText,
  SmileIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
  can,
  hex,
  memberOf,
  type MentionRefs,
} from './common.tsx';

const GROUP_MS = 5 * 60_000;

const timeOf = (iso: string): string => clockTime(iso);

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function TextChannel(props: {
  community: CommunityView;
  channel: ChannelView;
  me: string;
}): ReactElement {
  const { community, channel, me } = props;
  const s = useCommunity();
  const messages = useCommunity((x) => x.messages[channel.id]) ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const myName = memberOf(community, me)?.name ?? null;
  const names = useMemo(() => community.members.map((m) => m.name), [community.members]);
  const refs = useMentionRefs(community, me);
  const outgoing = useOutbox(
    useShallow((o) => o.items.filter((i) => i.channelId === channel.id && !i.threadId)),
  );
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const canAttach = can(channel.permissions, Permission.ATTACH_FILES | Permission.SEND_MESSAGES);
  const addFiles = (files: Iterable<File>): void => {
    if (!canAttach) return s.notify('You cannot attach files in this channel.', 'error');
    const next = [...pending, ...pendingFrom(files)];
    if (next.length > 10) s.notify('You can attach up to 10 files to one message.', 'error');
    setPending(next.slice(0, 10));
  };

  // The "New messages" divider sits before the first message from someone else since you last read.
  const dividerAfter = useCommunity((x) => (x.divider?.channelId === channel.id ? x.divider.after : null));
  const firstNew = dividerAfter ? messages.find((m) => !m.mine && m.sentAt > dividerAfter) : undefined;
  const newCount = dividerAfter ? messages.filter((m) => !m.mine && m.sentAt > dividerAfter).length : 0;
  const scrolledToNew = useRef<string | null>(null);
  const lastOutgoing = useRef(0);

  // Coming back to a channel you had scrolled up in returns you to the same place.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const fromBottom = scrollMemory.get(channel.id);
    if (!el || fromBottom === undefined || fromBottom < 40) return;
    el.scrollTop = el.scrollHeight - el.clientHeight - fromBottom;
  }, [channel.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Your own message going out always brings you to the bottom.
    if (outgoing.length > lastOutgoing.current) {
      lastOutgoing.current = outgoing.length;
      el.scrollTop = el.scrollHeight;
      return;
    }
    lastOutgoing.current = outgoing.length;
    // Opening a channel with new messages starts at the divider, once.
    if (firstNew && scrolledToNew.current !== channel.id) {
      scrolledToNew.current = channel.id;
      document.getElementById(`msg-${firstNew.id}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    // Follow new messages at the bottom, but not if you had scrolled up in this channel.
    if (atBottom && (scrollMemory.get(channel.id) ?? 0) < 40) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, channel.id, outgoing.length]);

  const jumpTo = (id: string): void => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 1600);
  };

  // A message link or search result for this channel: scroll to it once it is on screen.
  const pendingJump = useCommunity((x) => x.pendingJump);
  const loadingBack = useRef(false);
  useEffect(() => {
    if (!pendingJump || pendingJump.channelId !== channel.id) return;
    if (messages.some((x) => x.id === pendingJump.messageId)) {
      useCommunity.setState({ pendingJump: null });
      window.setTimeout(() => jumpTo(pendingJump.messageId), 50);
    } else if (messages.length > 0 && !loadingBack.current) {
      // Further back: load older pages (up to ~2000 messages) until it is there.
      loadingBack.current = true;
      void (async () => {
        const target = pendingJump.messageId;
        for (let i = 0; i < 20; i++) {
          if ((useCommunity.getState().messages[channel.id] ?? []).some((x) => x.id === target)) break;
          if ((await useCommunity.getState().loadOlder(channel.id)) === 0) break;
        }
        loadingBack.current = false;
        const found = (useCommunity.getState().messages[channel.id] ?? []).some((x) => x.id === target);
        useCommunity.setState({ pendingJump: null });
        if (found) window.setTimeout(() => jumpTo(target), 80);
        else useCommunity.getState().notify('That message is too far back to show.');
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, messages.length, channel.id]);

  return (
    <div
      className="chat"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="drop-zone" aria-hidden="true">
          <div className="drop-zone__card">
            <strong>Upload to #{channel.name}</strong>
            <span className="muted small">Files are encrypted on your device before upload.</span>
          </div>
        </div>
      )}
      <header className="chat__head">
        <span className="channel__icon">
          {channel.announcement ? <span aria-hidden="true">📢</span> : <HashIcon size={20} />}
        </span>
        <strong>{channel.name}</strong>
        {channel.topic && <span className="chat__topic">{channel.topic}</span>}
        <span className="chat__head-actions">
          {can(community.permissions, Permission.CREATE_INVITE) && (
            <button
              className="icon-btn"
              aria-label="Invite people"
              title="Invite people"
              onClick={() => s.setModal({ kind: 'invite', communityId: community.id })}
            >
              <UserPlusIcon size={18} />
            </button>
          )}
          <button
            className={`icon-btn ${s.showSearch ? 'is-on' : ''}`}
            aria-label="Search"
            title="Search this community"
            onClick={() => useCommunity.setState({ showSearch: !s.showSearch })}
          >
            🔍
          </button>
          <button
            className={`icon-btn ${s.showSaved ? 'is-on' : ''}`}
            aria-label="Saved messages"
            title="Saved messages"
            onClick={() => useCommunity.setState({ showSaved: !s.showSaved, showPins: false })}
          >
            🔖
          </button>
          <button
            className={`icon-btn ${s.showPins ? 'is-on' : ''}`}
            aria-label="Pinned messages"
            title="Pinned messages"
            onClick={() => useCommunity.setState({ showPins: !s.showPins })}
          >
            <PinIcon size={18} />
          </button>
          <button
            className={`icon-btn ${s.showMembers ? 'is-on' : ''}`}
            aria-label="Member list"
            title="Show member list"
            onClick={() => useCommunity.setState({ showMembers: !s.showMembers })}
          >
            <UsersIcon size={18} />
          </button>
        </span>
      </header>
      {firstNew && (
        <div className="chat__new-bar" role="status">
          <button className="chat__new-bar-jump" onClick={() => jumpTo(firstNew.id)}>
            {newCount} new {newCount === 1 ? 'message' : 'messages'} since {timeOf(dividerAfter!)}
          </button>
          <button className="chat__new-bar-read" onClick={() => useCommunity.setState({ divider: null })}>
            Mark as read
          </button>
        </div>
      )}
      {s.showSaved && <SavedPanel />}
      {s.showPins && <PinsPanel community={community} channel={channel} me={me} onJump={jumpTo} />}
      {s.showSearch && <SearchPanel community={community} onJump={jumpTo} />}
      <div
        className="chat__messages"
        ref={scrollRef}
        onMouseDown={() => {
          // On narrow windows the member list is an overlay: clicking the chat closes it.
          if (window.innerWidth < 1100 && useCommunity.getState().showMembers) {
            useCommunity.setState({ showMembers: false });
          }
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          scrollMemory.set(channel.id, fromBottom);
          setAtBottom(fromBottom < 40);
        }}
      >
        {messages.length >= 100 && !s.noMore[channel.id] && (
          <div className="chat__older">
            <button
              className="btn btn--ghost btn--small"
              disabled={loadingOlder}
              onClick={() => {
                const el = scrollRef.current;
                const before = el ? el.scrollHeight - el.scrollTop : 0;
                setLoadingOlder(true);
                void s.loadOlder(channel.id).finally(() => {
                  setLoadingOlder(false);
                  // Keep the reader's place after older messages appear above.
                  requestAnimationFrame(() => {
                    if (el) el.scrollTop = el.scrollHeight - before;
                  });
                });
              }}
            >
              {loadingOlder ? 'Decrypting…' : 'Load older messages'}
            </button>
          </div>
        )}
        <div className="chat__welcome" hidden={messages.length >= 100 && !s.noMore[channel.id]}>
          <div className="chat__welcome-icon">
            <HashIcon size={34} />
          </div>
          <h2>Welcome to #{channel.name}!</h2>
          <p className="muted">
            This is the start of the #{channel.name} channel.{channel.topic ? ` ${channel.topic}` : ''}
          </p>
          {messages.length === 0 && <WelcomeActions community={community} channel={channel} />}
        </div>
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.sentAt).toDateString() !== new Date(m.sentAt).toDateString();
          const grouped =
            !newDay &&
            !m.replyTo &&
            prev !== undefined &&
            prev.sender === m.sender &&
            Date.parse(m.sentAt) - Date.parse(prev.sentAt) < GROUP_MS;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="chat__day">
                  <span>{dayLabel(m.sentAt)}</span>
                </div>
              )}
              {m.id === firstNew?.id && (
                <div className="chat__new" role="separator" aria-label="New messages">
                  <span>New</span>
                </div>
              )}
              <Message
                message={m}
                grouped={grouped}
                community={community}
                channel={channel}
                me={me}
                myName={myName}
                names={names}
                refs={refs}
                replied={m.replyTo ? messages.find((x) => x.id === m.replyTo) : undefined}
                onJump={jumpTo}
              />
            </div>
          );
        })}
        {outgoing.map((o) => (
          <OutgoingMessage key={o.localId} item={o} community={community} me={me} />
        ))}
      </div>
      {!atBottom && (
        <button
          className="chat__jump"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        >
          Jump to present
        </button>
      )}
      <SelectionBar channelId={channel.id} />
      <Composer
        community={community}
        channel={channel}
        me={me}
        names={names}
        pending={pending}
        canAttach={canAttach}
        onAddFiles={addFiles}
        onPendingChange={setPending}
      />
    </div>
  );
}

/** How far from the newest message each channel was left, for this session. */
const scrollMemory = new Map<string, number>();

function Message(props: {
  message: ChatMessage;
  grouped: boolean;
  community: CommunityView;
  channel: ChannelView;
  me: string;
  myName: string | null;
  names: string[];
  refs: MentionRefs;
  replied: ChatMessage | undefined;
  onJump(id: string): void;
}): ReactElement {
  const { message: m, community, channel } = props;
  const s = useCommunity();
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [profile, setProfile] = useState<{ x: number; y: number } | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [reactionsAt, setReactionsAt] = useState<{ x: number; y: number } | null>(null);
  const account = useRiver((r) => r.account);
  const editing = s.editing === m.id;
  const link = (): string | null =>
    account?.state === 'registered'
      ? formatMessageLink(account.shareUrl, {
          communityId: community.id,
          channelId: channel.id,
          messageId: m.id,
        })
      : null;
  const copyLink = (): void => {
    const l = link();
    if (l) void navigator.clipboard.writeText(l).then(() => play('success'));
  };
  const quote = (): void => {
    const quoted = m.text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    useCommunity.setState({ draftInsert: `${quoted}\n` });
    document.querySelector<HTMLTextAreaElement>('.chat__composer textarea')?.focus();
  };
  const openProfile = (e: { clientX: number; clientY: number }): void =>
    setProfile({ x: e.clientX + 12, y: e.clientY - 40 });
  const member = memberOf(community, m.sender);
  const color = member?.color ? hex(member.color) : undefined;
  const canManage = can(channel.permissions, Permission.MANAGE_MESSAGES);
  const canPin = canManage || can(channel.permissions, Permission.PIN_MESSAGES);
  const canReact = can(channel.permissions, Permission.ADD_REACTIONS);
  // Poll votes are reactions underneath; they show in the poll, not as reactions.
  const reactions = m.reactions.filter((r) => !isVote(r.emoji));
  const isSaved = useCommunity((x) => !!x.saved?.some((v) => v.messageId === m.id));
  // Very long messages start folded so the conversation stays readable.
  const long = m.text.length > 1500 || m.text.split('\n').length > 30;
  const [expanded, setExpanded] = useState(false);

  const react = (emoji: string, on: boolean): void => {
    if (on) play('reaction');
    void s.run({ a: 'react', channelId: channel.id, messageId: m.id, emoji, on });
  };
  const remove = (skipConfirm: boolean): void => {
    const go = async (): Promise<void> => {
      await s.run({ a: 'deleteMessage', messageId: m.id });
    };
    if (skipConfirm) void go();
    else
      s.setModal({
        kind: 'confirm',
        title: 'Delete message',
        body: 'Are you sure you want to delete this message? (Tip: hold Shift while clicking delete to skip this.)',
        action: 'Delete',
        run: go,
      });
  };

  const selecting = useCommunity((x) => (x.selecting?.channelId === channel.id ? x.selecting : null));
  const selected = !!selecting?.ids.includes(m.id);
  const toggleSelected = (): void => {
    const cur = useCommunity.getState().selecting;
    if (!cur) return;
    const ids = cur.ids.includes(m.id) ? cur.ids.filter((x) => x !== m.id) : [...cur.ids, m.id].slice(0, 100);
    useCommunity.setState({ selecting: { ...cur, ids } });
  };
  return (
    <div
      id={`msg-${m.id}`}
      className={`msg ${props.grouped ? 'msg--grouped' : ''} ${m.mine ? 'msg--mine' : ''} ${m.mentionsMe ? 'msg--mention' : ''} ${editing ? 'is-editing' : ''} ${selecting ? 'is-selecting' : ''} ${selected ? 'is-selected' : ''}`}
      onClickCapture={(e) => {
        if (!selecting) return;
        e.preventDefault();
        e.stopPropagation();
        toggleSelected();
      }}
      onContextMenu={(e) => {
        // Keep the browser's own menu for selected text (copy).
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {props.replied !== undefined || m.replyTo ? (
        <button className="msg__reply" onClick={() => m.replyTo && props.onJump(m.replyTo)}>
          <ReplyIcon size={13} />
          {props.replied ? (
            <>
              <strong>{props.replied.senderName}</strong>
              <span className="msg__reply-text">{props.replied.text.slice(0, 120)}</span>
            </>
          ) : (
            <span className="muted">Original message was deleted or is older</span>
          )}
        </button>
      ) : null}
      <div className="msg__row">
        {selecting && (
          <input
            type="checkbox"
            className="msg__select"
            aria-label={`Select message from ${m.senderName}`}
            checked={selected}
            readOnly
          />
        )}
        <div className="msg__gutter">
          {props.grouped ? (
            <time className="msg__hover-time">{timeOf(m.sentAt)}</time>
          ) : (
            <button
              type="button"
              className="msg__avatar-btn"
              aria-label={`${m.senderName}'s profile`}
              onClick={openProfile}
            >
              <Avatar id={m.sender} name={m.senderName} avatar={member?.avatar} size={38} />
            </button>
          )}
        </div>
        <div className="msg__body">
          {!props.grouped && (
            <div className="msg__meta">
              <button
                type="button"
                className="msg__author"
                style={color ? { color } : undefined}
                onClick={openProfile}
              >
                {m.senderName}
              </button>
              {member?.roleIcon && (
                <span className="role-icon" title="Role icon" aria-hidden="true">
                  {member.roleIcon}
                </span>
              )}
              <time
                className="muted small msg__time"
                title={`${new Date(m.sentAt).toLocaleString()} · click to copy a link to this message`}
                onClick={copyLink}
              >
                {dayLabel(m.sentAt) === 'Today' ? `Today at ${timeOf(m.sentAt)}` : clockDateTime(m.sentAt)}
              </time>
              {m.pinned && (
                <span className="msg__pinned" title="Pinned">
                  <PinIcon size={12} />
                </span>
              )}
            </div>
          )}
          {editing ? (
            <EditBox message={m} />
          ) : (
            <div className="msg__text">
              {m.text && (
                <div className={long && !expanded ? 'msg__long is-collapsed' : undefined}>
                  <RichText text={m.text} names={props.names} me={props.myName} refs={props.refs} />
                </div>
              )}
              {long && (
                <button className="btn btn--link msg__more" onClick={() => setExpanded(!expanded)}>
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
              {m.editedAt && (
                <span className="msg__edited" title={new Date(m.editedAt).toLocaleString()}>
                  {' '}
                  (edited)
                </span>
              )}
            </div>
          )}
          {m.poll && <PollView message={m} me={props.me} canVote={canReact} />}
          {m.embed && <LinkCard embed={m.embed} />}
          {m.sticker && <StickerImage id={m.sticker} />}
          {m.attachments.length > 0 && <AttachmentList attachments={m.attachments} alts={m.alts} />}
          {m.thread && (
            <button className="thread-summary" onClick={() => void s.showThread(channel.id, m.id)}>
              <span aria-hidden="true">🧵</span>
              <strong>{m.thread.name}</strong>
              <span>
                {m.thread.count} {m.thread.count === 1 ? 'reply' : 'replies'}
              </span>
              {m.thread.lastAt && <span className="muted small">· {timeOf(m.thread.lastAt)}</span>}
              {m.thread.archived && <span className="chip">Archived</span>}
            </button>
          )}
          {reactions.length > 0 && (
            <div className="reactions">
              {reactions.map((r) => (
                <button
                  key={r.tag}
                  className={`reaction ${r.mine ? 'is-mine' : ''}`}
                  title={r.users.map((u) => memberOf(community, u)?.name ?? 'Someone').join(', ')}
                  onClick={() => react(r.emoji, !r.mine)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setReactionsAt({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className="reaction__emoji">
                    <EmojiGlyph emoji={r.emoji} />
                  </span>
                  <span key={r.count} className="reaction__count">
                    {r.count}
                  </span>
                </button>
              ))}
              {canReact && (
                <button
                  className="reaction reaction--add"
                  aria-label="Add reaction"
                  onClick={(e) => setPicker({ x: e.clientX, y: e.clientY - 320 })}
                >
                  <SmileIcon size={15} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {!editing && (
        <div className="msg__actions" role="toolbar" aria-label="Message actions">
          {canReact &&
            QUICK_REACTIONS.slice(0, 3).map((e) => (
              <button
                key={e}
                className="msg__action msg__action--emoji"
                title={`React ${e}`}
                onClick={() => react(e, true)}
              >
                {e}
              </button>
            ))}
          {canReact && (
            <button
              className="msg__action"
              aria-label="Add reaction"
              title="Add reaction"
              onClick={(e) => setPicker({ x: e.clientX - 300, y: e.clientY + 12 })}
            >
              <SmileIcon size={17} />
            </button>
          )}
          {can(channel.permissions, Permission.SEND_MESSAGES) && (
            <button
              className="msg__action"
              aria-label="Reply"
              title="Reply"
              onClick={() => {
                useCommunity.setState({ replyTo: m });
                document.querySelector<HTMLTextAreaElement>('.chat__composer textarea')?.focus();
              }}
            >
              <ReplyIcon size={17} />
            </button>
          )}
          {can(channel.permissions, Permission.SEND_MESSAGES) && !m.threadId && (
            <button
              className="msg__action"
              aria-label={m.thread ? 'Open thread' : 'Create thread'}
              title={m.thread ? 'Open thread' : 'Create thread'}
              onClick={() => {
                if (m.thread) return void s.showThread(channel.id, m.id);
                const name = (m.text.split('\n')[0] ?? '').slice(0, 40).trim() || 'Thread';
                void s
                  .run({ a: 'createThread', channelId: channel.id, messageId: m.id, name })
                  .then(() => s.showThread(channel.id, m.id));
              }}
            >
              🧵
            </button>
          )}
          {m.mine && !m.poll && (
            <button
              className="msg__action"
              aria-label="Edit"
              title="Edit"
              onClick={() => useCommunity.setState({ editing: m.id })}
            >
              <EditIcon size={17} />
            </button>
          )}
          {canPin && (
            <button
              className="msg__action"
              aria-label={m.pinned ? 'Unpin' : 'Pin'}
              title={m.pinned ? 'Unpin message' : 'Pin message'}
              onClick={() => void s.run({ a: 'pin', messageId: m.id, pinned: !m.pinned })}
            >
              <PinIcon size={17} />
            </button>
          )}
          {(m.mine || canManage) && (
            <button
              className="msg__action msg__action--danger"
              aria-label="Delete"
              title="Delete"
              onClick={(e) => remove(e.shiftKey)}
            >
              <TrashIcon size={17} />
            </button>
          )}
        </div>
      )}
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          {canReact && (
            <MenuItem
              icon={<SmileIcon size={16} />}
              onClick={() => {
                setMenu(null);
                setPicker({ x: menu.x, y: menu.y - 320 });
              }}
            >
              Add reaction
            </MenuItem>
          )}
          {can(channel.permissions, Permission.SEND_MESSAGES) && (
            <MenuItem
              icon={<ReplyIcon size={16} />}
              onClick={() => {
                setMenu(null);
                useCommunity.setState({ replyTo: m });
                document.querySelector<HTMLTextAreaElement>('.chat__composer textarea')?.focus();
              }}
            >
              Reply
            </MenuItem>
          )}
          {can(channel.permissions, Permission.SEND_MESSAGES) && !m.threadId && (
            <MenuItem
              icon={<span aria-hidden="true">🧵</span>}
              onClick={() => {
                setMenu(null);
                if (m.thread) return void s.showThread(channel.id, m.id);
                const name = (m.text.split('\n')[0] ?? '').slice(0, 40).trim() || 'Thread';
                void s
                  .run({ a: 'createThread', channelId: channel.id, messageId: m.id, name })
                  .then(() => s.showThread(channel.id, m.id));
              }}
            >
              {m.thread ? 'Open thread' : 'Create thread'}
            </MenuItem>
          )}
          {m.text && (
            <MenuItem
              icon={<span aria-hidden="true">📋</span>}
              onClick={() => {
                setMenu(null);
                void navigator.clipboard.writeText(m.text).then(() => play('success'));
              }}
            >
              Copy text
            </MenuItem>
          )}
          {m.text && can(channel.permissions, Permission.SEND_MESSAGES) && (
            <MenuItem
              icon={<span aria-hidden="true">❝</span>}
              onClick={() => {
                setMenu(null);
                quote();
              }}
            >
              Quote
            </MenuItem>
          )}
          {m.text && (
            <MenuItem
              icon={<span aria-hidden="true">↪</span>}
              onClick={() => {
                setMenu(null);
                setForwarding(true);
              }}
            >
              Forward
            </MenuItem>
          )}
          {reactions.length > 0 && (
            <MenuItem
              icon={<SmileIcon size={16} />}
              onClick={() => {
                setMenu(null);
                setReactionsAt(menu);
              }}
            >
              View reactions
            </MenuItem>
          )}
          <MenuItem
            icon={<span aria-hidden="true">🔖</span>}
            onClick={() => {
              setMenu(null);
              void s.toggleSaved(channel.id, m.id, !isSaved);
            }}
          >
            {isSaved ? 'Remove from saved' : 'Save message'}
          </MenuItem>
          <MenuItem
            icon={<span aria-hidden="true">🔗</span>}
            onClick={() => {
              setMenu(null);
              copyLink();
            }}
          >
            Copy message link
          </MenuItem>
          {m.mine && !m.poll && (
            <MenuItem
              icon={<EditIcon size={16} />}
              onClick={() => {
                setMenu(null);
                useCommunity.setState({ editing: m.id });
              }}
            >
              Edit message
            </MenuItem>
          )}
          {canPin && (
            <MenuItem
              icon={<PinIcon size={16} />}
              onClick={() => {
                setMenu(null);
                void s.run({ a: 'pin', messageId: m.id, pinned: !m.pinned });
              }}
            >
              {m.pinned ? 'Unpin message' : 'Pin message'}
            </MenuItem>
          )}
          <MenuItem
            icon={<span aria-hidden="true">●</span>}
            onClick={() => {
              setMenu(null);
              s.markUnreadFrom(m);
            }}
          >
            Mark unread
          </MenuItem>
          {canManage && (
            <MenuItem
              icon={<span aria-hidden="true">☑</span>}
              onClick={() => {
                setMenu(null);
                useCommunity.setState({ selecting: { channelId: channel.id, ids: [m.id] } });
              }}
            >
              Select messages
            </MenuItem>
          )}
          {!m.mine && (
            <MenuItem
              danger
              icon={<span aria-hidden="true">⚑</span>}
              onClick={() => {
                setMenu(null);
                s.setModal({ kind: 'report', communityId: community.id, message: m });
              }}
            >
              Report message
            </MenuItem>
          )}
          {(m.mine || canManage) && (
            <MenuItem
              danger
              icon={<TrashIcon size={16} />}
              onClick={() => {
                setMenu(null);
                remove(false);
              }}
            >
              Delete message
            </MenuItem>
          )}
        </Popover>
      )}
      {profile && member && (
        <Popover x={profile.x} y={profile.y} onClose={() => setProfile(null)} className="profile-pop">
          <ProfileCard community={community} member={member} me={props.me} onDone={() => setProfile(null)} />
        </Popover>
      )}
      {reactionsAt && (
        <Popover
          x={reactionsAt.x}
          y={reactionsAt.y}
          onClose={() => setReactionsAt(null)}
          className="reactions-pop"
        >
          <div role="list" aria-label="Who reacted">
            {reactions.map((r) => (
              <div key={r.tag} role="listitem" className="reactions-pop__row">
                <span className="reactions-pop__emoji" aria-hidden="true">
                  <EmojiGlyph emoji={r.emoji} />
                </span>
                <span className="reactions-pop__count">{r.count}</span>
                <span className="reactions-pop__names">
                  {r.users.map((u) => memberOf(community, u)?.name ?? 'Someone').join(', ')}
                </span>
              </div>
            ))}
          </div>
        </Popover>
      )}
      {forwarding && (
        <ForwardDialog
          text={m.text}
          from={{ name: m.senderName, channel: channel.name }}
          onClose={() => setForwarding(false)}
        />
      )}
      {picker && (
        <Popover x={picker.x} y={picker.y} onClose={() => setPicker(null)}>
          <EmojiPicker
            custom={s.emojis[community.id]}
            onPick={(e) => {
              setPicker(null);
              const existing = m.reactions.find((r) => r.emoji === e);
              react(e, !existing?.mine);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function EditBox({ message }: { message: ChatMessage }): ReactElement {
  const [text, setText] = useState(message.text);
  const s = useCommunity();
  const save = async (): Promise<void> => {
    const value = text.trim();
    if (!value) return;
    if (value !== message.text) {
      await s.run({ a: 'edit', channelId: message.channelId, messageId: message.id, text: value });
    }
    useCommunity.setState({ editing: null });
  };
  return (
    <div className="msg__edit">
      <textarea
        autoFocus
        value={text}
        maxLength={4000}
        rows={Math.min(8, text.split('\n').length)}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.setSelectionRange(text.length, text.length)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') useCommunity.setState({ editing: null });
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <span className="muted small">
        escape to{' '}
        <button className="btn--link" onClick={() => useCommunity.setState({ editing: null })}>
          cancel
        </button>{' '}
        • enter to{' '}
        <button className="btn--link" onClick={() => void save()}>
          save
        </button>
      </span>
    </div>
  );
}

function Composer(props: {
  community: CommunityView;
  channel: ChannelView;
  me: string;
  names: string[];
  pending: PendingFile[];
  canAttach: boolean;
  onAddFiles(files: Iterable<File>): void;
  onPendingChange(files: PendingFile[]): void;
}): ReactElement {
  const { community, channel, me } = props;
  const s = useCommunity();
  // Each channel keeps its own unsent text while River is open (never written to disk).
  const [text, setText] = useDraft(`c:${channel.id}`);
  // Replies notify the person you reply to, unless you switch it off for that reply (like Discord's "@ ON").
  const [pingOffFor, setPingOffFor] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  // Quote puts the quoted lines in front of whatever is being written.
  useEffect(
    () =>
      useCommunity.subscribe((state) => {
        const insert = state.draftInsert;
        if (insert === null) return;
        useCommunity.setState({ draftInsert: null });
        setText((t) => `${insert}${t}`);
      }),
    [setText],
  );
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const lastTyping = useRef(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  useCommunity((x) => x.typing[channel.id]);
  const typers = typingNames(channel.id, community, me);
  const canSend = can(channel.permissions, Permission.SEND_MESSAGES);
  const replyTo = s.replyTo && s.replyTo.channelId === channel.id ? s.replyTo : null;
  const replyPing = !replyTo || pingOffFor !== replyTo.id;

  // Autocomplete for @people, @roles, @everyone/@here and #channels: the word being typed at the caret.
  const trigger = /(?:^|\s)([@#])([^\s@#]*)$/.exec(text);
  // …and for :emoji: — type a colon and two letters.
  const emojiTrigger = /(?:^|\s):([a-z0-9_+-]{2,32})$/i.exec(text);
  const emojiIndex = useEmojiIndex(!!emojiTrigger || text.includes(':'));
  const mentionChoices = trigger ? suggest(community, channel, trigger[1] as '@' | '#', trigger[2]!) : [];
  const customEmoji = s.emojis[community.id] ?? [];
  const customChoices: Suggestion[] = emojiTrigger
    ? customEmoji
        .filter((e) => e.name.toLowerCase().includes(emojiTrigger[1]!.toLowerCase()))
        .slice(0, 8)
        .map((e) => ({
          key: `ce:${e.id}`,
          insert: customEmojiText(e),
          symbol: ':' as const,
          hint: community.name,
          label: `:${e.name}:`,
        }))
    : [];
  const suggestions: Suggestion[] =
    mentionChoices.length > 0
      ? mentionChoices
      : emojiTrigger && (emojiIndex || customChoices.length)
        ? [
            ...customChoices,
            ...(emojiIndex ? searchEmoji(emojiIndex, emojiTrigger[1]!, 8) : []).map((e) => ({
              key: `e:${e.emoji}`,
              insert: e.emoji,
              symbol: ':' as const,
              hint: e.label,
              label: `:${e.shortcodes[0] ?? e.label.replace(/\s+/g, '_')}:`,
            })),
          ].slice(0, 8)
        : [];

  const complete = (choice: Suggestion): void => {
    if (choice.symbol === ':') setText(text.replace(/:([a-z0-9_+-]*)$/i, `${choice.insert} `));
    else setText(text.replace(/([@#])([^\s@#]*)$/, `$1${choice.insert} `));
    setMentionIndex(0);
    ref.current?.focus();
  };

  const send = async (): Promise<void> => {
    const withCustom = replaceCustomShortcodes(text.trim(), customEmoji);
    const value = emojiIndex ? replaceShortcodes(withCustom, emojiIndex) : withCustom;
    const files = props.pending;
    if ((!value && files.length === 0) || uploading) return;
    let attachments;
    let alts: Record<string, string> | undefined;
    if (files.length) {
      setUploading({ done: 0, total: files.length });
      const abort = new AbortController();
      uploadAbort.current = abort;
      try {
        attachments = await uploadAll(
          files,
          (done) => setUploading({ done, total: files.length }),
          'community',
          abort.signal,
        );
      } catch (err) {
        setUploading(null);
        // Cancelled: everything stays in the box to send later.
        if (err instanceof UploadCancelled)
          s.notify('Upload cancelled. Your message and files are still here.');
        else s.notify((err as Error).message || 'Upload failed.', 'error');
        return;
      } finally {
        uploadAbort.current = null;
      }
      const described = files.flatMap((f, i) =>
        f.alt && attachments![i] ? [[attachments![i]!.id, f.alt]] : [],
      );
      if (described.length) alts = Object.fromEntries(described);
    }
    setText('');
    setUploading(null);
    useCommunity.setState({ replyTo: null });
    // A link preview, only if you turned them on (made here, sealed in the message), within a moment.
    const link = useRiver.getState().settings?.appearance.linkPreviews ? firstLink(value) : null;
    const embed = link
      ? await Promise.race([
          window.river.links.preview(link).catch(() => null),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000)),
        ])
      : null;
    // Answering means you have caught up.
    if (useCommunity.getState().divider?.channelId === channel.id) useCommunity.setState({ divider: null });
    for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
    props.onPendingChange([]);
    // The outbox shows it as sending, waits if offline and keeps it with Retry if it fails.
    useOutbox.getState().send({
      channelId: channel.id,
      text: value,
      ...(replyTo ? { replyTo: replyTo.id } : {}),
      ...(replyTo && !replyPing ? { noPing: true } : {}),
      ...(attachments ? { attachments } : {}),
      ...(alts ? { alts } : {}),
      ...(embed ? { embed } : {}),
    });
  };

  if (!canSend) {
    const timeout = community.members.find((m) => m.riverId === me)?.timeoutUntil;
    return (
      <div className="chat__composer chat__composer--locked">
        <span className="muted">
          {timeout
            ? `You're timed out until ${new Date(timeout).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}. You can still read.`
            : channel.announcement
              ? 'This is an announcement channel: only people who manage messages post here.'
              : 'You do not have permission to send messages in this channel.'}
        </span>
      </div>
    );
  }

  const slowed =
    channel.slowmode > 0 &&
    !can(channel.permissions, Permission.MANAGE_MESSAGES) &&
    !can(channel.permissions, Permission.MANAGE_CHANNELS);

  return (
    <div className="chat__composer-wrap">
      {slowed && (
        <div className="composer-note" role="note">
          🐢 Slowmode is on: one message every {formatSlowmode(channel.slowmode)}.
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mention-menu" role="listbox" aria-label="Suggestions">
          {suggestions.map((choice, i) => (
            <button
              key={choice.key}
              role="option"
              aria-selected={i === mentionIndex}
              className={`mention-menu__item ${i === mentionIndex ? 'is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                complete(choice);
              }}
            >
              {choice.symbol === ':' ? (
                <span className="mention-menu__emoji" aria-hidden="true">
                  <EmojiGlyph emoji={choice.insert} />
                </span>
              ) : choice.member ? (
                <Avatar
                  id={choice.member.riverId}
                  name={choice.member.name}
                  avatar={choice.member.avatar}
                  size={20}
                />
              ) : (
                <span
                  className="mention-menu__dot"
                  style={choice.color ? { background: hex(choice.color) } : undefined}
                  aria-hidden="true"
                >
                  {choice.symbol}
                </span>
              )}
              <span
                className="mention-menu__label"
                style={choice.color ? { color: hex(choice.color) } : undefined}
              >
                {choice.symbol === ':' ? choice.label : `${choice.symbol}${choice.insert}`}
              </span>
              {choice.hint && <span className="mention-menu__hint">{choice.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="reply-bar">
          <span>
            Replying to <strong>{replyTo.senderName}</strong>
          </span>
          {!replyTo.mine && (
            <button
              type="button"
              className={`reply-bar__ping ${replyPing ? 'is-on' : ''}`}
              aria-pressed={replyPing}
              title={
                replyPing
                  ? `${replyTo.senderName} will be notified`
                  : `${replyTo.senderName} won't be notified`
              }
              onClick={() => setPingOffFor(replyPing ? replyTo.id : null)}
            >
              @ {replyPing ? 'ON' : 'OFF'}
            </button>
          )}
          <button
            className="icon-btn"
            aria-label="Cancel reply"
            onClick={() => useCommunity.setState({ replyTo: null })}
          >
            <XIcon size={14} />
          </button>
        </div>
      )}
      {props.pending.length > 0 && (
        <PendingFiles
          files={props.pending}
          onRemove={(key) => props.onPendingChange(props.pending.filter((p) => p.key !== key))}
          onAlt={(key, alt) =>
            props.onPendingChange(props.pending.map((p) => (p.key === key ? { ...p, alt } : p)))
          }
        />
      )}
      {uploading && (
        <div className="upload-progress" role="status">
          Encrypting and uploading{' '}
          {uploading.done + 1 > uploading.total ? uploading.total : uploading.done + 1} of {uploading.total}…
          <span
            className="upload-progress__bar"
            style={{ width: `${(uploading.done / uploading.total) * 100}%` }}
          />
          <button
            type="button"
            className="btn btn--link btn--small"
            onClick={() => uploadAbort.current?.abort()}
          >
            Cancel
          </button>
        </div>
      )}
      {polling && <CreatePollDialog channelId={channel.id} onClose={() => setPolling(false)} />}
      <form
        className={`chat__composer ${replyTo ? 'has-reply' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          className="icon-btn composer__poll"
          aria-label="Create a poll"
          title="Create a poll"
          onClick={() => setPolling(true)}
        >
          📊
        </button>
        <StickerButton community={community} channelId={channel.id} />
        {props.canAttach && (
          <>
            <button
              type="button"
              className="icon-btn composer__attach"
              aria-label="Attach files"
              title="Attach files"
              onClick={() => fileRef.current?.click()}
            >
              <PlusIcon size={20} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) props.onAddFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        )}
        <textarea
          ref={ref}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              props.onAddFiles(files);
            }
          }}
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          value={text}
          maxLength={4000}
          placeholder={`Message #${channel.name}`}
          onChange={(e) => {
            setText(e.target.value);
            const now = Date.now();
            if (e.target.value && now - lastTyping.current > 3000) {
              lastTyping.current = now;
              void window.river.community.action({ a: 'typing', channelId: channel.id });
            }
          }}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const d = e.key === 'ArrowDown' ? 1 : -1;
                setMentionIndex((mentionIndex + d + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                complete(suggestions[Math.min(mentionIndex, suggestions.length - 1)]!);
                return;
              }
            }
            if (e.key === 'Escape' && replyTo) useCommunity.setState({ replyTo: null });
            if (e.key === 'ArrowUp' && text === '') {
              const mine = [...(s.messages[channel.id] ?? [])].reverse().find((m) => m.mine && !m.poll);
              if (mine) {
                e.preventDefault();
                useCommunity.setState({ editing: mine.id });
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Emoji"
          title="Emoji"
          onClick={(e) => setPicker({ x: e.clientX - 300, y: e.clientY - 330 })}
        >
          <SmileIcon size={20} />
        </button>
        <button
          className="btn btn--primary"
          disabled={(text.trim() === '' && props.pending.length === 0) || !!uploading}
        >
          Send
        </button>
      </form>
      <div className="typing" aria-live="polite">
        {typers.length > 0 && (
          <>
            <span className="typing__dots">
              <i />
              <i />
              <i />
            </span>
            <span>
              {typers.length > 3
                ? 'Several people are typing…'
                : `${typers.join(', ')} ${typers.length === 1 ? 'is' : 'are'} typing…`}
            </span>
          </>
        )}
      </div>
      {picker && (
        <Popover x={picker.x} y={picker.y} onClose={() => setPicker(null)}>
          <EmojiPicker
            custom={s.emojis[community.id]}
            onPick={(e) => {
              setText(text + e);
              setPicker(null);
              ref.current?.focus();
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function PinsPanel(props: {
  community: CommunityView;
  channel: ChannelView;
  me: string;
  onJump(id: string): void;
}): ReactElement {
  const s = useCommunity();
  const [pins, setPins] = useState<ChatMessage[] | null>(null);
  const messages = useCommunity((x) => x.messages[props.channel.id]);
  useEffect(() => {
    void s.run({ a: 'pins', channelId: props.channel.id }).then((p) => setPins(p ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.channel.id, messages]);
  return (
    <div className="pins">
      <header className="pins__head">
        <PinIcon size={16} /> <strong>Pinned messages</strong>
        <button
          className="icon-btn"
          aria-label="Close pinned messages"
          onClick={() => useCommunity.setState({ showPins: false })}
        >
          <XIcon size={14} />
        </button>
      </header>
      {pins === null && <p className="muted small">Loading…</p>}
      {pins?.length === 0 && <p className="muted small">This channel has no pinned messages yet.</p>}
      {pins?.map((m) => (
        <button key={m.id} className="pins__item" onClick={() => props.onJump(m.id)}>
          <Avatar
            id={m.sender}
            name={m.senderName}
            avatar={memberOf(props.community, m.sender)?.avatar}
            size={24}
          />
          <span>
            <strong>{m.senderName}</strong>{' '}
            <time className="muted small">{new Date(m.sentAt).toLocaleDateString()}</time>
            <span className="pins__text">{m.text.slice(0, 200)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const SEARCH_HINTS: Array<[string, string]> = [
  ['from:', 'from a person'],
  ['in:', 'in a channel'],
  ['has:image', 'with a picture'],
  ['has:file', 'with a file'],
  ['has:link', 'with a link'],
  ['mentions:me', 'mentioning you'],
  ['pinned:true', 'pinned'],
  ['before:', 'before a date (YYYY-MM-DD)'],
  ['after:', 'after a date'],
];

function SearchPanel(props: { community: CommunityView; onJump(id: string): void }): ReactElement {
  const s = useCommunity();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatMessage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const channelName = (id: string): string =>
    props.community.channels.find((c) => c.id === id)?.name ?? 'channel';
  const parsed = parseSearch(query);
  const search = async (q: string): Promise<ChatMessage[] | null> => {
    if (!hasCriteria(parseSearch(q))) return null;
    setBusy(true);
    const found = await s.run({
      a: 'search',
      communityId: props.community.id,
      query: q.trim().slice(0, 100),
    });
    setBusy(false);
    return found ?? [];
  };
  const run = async (): Promise<void> => {
    const found = await search(query);
    if (found) setResults(found);
  };
  const open = (m: ChatMessage): void => {
    useCommunity.setState({ showSearch: false });
    s.openMessage(m.communityId, m.channelId, m.id);
  };
  const jumpToDate = async (): Promise<void> => {
    const here = props.community.channels.find((c) => c.id === s.selectedChannel);
    if (!date || !here) return;
    const found = (await search(`in:"${here.name}" during:${date}`))?.filter((m) => m.channelId === here.id);
    const first = found?.at(-1);
    if (first) open(first);
    else s.notify(`No messages in #${here.name} on that day.`);
  };
  const addHint = (hint: string): void => {
    const next = `${query.trim()} ${hint}`.trimStart();
    setQuery(next);
    inputRef.current?.focus();
  };
  return (
    <div className="pins search-panel">
      <header className="pins__head">
        <strong>Search {props.community.name}</strong>
        <button
          className="icon-btn"
          aria-label="Close search"
          onClick={() => useCommunity.setState({ showSearch: false })}
        >
          <XIcon size={14} />
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          className="search"
          placeholder="Search — try from:name has:image"
          aria-label="Search messages and files"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      {results === null && (
        <div className="search-hints" aria-label="Search filters">
          {SEARCH_HINTS.map(([hint, label]) => (
            <button key={hint} className="chip" title={label} onClick={() => addHint(hint)}>
              {hint}
            </button>
          ))}
        </div>
      )}
      <div className="search-date">
        <label className="muted small" htmlFor="jump-date">
          Jump to a date in this channel
        </label>
        <input id="jump-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn btn--small" disabled={!date || busy} onClick={() => void jumpToDate()}>
          Go
        </button>
      </div>
      <p className="muted small">
        Searched on this device — the server cannot read your messages, so it cannot search them.
      </p>
      {busy && <p className="muted small">Decrypting and searching…</p>}
      {results?.length === 0 && !busy && <p className="muted small">No results.</p>}
      {results && results.length > 0 && !busy && (
        <p className="muted small">
          {results.length === 100 ? 'The 100 newest results' : `${results.length} results`}
        </p>
      )}
      {results?.map((m) => (
        <button key={m.id} className="pins__item" onClick={() => open(m)}>
          <span>
            <strong>{m.senderName}</strong>{' '}
            <span className="muted small">
              #{channelName(m.channelId)} · {new Date(m.sentAt).toLocaleDateString()}
            </span>
            <span className="pins__text">
              {m.text ? (
                <Highlight text={m.text} query={parsed.text} />
              ) : (
                m.attachments.map((a) => a.name).join(', ')
              )}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** The first web link in a message, outside `code` (for a link preview). */
export function firstLink(text: string): string | null {
  const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const m = /https?:\/\/[^\s<>()]+[^\s<>().,!?:;'"]/.exec(plain);
  return m ? m[0] : null;
}

/** A sender-made link preview (1.0.23): opening it asks first, like any link. */
function LinkCard({ embed }: { embed: LinkEmbed }): ReactElement {
  return (
    <div className="link-card">
      <span className="link-card__site muted small">{embed.site}</span>
      <button className="link-card__title" onClick={() => void window.river.links.openUrl(embed.url)}>
        {embed.title}
      </button>
      {embed.description && <span className="link-card__text small">{embed.description}</span>}
    </div>
  );
}

/** Moderators: delete several selected messages at once (1.0.24). */
function SelectionBar({ channelId }: { channelId: string }): ReactElement | null {
  const s = useCommunity();
  const selecting = useCommunity((x) => (x.selecting?.channelId === channelId ? x.selecting : null));
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useCommunity.setState({ selecting: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);
  if (!selecting) return null;
  const n = selecting.ids.length;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected messages">
      <span>
        <strong>{n}</strong> selected · click messages to add or remove (up to 100)
      </span>
      <button className="btn btn--link btn--small" onClick={() => useCommunity.setState({ selecting: null })}>
        Cancel
      </button>
      <button
        className="btn btn--danger btn--small"
        disabled={n === 0}
        onClick={() =>
          s.setModal({
            kind: 'confirm',
            title: `Delete ${n} message${n === 1 ? '' : 's'}?`,
            body: 'They are removed for everyone, with their threads. This cannot be undone.',
            action: 'Delete',
            run: async () => {
              const res = await s.run({ a: 'bulkDelete', channelId, messageIds: selecting.ids });
              if (res !== null) {
                useCommunity.setState({ selecting: null });
                s.notify(`Deleted ${n} message${n === 1 ? '' : 's'}.`);
              }
            },
          })
        }
      >
        Delete {n}
      </button>
    </div>
  );
}

/** Ways to break the ice in an empty channel: wave, or invite people if you are alone. */
function WelcomeActions(props: { community: CommunityView; channel: ChannelView }): ReactElement | null {
  const { community, channel } = props;
  const s = useCommunity();
  const [busy, setBusy] = useState(false);
  const alone = community.members.length <= 1;
  const canWave = can(channel.permissions, Permission.SEND_MESSAGES);
  const canInvite = can(community.permissions, Permission.CREATE_INVITE);
  if (!canWave && !(alone && canInvite)) return null;
  return (
    <div className="chat__welcome-actions">
      {alone && (
        <p className="muted small">It's just you here for now — invite a few friends to get started.</p>
      )}
      <div className="button-row">
        {alone && canInvite && (
          <button
            className="btn btn--primary btn--small"
            onClick={() => s.setModal({ kind: 'invite', communityId: community.id })}
          >
            Invite friends
          </button>
        )}
        {canWave && (
          <button
            className="btn btn--ghost btn--small wave-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void s.run({ a: 'send', channelId: channel.id, text: '👋' }).then((sent) => {
                setBusy(false);
                if (!sent) return;
                play('send');
                s.handle({ t: 'message', message: sent, isNew: false });
              });
            }}
          >
            <span className="wave-btn__hand" aria-hidden="true">
              👋
            </span>{' '}
            Wave to say hi
          </button>
        )}
      </div>
    </div>
  );
}

interface Suggestion {
  key: string;
  /** Text inserted after the @ or # (an emoji replaces the whole :code). */
  insert: string;
  symbol: '@' | '#' | ':';
  /** Shown instead of the inserted text (emoji: their :shortcode:). */
  label?: string;
  hint: string;
  color?: number;
  member?: { riverId: string; name: string; avatar: string | null };
}

/** What can be mentioned here, best matches first, at most 8. */
function suggest(
  community: CommunityView,
  channel: ChannelView,
  symbol: '@' | '#',
  query: string,
): Suggestion[] {
  const q = query.toLowerCase();
  const matches = (name: string): boolean => name.toLowerCase().includes(q);
  const rank = (name: string): number => (name.toLowerCase().startsWith(q) ? 0 : 1);
  if (symbol === '#') {
    return community.channels
      .filter((c) => c.kind === 'text' && matches(c.name))
      .sort((a, b) => rank(a.name) - rank(b.name))
      .slice(0, 8)
      .map((c) => ({ key: `c:${c.id}`, insert: c.name, symbol: '#' as const, hint: c.topic.slice(0, 40) }));
  }
  const all = can(channel.permissions, Permission.MENTION_EVERYONE);
  const special: Suggestion[] = all
    ? [
        {
          key: 's:everyone',
          insert: 'everyone',
          symbol: '@',
          hint: 'Notify everyone who can see this channel',
        },
        { key: 's:here', insert: 'here', symbol: '@', hint: 'Notify everyone online right now' },
      ]
    : [];
  const roles: Suggestion[] = community.roles
    .filter((r) => !r.everyone && (r.mentionable || all))
    .map((r) => ({
      key: `r:${r.id}`,
      insert: r.name,
      symbol: '@',
      hint: 'Role',
      color: r.color || undefined,
    }));
  const members: Suggestion[] = community.members.map((m) => ({
    key: `m:${m.riverId}`,
    insert: m.name,
    symbol: '@',
    hint: m.online ? '' : 'Offline',
    member: { riverId: m.riverId, name: m.name, avatar: m.avatar },
  }));
  return [...special, ...members, ...roles]
    .filter((x) => matches(x.insert))
    .sort((a, b) => rank(a.insert) - rank(b.insert))
    .slice(0, 8);
}

/** Roles and channels for highlighting mentions; clicking a #channel opens it. */
function useMentionRefs(community: CommunityView, me: string): MentionRefs {
  const select = useCommunity((x) => x.selectChannel);
  return useMemo(() => {
    const mine = community.members.find((m) => m.riverId === me)?.roles ?? [];
    return {
      roles: community.roles
        .filter((r) => !r.everyone)
        .map((r) => ({ name: r.name, color: r.color, mine: mine.includes(r.id) })),
      channels: community.channels.filter((c) => c.kind === 'text').map((c) => ({ id: c.id, name: c.name })),
      onChannel: select,
    };
  }, [community.roles, community.members, community.channels, me, select]);
}

/** A message on its way out: sending, waiting for the connection, or failed with Retry. */
function OutgoingMessage(props: { item: Outgoing; community: CommunityView; me: string }): ReactElement {
  const { item } = props;
  const member = memberOf(props.community, props.me);
  const outbox = useOutbox();
  return (
    <div className={`msg msg--mine msg--outgoing msg--${item.status}`} aria-live="polite">
      <div className="msg__row">
        <div className="msg__gutter">
          <Avatar id={props.me} name={member?.name ?? 'You'} avatar={member?.avatar} size={40} />
        </div>
        <div className="msg__body">
          <div className="msg__meta">
            <strong className="msg__author">{member?.name ?? 'You'}</strong>
            <span className="msg__status">
              {item.status === 'sending'
                ? 'Sending…'
                : item.status === 'waiting'
                  ? 'Waiting for connection — it will send when you are back online'
                  : 'Not sent'}
            </span>
          </div>
          <div className="msg__text">{item.text || `📎 ${item.attachments?.length ?? 0} file(s)`}</div>
          {item.status === 'failed' && (
            <div className="msg__failed" role="alert">
              <span>{item.error ?? 'Something went wrong.'}</span>
              <button className="btn btn--link btn--small" onClick={() => outbox.retry(item.localId)}>
                Retry
              </button>
              <button className="btn btn--link btn--small" onClick={() => outbox.discard(item.localId)}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSlowmode(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minute${seconds >= 120 ? 's' : ''}`;
  return `${Math.round(seconds / 3600)} hour${seconds >= 7200 ? 's' : ''}`;
}
