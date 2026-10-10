import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import { useShallow } from 'zustand/react/shallow';
import type { ChannelView, ChatMessage, CommunityView } from '../../../../shared/ipc.ts';
import { useOutbox } from '../outbox.ts';
import { useCommunity } from '../store.ts';
import { AttachmentList } from './Attachments.tsx';
import { Avatar, RichText, XIcon, can, hex, memberOf } from './common.tsx';

const timeOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * A thread beside the channel: the starting message, its replies, and a
 * composer that replies inside the thread. The creator and people who manage
 * messages can rename and archive it.
 */
export function ThreadPanel(props: {
  community: CommunityView;
  channel: ChannelView;
  rootId: string;
  me: string;
}): ReactElement {
  const { community, channel, rootId, me } = props;
  const s = useCommunity();
  const root = useCommunity((x) => x.messages[channel.id]?.find((m) => m.id === rootId));
  const replies = useCommunity((x) => x.threads[rootId]);
  const outgoing = useOutbox(useShallow((o) => o.items.filter((i) => i.threadId === rootId)));
  const [text, setText] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const names = community.members.map((m) => m.name);
  const myName = memberOf(community, me)?.name ?? null;
  const thread = root?.thread;
  const manager =
    can(channel.permissions, Permission.MANAGE_MESSAGES) ||
    can(channel.permissions, Permission.MANAGE_CHANNELS);
  const mayEdit = !!thread && (thread.creator === me || manager);
  const mayReply = can(channel.permissions, Permission.SEND_MESSAGES) && (!thread?.archived || manager);
  const close = (): void => useCommunity.setState({ openThread: null });

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies?.length, outgoing.length]);

  const send = (): void => {
    const value = text.trim();
    if (!value) return;
    setText('');
    useOutbox.getState().send({ channelId: channel.id, text: value, threadId: rootId });
  };

  return (
    <aside className="thread-panel" aria-label={`Thread ${thread?.name ?? ''}`}>
      <header className="thread-panel__head">
        <span aria-hidden="true">🧵</span>
        {renaming !== null ? (
          <form
            className="thread-panel__rename"
            onSubmit={(e) => {
              e.preventDefault();
              const name = renaming.trim();
              setRenaming(null);
              if (name && name !== thread?.name)
                void s.run({ a: 'updateThread', channelId: channel.id, messageId: rootId, name });
            }}
          >
            <input
              autoFocus
              aria-label="Thread name"
              value={renaming}
              maxLength={64}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={() => setRenaming(null)}
            />
          </form>
        ) : (
          <strong
            className={`thread-panel__name ${mayEdit ? 'is-editable' : ''}`}
            title={mayEdit ? 'Rename thread' : undefined}
            onDoubleClick={() => mayEdit && setRenaming(thread?.name ?? '')}
          >
            {thread?.name ?? 'Thread'}
          </strong>
        )}
        {thread?.archived && <span className="chip">Archived</span>}
        <span className="thread-panel__actions">
          {mayEdit && (
            <button
              className="btn btn--ghost btn--small"
              onClick={() =>
                void s.run({
                  a: 'updateThread',
                  channelId: channel.id,
                  messageId: rootId,
                  archived: !thread?.archived,
                })
              }
            >
              {thread?.archived ? 'Unarchive' : 'Archive'}
            </button>
          )}
          <button className="icon-btn" aria-label="Close thread" title="Close thread" onClick={close}>
            <XIcon size={18} />
          </button>
        </span>
      </header>
      <div className="thread-panel__list" ref={listRef}>
        {root && (
          <div className="thread-panel__root">
            <Reply m={root} community={community} names={names} myName={myName} />
          </div>
        )}
        <div className="thread-panel__count muted small">
          {replies === undefined
            ? 'Loading replies…'
            : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
        </div>
        {replies?.map((m) => (
          <Reply key={m.id} m={m} community={community} names={names} myName={myName} />
        ))}
        {outgoing.map((o) => (
          <div key={o.localId} className={`thread-reply msg--${o.status}`}>
            <div className="thread-reply__meta">
              <strong>{myName ?? 'You'}</strong>
              <span className="muted small">
                {o.status === 'sending'
                  ? 'Sending…'
                  : o.status === 'waiting'
                    ? 'Waiting for connection'
                    : o.error}
              </span>
            </div>
            <div className="msg__text">{o.text}</div>
            {o.status === 'failed' && (
              <button
                className="btn btn--link btn--small"
                onClick={() => useOutbox.getState().retry(o.localId)}
              >
                Retry
              </button>
            )}
          </div>
        ))}
      </div>
      {mayReply ? (
        <form
          className="thread-panel__composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            aria-label="Reply in thread"
            placeholder="Reply in thread"
            value={text}
            rows={1}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
              if (e.key === 'Escape') close();
            }}
          />
          <button className="btn btn--primary btn--small" disabled={!text.trim()}>
            Send
          </button>
        </form>
      ) : (
        <div className="thread-panel__locked muted small">
          {thread?.archived ? 'This thread is archived.' : 'You cannot reply here.'}
        </div>
      )}
    </aside>
  );
}

function Reply(props: {
  m: ChatMessage;
  community: CommunityView;
  names: string[];
  myName: string | null;
}): ReactElement {
  const { m, community } = props;
  const member = memberOf(community, m.sender);
  return (
    <div className={`thread-reply ${m.mentionsMe ? 'msg--mention' : ''}`}>
      <Avatar id={m.sender} name={m.senderName} avatar={member?.avatar} size={28} />
      <div className="thread-reply__body">
        <div className="thread-reply__meta">
          <strong style={member?.color ? { color: hex(member.color) } : undefined}>{m.senderName}</strong>
          <time className="muted small" title={new Date(m.sentAt).toLocaleString()}>
            {timeOf(m.sentAt)}
          </time>
        </div>
        {m.text && (
          <div className="msg__text">
            <RichText text={m.text} names={props.names} me={props.myName} />
          </div>
        )}
        {m.attachments.length > 0 && <AttachmentList attachments={m.attachments} />}
      </div>
    </div>
  );
}
