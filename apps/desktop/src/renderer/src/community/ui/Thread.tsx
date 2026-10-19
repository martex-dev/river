import { setFollowing, useFollowing } from '../thread-follow.ts';
import { clockTime } from '../../time.ts';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import { useShallow } from 'zustand/react/shallow';
import type { ChannelView, ChatMessage, CommunityView } from '../../../../shared/ipc.ts';
import { enterSends } from '../../components/keys.ts';
import { isPhone } from '../../../../shared/platform.ts';
import { useRiver } from '../../store.ts';
import { useOutbox } from '../outbox.ts';
import { useCommunity } from '../store.ts';
import { tr, trn } from '../../i18n.ts';
import { AttachmentList } from './Attachments.tsx';
import { Avatar, RichText, XIcon, can, hex, memberOf } from './common.tsx';

const timeOf = (iso: string): string => clockTime(iso);

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
  // Replying in an archived thread takes Manage messages (the server checks exactly that).
  const mayReply =
    can(channel.permissions, Permission.SEND_MESSAGES) &&
    (!thread?.archived || can(channel.permissions, Permission.MANAGE_MESSAGES));
  const close = (): void => useCommunity.setState({ openThread: null });
  const phone = useRiver((r) => isPhone(r.info?.platform));

  // Opened some other way than showThread (or the load failed): fetch the replies.
  const missing = replies === undefined;
  useEffect(() => {
    if (!missing) return;
    void window.river.community
      .action({ a: 'threadMessages', channelId: channel.id, messageId: rootId })
      .then((res) => {
        if (res.ok && !useCommunity.getState().threads[rootId])
          useCommunity.setState({
            threads: { ...useCommunity.getState().threads, [rootId]: res.value as ChatMessage[] },
          });
      });
  }, [missing, channel.id, rootId]);

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

  const following = useFollowing(rootId);
  return (
    <aside className="thread-panel" aria-label={tr('Thread {name}', { name: thread?.name ?? '' })}>
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
              aria-label={tr('Thread name')}
              value={renaming}
              maxLength={64}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={() => setRenaming(null)}
            />
          </form>
        ) : mayEdit ? (
          // A button, so the keyboard can rename it too (it was a double-click on the name only).
          <button
            type="button"
            className="thread-panel__name is-editable"
            title={tr('Rename thread')}
            aria-label={tr('Rename thread {name}', { name: thread?.name ?? '' })}
            onClick={() => setRenaming(thread?.name ?? '')}
          >
            {thread?.name ?? tr('Thread')}
          </button>
        ) : (
          <strong className="thread-panel__name">{thread?.name ?? tr('Thread')}</strong>
        )}
        {thread?.archived && <span className="chip">{tr('Archived')}</span>}
        <span className="thread-panel__actions">
          <button
            className={`btn btn--small ${following ? 'btn--ghost' : 'btn--primary'}`}
            aria-pressed={following}
            title={following ? tr('Stop hearing about new replies') : tr('Hear about new replies')}
            onClick={() => setFollowing(rootId, !following)}
          >
            {following ? tr('Following') : tr('Follow')}
          </button>
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
              {thread?.archived ? tr('Unarchive') : tr('Archive')}
            </button>
          )}
          <button
            className="icon-btn"
            aria-label={tr('Close thread')}
            data-phone-back=""
            title={tr('Close thread')}
            onClick={close}
          >
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
          {replies === undefined ? tr('Loading replies…') : trn('{count} replies', replies.length)}
        </div>
        {replies?.map((m) => (
          <Reply key={m.id} m={m} community={community} names={names} myName={myName} />
        ))}
        {outgoing.map((o) => (
          <div key={o.localId} className={`thread-reply msg--${o.status}`}>
            <div className="thread-reply__meta">
              <strong>{myName ?? tr('You')}</strong>
              <span className="muted small">
                {o.status === 'sending'
                  ? tr('Sending…')
                  : o.status === 'waiting'
                    ? tr('Waiting for connection')
                    : o.error}
              </span>
            </div>
            <div className="msg__text">{o.text}</div>
            {o.status === 'failed' && (
              <span className="thread-reply__failed">
                <button
                  className="btn btn--link btn--small"
                  onClick={() => useOutbox.getState().retry(o.localId)}
                >
                  {tr('Retry')}
                </button>
                {/* Gone from this device too, like a failed message in the channel. */}
                <button
                  className="btn btn--link btn--small"
                  onClick={() => useOutbox.getState().discard(o.localId)}
                >
                  {tr('Discard')}
                </button>
              </span>
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
            aria-label={tr('Reply in thread')}
            placeholder={tr('Reply in thread')}
            value={text}
            rows={1}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (enterSends(e, phone)) {
                e.preventDefault();
                send();
              }
              if (e.key === 'Escape') close();
            }}
          />
          <button className="btn btn--primary btn--small" disabled={!text.trim()}>
            {tr('Send')}
          </button>
        </form>
      ) : (
        <div className="thread-panel__locked muted small">
          {thread?.archived ? tr('This thread is archived.') : tr('You cannot reply here.')}
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
        {m.attachments.length > 0 && <AttachmentList attachments={m.attachments} alts={m.alts} />}
      </div>
    </div>
  );
}
