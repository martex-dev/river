import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { ConversationView, DirectMessageView } from '../../../shared/dm.ts';
import { play } from '../community/sound.ts';
import { useCommunity } from '../community/store.ts';
import {
  AttachmentList,
  PendingFiles,
  pendingFrom,
  uploadAll,
  type PendingFile,
} from '../community/ui/Attachments.tsx';
import {
  Avatar,
  CameraIcon,
  EditIcon,
  EmojiPicker,
  Highlight,
  MenuItem,
  Modal,
  PhoneIcon,
  PlusIcon,
  Popover,
  QUICK_REACTIONS,
  ReplyIcon,
  RichText,
  SmileIcon,
  Toggle,
  TrashIcon,
  XIcon,
} from '../community/ui/common.tsx';
import { isTyping, useDm } from '../dm/store.ts';
import { startDmCall, useDmCall } from '../dm/call.ts';
import { DmCallPanel } from '../dm/CallUi.tsx';
import { useRiver } from '../store.ts';

const GROUP_MS = 5 * 60_000;
const RIVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return timeOf(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function MessagesPage(): ReactElement {
  const dm = useDm();
  const account = useRiver((r) => r.account);
  const [composing, setComposing] = useState(false);
  const [safety, setSafety] = useState<string | null>(null);

  useEffect(() => {
    void dm.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.state]);

  if (account.state !== 'registered') {
    return (
      <div className="page">
        <header className="page__header">
          <div className="eyebrow">Messages</div>
          <h1 className="page__title">Private conversations</h1>
          <p className="page__lead">
            Direct messages need an account on a River server. Join a community with an invite link, or create
            an account in Settings → Server.
          </p>
        </header>
      </div>
    );
  }

  const conversation = dm.conversations.find((c) => c.riverId === dm.selected) ?? null;
  return (
    <div className="dms">
      <ConversationList onNew={() => setComposing(true)} />
      <section className="dms__main">
        {conversation ? (
          <Conversation
            key={conversation.riverId}
            conversation={conversation}
            onSafety={() => setSafety(conversation.riverId)}
          />
        ) : (
          <div className="dms__empty">
            <div className="dms__empty-icon">💬</div>
            <h2>Your messages</h2>
            <p className="muted">
              Messages are end-to-end encrypted with the Signal protocol. Only you and the person you talk to
              can read them.
            </p>
            <button className="btn btn--primary" onClick={() => setComposing(true)}>
              New message
            </button>
          </div>
        )}
      </section>
      {composing && <NewMessage onClose={() => setComposing(false)} />}
      {safety && <SafetyNumber peer={safety} onClose={() => setSafety(null)} />}
    </div>
  );
}

function ConversationList({ onNew }: { onNew(): void }): ReactElement {
  const dm = useDm();
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const filtered = dm.conversations.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  const [results, setFound] = useState<DirectMessageView[]>([]);
  const found = query.trim().length >= 2 ? results : [];
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = window.setTimeout(() => {
      void window.river.dm.action({ a: 'search', query: q }).then((r) => r.ok && setFound(r.value));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);
  const requests = filtered.filter((c) => c.state === 'request');
  const chats = filtered.filter((c) => c.state !== 'request');
  return (
    <aside className="dms__list" aria-label="Conversations">
      <div className="dms__list-head">
        <strong>Messages</strong>
        <button className="icon-btn" aria-label="New message" title="New message" onClick={onNew}>
          <PlusIcon size={18} />
        </button>
      </div>
      <input
        className="search dms__search"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {found.length > 0 && (
        <>
          <div className="channel-group__head">
            <span>Messages — {found.length}</span>
          </div>
          {found.map((m) => {
            const conv = dm.conversations.find((c) => c.riverId === m.peer);
            return (
              <button key={m.id} className="dm-row" onClick={() => dm.select(m.peer)}>
                <span className="dm-row__text">
                  <span className="dm-row__top">
                    <strong>{conv?.name ?? m.senderName}</strong>
                    <time className="muted small">{shortWhen(m.sentAt)}</time>
                  </span>
                  <span className="dm-row__last muted small">
                    {m.mine ? 'You: ' : conv?.kind === 'group' ? `${m.senderName}: ` : ''}
                    {m.text ? (
                      <Highlight text={m.text} query={query} max={120} />
                    ) : (
                      m.attachments.map((a) => a.name).join(', ')
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </>
      )}
      {requests.length > 0 && (
        <>
          <div className="channel-group__head">
            <span>Message requests — {requests.length}</span>
          </div>
          {requests.map((c) => (
            <ConversationRow key={c.riverId} c={c} />
          ))}
        </>
      )}
      <div className="channel-group__head">
        <span>Direct messages</span>
      </div>
      {chats.length === 0 && <p className="muted small dms__hint">No conversations yet.</p>}
      {chats.map((c) => (
        <ConversationRow key={c.riverId} c={c} />
      ))}
      {dm.myId && (
        <div className="dms__me">
          <span className="muted small">Your River ID — share it so people can message you</span>
          <button
            className="dms__id"
            title="Copy your River ID"
            onClick={() =>
              void navigator.clipboard.writeText(dm.myId!).then(() => (play('success'), setCopied(true)))
            }
          >
            <code>{dm.myId}</code>
            <span>{copied ? 'Copied ✓' : 'Copy'}</span>
          </button>
        </div>
      )}
    </aside>
  );
}

function ConversationRow({ c }: { c: ConversationView }): ReactElement {
  const dm = useDm();
  useDm((x) => x.typing[c.riverId]);
  const typing = isTyping(c.riverId);
  return (
    <button
      className={`dm-row ${dm.selected === c.riverId ? 'is-active' : ''} ${c.unread ? 'is-unread' : ''} ${c.state === 'blocked' ? 'is-blocked' : ''}`}
      onClick={() => dm.select(c.riverId)}
    >
      {c.kind === 'group' ? (
        <GroupAvatar c={c} size={36} />
      ) : (
        <Avatar id={c.riverId} name={c.name} avatar={c.avatar} size={36} />
      )}
      <span className="dm-row__text">
        <span className="dm-row__top">
          <strong>{c.name}</strong>
          {c.verified && (
            <span className="dm-row__verified" title="Verified">
              ✓
            </span>
          )}
          {c.last && <time className="muted small">{shortWhen(c.last.sentAt)}</time>}
        </span>
        <span className="dm-row__last muted small">
          {typing ? (
            <em>typing…</em>
          ) : c.state === 'blocked' ? (
            'Blocked'
          ) : c.state === 'left' ? (
            'You left this group'
          ) : c.last ? (
            `${c.last.mine ? 'You: ' : ''}${c.last.text}`
          ) : (
            'No messages yet'
          )}
        </span>
      </span>
      {c.unread > 0 && (
        <span key={c.unread} className="badge badge--mention">
          {c.unread}
        </span>
      )}
    </button>
  );
}

function Conversation(props: { conversation: ConversationView; onSafety(): void }): ReactElement {
  const c = props.conversation;
  const dm = useDm();
  const messages = useDm((x) => x.messages[c.riverId]) ?? [];
  const myName = useRiver((r) => r.identity?.displayName) ?? 'You';
  const myId = dm.myId ?? '';
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const notify = useCommunity((s) => s.notify);
  const setModal = useCommunity((s) => s.setModal);
  const activeCall = useDmCall((s) => s.active);
  const [showMembers, setShowMembers] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const onFocus = (): void => void window.river.dm.action({ a: 'read', peer: c.riverId });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [c.riverId]);

  const addFiles = (files: Iterable<File>): void => {
    const next = [...pending, ...pendingFrom(files)];
    if (next.length > 10) notify('You can attach up to 10 files to one message.', 'error');
    setPending(next.slice(0, 10));
  };

  const confirmRemove = (): void =>
    setModal({
      kind: 'confirm',
      title: `Delete conversation with ${c.name}`,
      body: 'This deletes the messages on this device only. The other person keeps their copy.',
      action: 'Delete',
      run: async () => {
        await dm.run({ a: 'removeConversation', peer: c.riverId });
        dm.select(null);
      },
    });

  return (
    <div
      className="chat"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files') || c.state === 'blocked') return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
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
            <strong>Send to {c.name}</strong>
            <span className="muted small">Files are encrypted on your device before upload.</span>
          </div>
        </div>
      )}
      <header className="chat__head">
        {c.kind === 'group' ? (
          <GroupAvatar c={c} size={28} />
        ) : (
          <Avatar id={c.riverId} name={c.name} avatar={c.avatar} size={28} />
        )}
        <strong>{c.name}</strong>
        {c.kind === 'group' ? (
          <button className="chip dm-lock" onClick={() => setShowMembers(!showMembers)} title="Group members">
            👥 {c.members.length} members
          </button>
        ) : (
          <button
            className={`chip dm-lock ${c.verified ? 'is-verified' : ''}`}
            onClick={props.onSafety}
            title="View safety number"
          >
            {c.verified ? '✓ Verified' : '🔒 Encrypted'}
          </button>
        )}
        <span className="chat__head-actions">
          {c.kind === 'direct' && c.state === 'accepted' && (
            <>
              <button
                className="icon-btn"
                aria-label="Start voice call"
                title="Start voice call"
                disabled={!!activeCall}
                onClick={() => void startDmCall(c.riverId, false)}
              >
                <PhoneIcon size={18} />
              </button>
              <button
                className="icon-btn"
                aria-label="Start video call"
                title="Start video call"
                disabled={!!activeCall}
                onClick={() => void startDmCall(c.riverId, true)}
              >
                <CameraIcon size={18} />
              </button>
            </>
          )}
          <button
            className="icon-btn"
            aria-label="Conversation options"
            title="More"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.right - 220, y: r.bottom + 4 });
            }}
          >
            ⋯
          </button>
        </span>
      </header>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          {c.kind === 'group' ? (
            <>
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  setShowMembers(true);
                }}
              >
                Members
              </MenuItem>
              {c.isAdmin && (
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    setRenaming(c.name);
                  }}
                >
                  Rename group
                </MenuItem>
              )}
              {c.isAdmin && (
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    setAdding(true);
                  }}
                >
                  Add people
                </MenuItem>
              )}
              {c.state !== 'left' && (
                <MenuItem
                  danger
                  onClick={() => {
                    setMenu(null);
                    setModal({
                      kind: 'confirm',
                      title: `Leave ${c.name}`,
                      body: 'You will stop receiving messages from this group.',
                      action: 'Leave group',
                      run: async () => {
                        await dm.run({ a: 'leaveGroup', peer: c.riverId });
                      },
                    });
                  }}
                >
                  Leave group
                </MenuItem>
              )}
            </>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  props.onSafety();
                }}
              >
                View safety number
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  void navigator.clipboard
                    .writeText(c.riverId)
                    .then(() => (play('success'), notify('River ID copied')));
                }}
              >
                Copy River ID
              </MenuItem>
            </>
          )}
          {c.kind === 'group' ? null : c.state === 'blocked' ? (
            <MenuItem
              onClick={() => {
                setMenu(null);
                void dm.run({ a: 'unblock', peer: c.riverId });
              }}
            >
              Unblock
            </MenuItem>
          ) : (
            <MenuItem
              danger
              onClick={() => {
                setMenu(null);
                void dm.run({ a: 'block', peer: c.riverId });
              }}
            >
              Block
            </MenuItem>
          )}
          <MenuItem
            danger
            icon={<TrashIcon size={16} />}
            onClick={() => {
              setMenu(null);
              confirmRemove();
            }}
          >
            Delete conversation
          </MenuItem>
        </Popover>
      )}
      <DmCallPanel conversation={c} />
      {showMembers && c.kind === 'group' && <GroupMembers c={c} onClose={() => setShowMembers(false)} />}
      {renaming !== null && (
        <Modal title="Rename group" onClose={() => setRenaming(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void dm
                .run({ a: 'renameGroup', peer: c.riverId, name: renaming.trim() })
                .then(() => setRenaming(null));
            }}
          >
            <label className="textfield">
              <span className="field__label">Group name</span>
              <input
                autoFocus
                value={renaming}
                maxLength={64}
                onChange={(e) => setRenaming(e.target.value)}
              />
            </label>
            <div className="modal__foot">
              <button className="btn btn--primary" disabled={!renaming.trim()}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
      {adding && (
        <PeoplePicker
          title={`Add people to ${c.name}`}
          exclude={c.members.map((m) => m.riverId)}
          action="Add"
          onClose={() => setAdding(false)}
          onPick={async (ids) => {
            const ok = await dm.run({ a: 'addGroupMembers', peer: c.riverId, members: ids });
            if (ok !== null) setAdding(false);
          }}
        />
      )}
      {c.keyChanged && (
        <div className="dm-banner dm-banner--warn" role="alert">
          <span>
            <strong>Your safety number with {c.name} changed.</strong> This happens when they reinstall River
            or change devices — or if someone is intercepting. Compare safety numbers to be sure.
          </span>
          <button className="btn btn--ghost btn--small" onClick={props.onSafety}>
            Verify
          </button>
          <button
            className="btn btn--link"
            onClick={() => void dm.run({ a: 'acknowledgeKeyChange', peer: c.riverId })}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="chat__messages" ref={scrollRef}>
        <div className="chat__welcome">
          <Avatar id={c.riverId} name={c.name} avatar={c.avatar} size={72} />
          <h2>{c.name}</h2>
          <p className="muted">
            This is the beginning of your conversation with {c.name}. Messages are end-to-end encrypted.
          </p>
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
              <DmMessage
                m={m}
                grouped={grouped}
                conversation={c}
                myName={myName}
                myId={myId}
                replied={m.replyTo ? messages.find((x) => x.id === m.replyTo) : undefined}
                last={i === messages.length - 1}
              />
            </div>
          );
        })}
      </div>
      {c.state === 'left' ? (
        <div className="chat__composer chat__composer--locked">
          <span className="muted">You are no longer in this group.</span>
        </div>
      ) : c.state === 'request' ? (
        <div className="dm-request">
          <p>
            {c.kind === 'group' ? (
              <>
                You were added to <strong>{c.name}</strong>. Others will not see your name until you accept.
              </>
            ) : (
              <>
                <strong>{c.name}</strong> wants to message you. They will not know you have seen their
                messages until you accept.
              </>
            )}
          </p>
          <div className="button-row">
            <button
              className="btn btn--primary"
              onClick={() => void dm.run({ a: 'accept', peer: c.riverId })}
            >
              Accept
            </button>
            {c.kind === 'direct' && (
              <button
                className="btn btn--ghost btn--danger-text"
                onClick={() => void dm.run({ a: 'block', peer: c.riverId })}
              >
                Block
              </button>
            )}
            <button className="btn btn--ghost" onClick={confirmRemove}>
              Delete
            </button>
          </div>
        </div>
      ) : c.state === 'blocked' ? (
        <div className="chat__composer chat__composer--locked">
          <span className="muted">You blocked {c.name}. </span>
          <button className="btn btn--link" onClick={() => void dm.run({ a: 'unblock', peer: c.riverId })}>
            Unblock
          </button>
        </div>
      ) : (
        <DmComposer conversation={c} pending={pending} onPending={setPending} onAddFiles={addFiles} />
      )}
    </div>
  );
}

const STATUS_LABEL: Record<DirectMessageView['status'], string> = {
  sending: 'Sending…',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not sent',
  received: '',
};

function DmMessage(props: {
  m: DirectMessageView;
  grouped: boolean;
  conversation: ConversationView;
  myName: string;
  myId: string;
  replied: DirectMessageView | undefined;
  last: boolean;
}): ReactElement {
  const { m, conversation: c } = props;
  const dm = useDm();
  const editing = useDm((x) => x.editing === m.id);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const name = m.mine ? props.myName : c.kind === 'group' ? m.senderName : c.name;
  const senderAvatar = m.mine
    ? null
    : c.kind === 'group'
      ? (c.members.find((x) => x.riverId === m.sender)?.avatar ?? null)
      : c.avatar;
  const react = (emoji: string, on: boolean): void => {
    if (on) play('reaction');
    void dm.run({ a: 'react', peer: c.riverId, id: m.id, emoji, on });
  };
  const remove = (forEveryone: boolean): void => {
    useCommunity.getState().setModal({
      kind: 'confirm',
      title: forEveryone ? 'Delete for everyone' : 'Delete for me',
      body: forEveryone
        ? `This message will be deleted on your devices and on ${c.name}'s.`
        : 'This message will be deleted on this device only.',
      action: 'Delete',
      run: async () => {
        await dm.run({ a: 'delete', peer: c.riverId, id: m.id, forEveryone });
      },
    });
  };

  return (
    <div
      className={`msg ${props.grouped ? 'msg--grouped' : ''} ${m.mine ? 'msg--mine' : ''} ${editing ? 'is-editing' : ''}`}
    >
      {m.replyTo && (
        <div className="msg__reply">
          <ReplyIcon size={13} />
          {props.replied ? (
            <>
              <strong>{props.replied.mine ? props.myName : props.replied.senderName}</strong>
              <span className="msg__reply-text">{props.replied.text.slice(0, 120) || 'Attachment'}</span>
            </>
          ) : (
            <span className="muted">Original message not available</span>
          )}
        </div>
      )}
      <div className="msg__row">
        <div className="msg__gutter">
          {props.grouped ? (
            <time className="msg__hover-time">{timeOf(m.sentAt)}</time>
          ) : (
            <Avatar id={m.sender} name={name} avatar={senderAvatar} size={38} />
          )}
        </div>
        <div className="msg__body">
          {!props.grouped && (
            <div className="msg__meta">
              <strong>{name}</strong>
              <time className="muted small" title={new Date(m.sentAt).toLocaleString()}>
                {timeOf(m.sentAt)}
              </time>
            </div>
          )}
          {editing ? (
            <DmEditBox m={m} />
          ) : m.deleted ? (
            <div className="msg__text muted">
              <em>This message was deleted.</em>
            </div>
          ) : (
            <div className="msg__text">
              {m.text && (
                <RichText
                  text={m.text}
                  names={c.kind === 'group' ? c.members.map((x) => x.name) : [c.name, props.myName]}
                  me={props.myName}
                />
              )}
              {m.editedAt && <span className="msg__edited"> (edited)</span>}
            </div>
          )}
          {m.attachments.length > 0 && <AttachmentList attachments={m.attachments} />}
          {m.reactions.length > 0 && (
            <div className="reactions">
              {m.reactions.map((r) => (
                <button
                  key={r.emoji}
                  className={`reaction ${r.mine ? 'is-mine' : ''}`}
                  onClick={() => react(r.emoji, !r.mine)}
                >
                  <span className="reaction__emoji">{r.emoji}</span>
                  <span key={r.count} className="reaction__count">
                    {r.count}
                  </span>
                </button>
              ))}
            </div>
          )}
          {m.mine && (props.last || m.status === 'failed') && (
            <div className={`dm-status dm-status--${m.status}`}>{STATUS_LABEL[m.status]}</div>
          )}
        </div>
      </div>
      {!m.deleted && !editing && c.state === 'accepted' && (
        <div className="msg__actions" role="toolbar" aria-label="Message actions">
          {QUICK_REACTIONS.slice(0, 3).map((e) => (
            <button
              key={e}
              className="msg__action msg__action--emoji"
              title={`React ${e}`}
              onClick={() => react(e, true)}
            >
              {e}
            </button>
          ))}
          <button
            className="msg__action"
            aria-label="Add reaction"
            onClick={(e) => setPicker({ x: e.clientX - 300, y: e.clientY + 12 })}
          >
            <SmileIcon size={17} />
          </button>
          <button className="msg__action" aria-label="Reply" onClick={() => useDm.setState({ replyTo: m })}>
            <ReplyIcon size={17} />
          </button>
          {m.mine && (
            <button
              className="msg__action"
              aria-label="Edit"
              onClick={() => useDm.setState({ editing: m.id })}
            >
              <EditIcon size={17} />
            </button>
          )}
          <button
            className="msg__action msg__action--danger"
            aria-label={m.mine ? 'Delete for everyone' : 'Delete for me'}
            title={m.mine ? 'Delete for everyone' : 'Delete for me'}
            onClick={() => remove(m.mine)}
          >
            <TrashIcon size={17} />
          </button>
        </div>
      )}
      {picker && (
        <Popover x={picker.x} y={picker.y} onClose={() => setPicker(null)}>
          <EmojiPicker
            onPick={(e) => {
              setPicker(null);
              react(e, !m.reactions.find((r) => r.emoji === e)?.mine);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function DmEditBox({ m }: { m: DirectMessageView }): ReactElement {
  const [text, setText] = useState(m.text);
  const save = async (): Promise<void> => {
    const value = text.trim();
    if (value && value !== m.text)
      await useDm.getState().run({ a: 'edit', peer: m.peer, id: m.id, text: value });
    useDm.setState({ editing: null });
  };
  return (
    <div className="msg__edit">
      <textarea
        autoFocus
        value={text}
        maxLength={4000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') useDm.setState({ editing: null });
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <span className="muted small">escape to cancel • enter to save</span>
    </div>
  );
}

function DmComposer(props: {
  conversation: ConversationView;
  pending: PendingFile[];
  onPending(files: PendingFile[]): void;
  onAddFiles(files: Iterable<File>): void;
}): ReactElement {
  const c = props.conversation;
  const dm = useDm();
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const lastTyping = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useDm((x) => x.typing[c.riverId]);
  const replyTo = dm.replyTo && dm.replyTo.peer === c.riverId ? dm.replyTo : null;

  const send = async (): Promise<void> => {
    const value = text.trim();
    const files = props.pending;
    if ((!value && !files.length) || uploading) return;
    let attachments;
    if (files.length) {
      setUploading({ done: 0, total: files.length });
      try {
        attachments = await uploadAll(files, (done) => setUploading({ done, total: files.length }), 'dm');
      } catch (err) {
        setUploading(null);
        useCommunity.getState().notify((err as Error).message || 'Upload failed.', 'error');
        return;
      }
    }
    setText('');
    useDm.setState({ replyTo: null });
    const sent = await dm.run({
      a: 'send',
      peer: c.riverId,
      text: value,
      ...(replyTo ? { replyTo: replyTo.id } : {}),
      ...(attachments ? { attachments } : {}),
    });
    setUploading(null);
    if (!sent) setText(value);
    else {
      play('send');
      props.onPending([]);
      dm.handle({ t: 'message', message: sent, isNew: false, senderName: '' });
    }
  };

  return (
    <div className="chat__composer-wrap">
      {replyTo && (
        <div className="reply-bar">
          <span>
            Replying to <strong>{replyTo.mine ? 'yourself' : c.name}</strong>
          </span>
          <button
            className="icon-btn"
            aria-label="Cancel reply"
            onClick={() => useDm.setState({ replyTo: null })}
          >
            <XIcon size={14} />
          </button>
        </div>
      )}
      {props.pending.length > 0 && (
        <PendingFiles
          files={props.pending}
          onRemove={(key) => props.onPending(props.pending.filter((p) => p.key !== key))}
        />
      )}
      {uploading && (
        <div className="upload-progress" role="status">
          Encrypting and uploading {Math.min(uploading.done + 1, uploading.total)} of {uploading.total}…
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
        <textarea
          ref={ref}
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          value={text}
          maxLength={4000}
          placeholder={`Message ${c.name}`}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              props.onAddFiles(files);
            }
          }}
          onChange={(e) => {
            setText(e.target.value);
            const now = Date.now();
            if (e.target.value && now - lastTyping.current > 4000) {
              lastTyping.current = now;
              void window.river.dm.action({ a: 'typing', peer: c.riverId });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && replyTo) useDm.setState({ replyTo: null });
            if (e.key === 'ArrowUp' && text === '') {
              const mine = [...(dm.messages[c.riverId] ?? [])].reverse().find((m) => m.mine && !m.deleted);
              if (mine) {
                e.preventDefault();
                useDm.setState({ editing: mine.id });
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
          onClick={(e) => setPicker({ x: e.clientX - 300, y: e.clientY - 330 })}
        >
          <SmileIcon size={20} />
        </button>
        <button
          className="btn btn--primary"
          disabled={(!text.trim() && !props.pending.length) || !!uploading}
        >
          Send
        </button>
      </form>
      <div className="typing" aria-live="polite">
        {isTyping(c.riverId) && (
          <>
            <span className="typing__dots">
              <i />
              <i />
              <i />
            </span>
            <span>{typingName(c)} is typing…</span>
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

function NewMessage({ onClose }: { onClose(): void }): ReactElement {
  const dm = useDm();
  const communities = useCommunity((s) => s.communities);
  const myId = dm.myId;
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [grouping, setGrouping] = useState(false);
  // People you share communities with, de-duplicated.
  const people = useMemo(() => {
    const seen = new Map<string, { riverId: string; name: string; avatar: string | null; where: string }>();
    for (const c of communities) {
      for (const m of c.members) {
        if (m.riverId !== myId && !seen.has(m.riverId)) {
          seen.set(m.riverId, { riverId: m.riverId, name: m.name, avatar: m.avatar, where: c.name });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [communities, myId]);
  const isId = RIVER_ID_RE.test(query.trim());
  const shown = people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  const start = async (peer: string, name?: string): Promise<void> => {
    setBusy(true);
    const ok = await dm.open(peer.toLowerCase(), name);
    setBusy(false);
    if (ok) onClose();
  };

  if (grouping) {
    return (
      <PeoplePicker
        title="New group"
        exclude={myId ? [myId] : []}
        action="Create group"
        withName
        onClose={onClose}
        onPick={async (ids, name) => {
          const g = await dm.run({ a: 'createGroup', name: name ?? 'Group', members: ids });
          if (g) {
            dm.select(g.riverId);
            onClose();
          }
        }}
      />
    );
  }

  return (
    <Modal title="New message" onClose={onClose}>
      <button className="btn btn--ghost btn--small new-group-btn" onClick={() => setGrouping(true)}>
        👥 New group
      </button>
      <label className="textfield">
        <span className="field__label">Find someone, or paste their River ID</span>
        <input
          autoFocus
          value={query}
          placeholder="Name or River ID"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isId) void start(query.trim());
          }}
        />
      </label>
      {isId && (
        <button className="btn btn--primary" disabled={busy} onClick={() => void start(query.trim())}>
          {busy ? 'Setting up encryption…' : 'Message this River ID'}
        </button>
      )}
      <div className="people-list">
        {shown.map((p) => (
          <button
            key={p.riverId}
            className="dm-row"
            disabled={busy}
            onClick={() => void start(p.riverId, p.name)}
          >
            <Avatar id={p.riverId} name={p.name} avatar={p.avatar} size={32} />
            <span className="dm-row__text">
              <strong>{p.name}</strong>
              <span className="muted small">from {p.where}</span>
            </span>
          </button>
        ))}
        {!isId && shown.length === 0 && (
          <p className="muted small">
            Nobody found. People you share a community with appear here; anyone else can give you their River
            ID.
          </p>
        )}
      </div>
    </Modal>
  );
}

function SafetyNumber({ peer, onClose }: { peer: string; onClose(): void }): ReactElement {
  const dm = useDm();
  const [data, setData] = useState<{ digits: string; verified: boolean; theirName: string } | null>(null);
  useEffect(() => {
    void dm.run({ a: 'safetyNumber', peer }).then((d) => {
      if (d) setData(d);
      else onClose();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peer]);
  return (
    <Modal title="Safety number" onClose={onClose}>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="safety">
          <p className="muted small">
            Compare these numbers with {data.theirName} in person or on a call. If they match on both devices,
            nobody is intercepting your messages.
          </p>
          <div className="safety__digits">
            {(data.digits.match(/.{5}/g) ?? []).map((group, i) => (
              <code key={i}>{group}</code>
            ))}
          </div>
          <Toggle
            label="Mark as verified"
            help="If their safety number changes later, River stops sending until you verify again."
            checked={data.verified}
            onChange={(v) => {
              void dm
                .run({ a: 'setVerified', peer, verified: v })
                .then(() => setData({ ...data, verified: v }));
            }}
          />
        </div>
      )}
    </Modal>
  );
}

/** Everyone you can reach: contacts and people from your communities. */
function useKnownPeople(): Array<{ riverId: string; name: string; avatar: string | null; where: string }> {
  const communities = useCommunity((s) => s.communities);
  const conversations = useDm((d) => d.conversations);
  const myId = useDm((d) => d.myId);
  return useMemo(() => {
    const seen = new Map<string, { riverId: string; name: string; avatar: string | null; where: string }>();
    for (const c of conversations) {
      if (c.kind === 'direct' && c.state === 'accepted') {
        seen.set(c.riverId, { riverId: c.riverId, name: c.name, avatar: c.avatar, where: 'your contacts' });
      }
    }
    for (const c of communities) {
      for (const m of c.members) {
        if (m.riverId !== myId && !seen.has(m.riverId)) {
          seen.set(m.riverId, { riverId: m.riverId, name: m.name, avatar: m.avatar, where: c.name });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [communities, conversations, myId]);
}

function PeoplePicker(props: {
  title: string;
  exclude: string[];
  action: string;
  withName?: boolean;
  onClose(): void;
  onPick(ids: string[], name?: string): Promise<void>;
}): ReactElement {
  const people = useKnownPeople().filter((p) => !props.exclude.includes(p.riverId));
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id: string): void =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(0, 31));
  return (
    <Modal title={props.title} onClose={props.onClose}>
      {props.withName && (
        <label className="textfield">
          <span className="field__label">Group name</span>
          <input
            autoFocus
            value={name}
            maxLength={64}
            placeholder="e.g. Weekend trip"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <input
        className="search"
        placeholder="Search people"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="people-list">
        {shown.map((p) => (
          <label key={p.riverId} className={`dm-row ${picked.includes(p.riverId) ? 'is-active' : ''}`}>
            <input type="checkbox" checked={picked.includes(p.riverId)} onChange={() => toggle(p.riverId)} />
            <Avatar id={p.riverId} name={p.name} avatar={p.avatar} size={30} />
            <span className="dm-row__text">
              <strong>{p.name}</strong>
              <span className="muted small">from {p.where}</span>
            </span>
          </label>
        ))}
        {shown.length === 0 && (
          <p className="muted small">
            Nobody to add yet — people from your communities and contacts appear here.
          </p>
        )}
      </div>
      <div className="modal__foot">
        <span className="muted small">{picked.length} selected</span>
        <button
          className="btn btn--primary"
          disabled={busy || picked.length === 0 || (props.withName && !name.trim())}
          onClick={() => {
            setBusy(true);
            void props.onPick(picked, name.trim() || undefined).finally(() => setBusy(false));
          }}
        >
          {busy ? 'Setting up encryption…' : props.action}
        </button>
      </div>
    </Modal>
  );
}

function GroupAvatar({ c, size }: { c: ConversationView; size: number }): ReactElement {
  const shown = c.members.slice(0, 2);
  return (
    <span className="group-avatar" style={{ width: size, height: size }}>
      {shown.map((m, i) => (
        <span key={m.riverId} className={`group-avatar__face group-avatar__face--${i}`}>
          <Avatar id={m.riverId} name={m.name} avatar={m.avatar} size={Math.round(size * 0.68)} />
        </span>
      ))}
    </span>
  );
}

function GroupMembers({ c, onClose }: { c: ConversationView; onClose(): void }): ReactElement {
  const dm = useDm();
  const myId = dm.myId;
  return (
    <div className="group-members">
      <header className="pins__head">
        <strong>Members — {c.members.length}</strong>
        <button className="icon-btn" aria-label="Close members" onClick={onClose}>
          <XIcon size={14} />
        </button>
      </header>
      {c.members.map((m) => (
        <div key={m.riverId} className="group-members__row">
          <Avatar id={m.riverId} name={m.name} avatar={m.avatar} size={28} />
          <span className="group-members__name">
            {m.name}
            {m.riverId === myId ? ' (you)' : ''}
          </span>
          {m.admin && <span className="chip">admin</span>}
          {c.isAdmin && m.riverId !== myId && c.state !== 'left' && (
            <button
              className="btn btn--link btn--danger-text"
              onClick={() => void dm.run({ a: 'removeGroupMember', peer: c.riverId, member: m.riverId })}
            >
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function typingName(c: ConversationView): string {
  if (c.kind !== 'group') return c.name;
  const who = useDm.getState().typingWho[c.riverId];
  return c.members.find((m) => m.riverId === who)?.name ?? 'Someone';
}
