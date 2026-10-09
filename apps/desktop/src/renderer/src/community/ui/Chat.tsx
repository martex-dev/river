import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { ChannelView, ChatMessage, CommunityView } from '../../../../shared/ipc.ts';
import { play } from '../sound.ts';
import { typingNames, useCommunity } from '../store.ts';
import { AttachmentList, PendingFiles, pendingFrom, uploadAll, type PendingFile } from './Attachments.tsx';
import {
  Avatar,
  EditIcon,
  EmojiPicker,
  HashIcon,
  Highlight,
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

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Opening a channel with new messages starts at the divider, once.
    if (firstNew && scrolledToNew.current !== channel.id) {
      scrolledToNew.current = channel.id;
      document.getElementById(`msg-${firstNew.id}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    if (atBottom) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, channel.id]);

  const jumpTo = (id: string): void => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('is-flash');
    window.setTimeout(() => el.classList.remove('is-flash'), 1600);
  };

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
          <HashIcon size={20} />
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
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
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
  const editing = s.editing === m.id;
  const member = memberOf(community, m.sender);
  const color = member?.color ? hex(member.color) : undefined;
  const canManage = can(channel.permissions, Permission.MANAGE_MESSAGES);
  const canPin = canManage || can(channel.permissions, Permission.PIN_MESSAGES);
  const canReact = can(channel.permissions, Permission.ADD_REACTIONS);

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

  return (
    <div
      id={`msg-${m.id}`}
      className={`msg ${props.grouped ? 'msg--grouped' : ''} ${m.mine ? 'msg--mine' : ''} ${m.mentionsMe ? 'msg--mention' : ''} ${editing ? 'is-editing' : ''}`}
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
        <div className="msg__gutter">
          {props.grouped ? (
            <time className="msg__hover-time">{timeOf(m.sentAt)}</time>
          ) : (
            <Avatar id={m.sender} name={m.senderName} avatar={member?.avatar} size={38} />
          )}
        </div>
        <div className="msg__body">
          {!props.grouped && (
            <div className="msg__meta">
              <strong style={color ? { color } : undefined}>{m.senderName}</strong>
              <time className="muted small" title={new Date(m.sentAt).toLocaleString()}>
                {dayLabel(m.sentAt) === 'Today'
                  ? `Today at ${timeOf(m.sentAt)}`
                  : new Date(m.sentAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
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
              {m.text && <RichText text={m.text} names={props.names} me={props.myName} refs={props.refs} />}
              {m.editedAt && (
                <span className="msg__edited" title={new Date(m.editedAt).toLocaleString()}>
                  {' '}
                  (edited)
                </span>
              )}
            </div>
          )}
          {m.attachments.length > 0 && <AttachmentList attachments={m.attachments} />}
          {m.reactions.length > 0 && (
            <div className="reactions">
              {m.reactions.map((r) => (
                <button
                  key={r.tag}
                  className={`reaction ${r.mine ? 'is-mine' : ''}`}
                  title={r.users.map((u) => memberOf(community, u)?.name ?? 'Someone').join(', ')}
                  onClick={() => react(r.emoji, !r.mine)}
                >
                  <span className="reaction__emoji">{r.emoji}</span>
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
          {m.mine && (
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
      {picker && (
        <Popover x={picker.x} y={picker.y} onClose={() => setPicker(null)}>
          <EmojiPicker
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
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const lastTyping = useRef(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  useCommunity((x) => x.typing[channel.id]);
  const typers = typingNames(channel.id, community, me);
  const canSend = can(channel.permissions, Permission.SEND_MESSAGES);
  const replyTo = s.replyTo && s.replyTo.channelId === channel.id ? s.replyTo : null;

  // Autocomplete for @people, @roles, @everyone/@here and #channels: the word being typed at the caret.
  const trigger = /(?:^|\s)([@#])([^\s@#]*)$/.exec(text);
  const suggestions = trigger ? suggest(community, channel, trigger[1] as '@' | '#', trigger[2]!) : [];

  const complete = (choice: Suggestion): void => {
    setText(text.replace(/([@#])([^\s@#]*)$/, `$1${choice.insert} `));
    setMentionIndex(0);
    ref.current?.focus();
  };

  const send = async (): Promise<void> => {
    const value = text.trim();
    const files = props.pending;
    if ((!value && files.length === 0) || uploading) return;
    let attachments;
    if (files.length) {
      setUploading({ done: 0, total: files.length });
      try {
        attachments = await uploadAll(files, (done) => setUploading({ done, total: files.length }));
      } catch (err) {
        setUploading(null);
        s.notify((err as Error).message || 'Upload failed.', 'error');
        return;
      }
    }
    setText('');
    useCommunity.setState({ replyTo: null });
    const sent = await s.run({
      a: 'send',
      channelId: channel.id,
      text: value,
      ...(replyTo ? { replyTo: replyTo.id } : {}),
      ...(attachments ? { attachments } : {}),
    });
    setUploading(null);
    if (!sent) setText(value);
    else {
      play('send');
      // Answering means you have caught up.
      if (useCommunity.getState().divider?.channelId === channel.id) useCommunity.setState({ divider: null });
      for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
      props.onPendingChange([]);
      s.handle({ t: 'message', message: sent, isNew: false });
    }
  };

  if (!canSend) {
    return (
      <div className="chat__composer chat__composer--locked">
        <span className="muted">You do not have permission to send messages in this channel.</span>
      </div>
    );
  }

  return (
    <div className="chat__composer-wrap">
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
              {choice.member ? (
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
                {choice.symbol === '#' ? '#' : '@'}
                {choice.insert}
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
        </div>
      )}
      <form
        className={`chat__composer ${replyTo ? 'has-reply' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
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
              const mine = [...(s.messages[channel.id] ?? [])].reverse().find((m) => m.mine);
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

function SearchPanel(props: { community: CommunityView; onJump(id: string): void }): ReactElement {
  const s = useCommunity();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatMessage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const channelName = (id: string): string =>
    props.community.channels.find((c) => c.id === id)?.name ?? 'channel';
  const run = async (): Promise<void> => {
    if (query.trim().length < 2) return;
    setBusy(true);
    const found = await s.run({ a: 'search', communityId: props.community.id, query: query.trim() });
    setBusy(false);
    setResults(found ?? []);
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
          autoFocus
          className="search"
          placeholder="Search messages and files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <p className="muted small">
        Searched on this device — the server cannot read your messages, so it cannot search them.
      </p>
      {busy && <p className="muted small">Decrypting and searching…</p>}
      {results?.length === 0 && !busy && <p className="muted small">No results.</p>}
      {results?.map((m) => (
        <button
          key={m.id}
          className="pins__item"
          onClick={() => {
            useCommunity.setState({ showSearch: false });
            if (s.selectedChannel !== m.channelId) s.selectChannel(m.channelId);
            window.setTimeout(() => props.onJump(m.id), 400);
          }}
        >
          <span>
            <strong>{m.senderName}</strong>{' '}
            <span className="muted small">
              #{channelName(m.channelId)} · {new Date(m.sentAt).toLocaleDateString()}
            </span>
            <span className="pins__text">
              {m.text ? (
                <Highlight text={m.text} query={query} />
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
  /** Text inserted after the @ or #. */
  insert: string;
  symbol: '@' | '#';
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
