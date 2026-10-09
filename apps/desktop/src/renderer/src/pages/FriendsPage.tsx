import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import type { ConversationView } from '../../../shared/dm.ts';
import { friendLink, parseFriend } from '../../../shared/invite-link.ts';
import { play } from '../community/sound.ts';
import { useCommunity } from '../community/store.ts';
import { Avatar } from '../community/ui/common.tsx';
import { startDmCall } from '../dm/call.ts';
import { GREETING, sendFriendRequest } from '../dm/friends.ts';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

/** Where a person is online and which communities you share, from your communities' member lists. */
function usePresence(): (riverId: string) => { online: boolean; mutual: string[] } {
  const communities = useCommunity((s) => s.communities);
  return useMemo(() => {
    const index = new Map<string, { online: boolean; mutual: string[] }>();
    for (const c of communities) {
      for (const m of c.members) {
        const entry = index.get(m.riverId) ?? { online: false, mutual: [] };
        entry.online ||= m.online;
        entry.mutual.push(c.name);
        index.set(m.riverId, entry);
      }
    }
    return (riverId: string) => index.get(riverId) ?? { online: false, mutual: [] };
  }, [communities]);
}

/**
 * Friends, the simple way: who's online, everyone, requests waiting for you,
 * blocked people, and adding someone with a link or River ID.
 */
export function FriendsPage(): ReactElement {
  const dm = useDm();
  const account = useRiver((r) => r.account);
  const presence = usePresence();
  const [tab, setTab] = useState<Tab>('online');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void dm.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.state]);

  if (account.state !== 'registered') {
    return (
      <div className="page">
        <header className="page__header">
          <div className="eyebrow">Friends</div>
          <h1 className="page__title">Your people</h1>
          <p className="page__lead">
            Friends need an account on a River server. Join or create a community first — it only takes a
            moment.
          </p>
        </header>
        <button className="btn btn--primary" onClick={() => useRiver.getState().navigate('communities')}>
          Go to Communities
        </button>
      </div>
    );
  }

  const direct = dm.conversations.filter((c) => c.kind === 'direct');
  const friends = direct.filter((c) => c.state === 'accepted' && !c.awaitingReply);
  const lists: Record<Exclude<Tab, 'add'>, ConversationView[]> = {
    online: friends.filter((c) => presence(c.riverId).online),
    all: friends,
    pending: direct.filter((c) => c.state === 'request' || (c.state === 'accepted' && c.awaitingReply)),
    blocked: direct.filter((c) => c.state === 'blocked'),
  };
  const tabs: Array<[Tab, string]> = [
    ['online', 'Online'],
    ['all', 'All'],
    ['pending', 'Pending'],
    ['blocked', 'Blocked'],
  ];
  const shown =
    tab === 'add' ? [] : lists[tab].filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="page friends">
      <header className="page__header">
        <div className="eyebrow">Friends</div>
        <h1 className="page__title">Your people</h1>
        <p className="page__lead">
          River never uploads an address book. Add people with a link, or from a community.
        </p>
      </header>
      <nav className="friends__tabs" role="tablist" aria-label="Friends">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`friends__tab ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
            {id === 'pending' && lists.pending.length > 0 && (
              <span key={lists.pending.length} className="badge badge--mention">
                {lists.pending.length}
              </span>
            )}
          </button>
        ))}
        <button
          role="tab"
          aria-selected={tab === 'add'}
          className={`friends__tab friends__tab--add ${tab === 'add' ? 'is-active' : ''}`}
          onClick={() => setTab('add')}
        >
          Add friend
        </button>
      </nav>

      {tab === 'add' ? (
        <AddFriend serverUrl={account.serverUrl} myId={account.riverId} onSent={() => setTab('all')} />
      ) : (
        <>
          <input
            className="search friends__search"
            placeholder="Search"
            aria-label="Search friends"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <h2 className="contacts__title">
            {tab === 'online'
              ? 'Online'
              : tab === 'all'
                ? 'All friends'
                : tab === 'pending'
                  ? 'Requests'
                  : 'Blocked'}{' '}
            — {shown.length}
          </h2>
          {shown.length === 0 ? (
            <EmptyFriends tab={tab} onAdd={() => setTab('add')} />
          ) : (
            <div className="friends__list">
              {shown.map((c) => (
                <FriendRow key={c.riverId} c={c} presence={presence(c.riverId)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EmptyFriends({ tab, onAdd }: { tab: Exclude<Tab, 'add'>; onAdd(): void }): ReactElement {
  const text = {
    online: 'No friends are online right now.',
    all: 'No friends yet.',
    pending: 'No friend requests right now.',
    blocked: "You haven't blocked anyone.",
  }[tab];
  return (
    <div className="friends__empty">
      <p className="muted">{text}</p>
      {(tab === 'all' || tab === 'online') && (
        <button className="btn btn--primary btn--small" onClick={onAdd}>
          Add a friend
        </button>
      )}
    </div>
  );
}

function FriendRow(props: {
  c: ConversationView;
  presence: { online: boolean; mutual: string[] };
}): ReactElement {
  const { c, presence } = props;
  const dm = useDm();
  const navigate = useRiver((r) => r.navigate);
  const open = (): void => {
    navigate('messages');
    dm.select(c.riverId);
  };
  const status =
    c.state === 'request'
      ? 'Wants to be friends'
      : c.awaitingReply
        ? 'Request sent — waiting for them to accept'
        : c.state === 'blocked'
          ? 'Blocked'
          : presence.online
            ? 'Online'
            : 'Offline';
  return (
    <div className={`friend-row ${presence.online && c.state === 'accepted' ? 'is-online' : ''}`}>
      <Avatar
        id={c.riverId}
        name={c.name}
        avatar={c.avatar}
        size={40}
        status={c.state === 'accepted' ? (presence.online ? 'online' : 'offline') : undefined}
      />
      <span className="friend-row__text">
        <strong>
          {c.name}{' '}
          {c.verified && (
            <span className="dm-row__verified" title="Safety number verified">
              ✓
            </span>
          )}
        </strong>
        <span className="muted small">
          {status}
          {presence.mutual.length > 0 &&
            ` · ${presence.mutual.length === 1 ? presence.mutual[0] : `${presence.mutual.length} mutual communities`}`}
        </span>
        {c.keyChanged && <span className="chip contact-card__warn">Safety number changed</span>}
      </span>
      <span className="friend-row__actions">
        {c.state === 'accepted' && c.awaitingReply && (
          <>
            <button className="btn btn--ghost btn--small" onClick={open}>
              Open chat
            </button>
            <button
              className="btn btn--link btn--small"
              onClick={() => void dm.run({ a: 'removeConversation', peer: c.riverId })}
            >
              Cancel request
            </button>
          </>
        )}
        {c.state === 'accepted' && !c.awaitingReply && (
          <>
            <button className="icon-btn" aria-label={`Message ${c.name}`} title="Message" onClick={open}>
              💬
            </button>
            <button
              className="icon-btn"
              aria-label={`Call ${c.name}`}
              title="Voice call"
              onClick={() => {
                open();
                void startDmCall(c.riverId, false);
              }}
            >
              📞
            </button>
          </>
        )}
        {c.state === 'request' && (
          <>
            <button
              className="btn btn--primary btn--small"
              onClick={() => void dm.run({ a: 'accept', peer: c.riverId })}
            >
              Accept
            </button>
            <button className="btn btn--ghost btn--small" onClick={open}>
              Read message
            </button>
            <button
              className="btn btn--link btn--small"
              onClick={() => void dm.run({ a: 'removeConversation', peer: c.riverId })}
            >
              Ignore
            </button>
          </>
        )}
        {c.state === 'blocked' && (
          <button
            className="btn btn--ghost btn--small"
            onClick={() => void dm.run({ a: 'unblock', peer: c.riverId })}
          >
            Unblock
          </button>
        )}
      </span>
    </div>
  );
}

function AddFriend(props: { serverUrl: string; myId: string; onSent(): void }): ReactElement {
  const notify = useCommunity((s) => s.notify);
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState(GREETING);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const parsed = parseFriend(target);
  const myLink = friendLink(props.serverUrl, props.myId);
  const otherServer = parsed?.serverUrl && parsed.serverUrl !== props.serverUrl.replace(/\/+$/, '');
  const error =
    target.trim() === ''
      ? null
      : !parsed
        ? 'Paste a friend link or a River ID.'
        : parsed.riverId === props.myId
          ? "That's you!"
          : otherServer
            ? 'That person is on another River server. Friends need to be on the same server for now.'
            : null;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!parsed || error) return;
    setBusy(true);
    const ok = await sendFriendRequest(parsed.riverId, message.trim() || GREETING);
    setBusy(false);
    if (!ok) return;
    notify('Friend request sent');
    setTarget('');
    props.onSent();
  };

  return (
    <div className="friends__add">
      <form className="glass card" onSubmit={(e) => void submit(e)}>
        <h2 className="card__title">Add a friend</h2>
        <p className="muted small">
          Paste their friend link or River ID. They'll get your message as a request.
        </p>
        <label className="textfield">
          <span className="field__label">Friend link or River ID</span>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="https://…/add#… or xxxxxxxx-xxxx-…"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
          />
        </label>
        {error && <p className="field__error">{error}</p>}
        <label className="textfield">
          <span className="field__label">Message</span>
          <input value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="button-row">
          <button className="btn btn--primary" disabled={busy || !parsed || !!error}>
            {busy ? 'Setting up encryption…' : 'Send friend request'}
          </button>
        </div>
      </form>
      <div className="glass card">
        <h2 className="card__title">Your friend link</h2>
        <p className="muted small">
          Send this to people you want to add you. Anyone with it can message you.
        </p>
        <code className="invite-box__link">{myLink}</code>
        <div className="button-row">
          <button
            className="btn btn--ghost btn--small"
            onClick={() =>
              void navigator.clipboard.writeText(myLink).then(() => {
                play('success');
                setCopied(true);
              })
            }
          >
            {copied ? 'Copied ✓' : 'Copy friend link'}
          </button>
        </div>
      </div>
    </div>
  );
}
