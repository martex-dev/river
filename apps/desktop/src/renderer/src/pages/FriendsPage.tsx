import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { create } from 'zustand';
import type { ConversationView } from '../../../shared/dm.ts';
import { friendLink, parseFriend } from '../../../shared/invite-link.ts';
import { play } from '../community/sound.ts';
import { useCommunity } from '../community/store.ts';
import { Avatar } from '../community/ui/common.tsx';
import { startDmCall, useDmCall } from '../dm/call.ts';
import { addFriend, addFriendMessage, GREETING } from '../dm/friends.ts';
import { useDm } from '../dm/store.ts';
import { useRiver } from '../store.ts';
import { QrCode } from '../components/QrCode.tsx';
import { QrScanner } from '../components/QrScanner.tsx';
import { JoinCommunityCard } from '../components/GetStarted.tsx';
import { isPhone } from '../../../shared/platform.ts';
import { phonePush } from '../phone/nav.ts';
import { tr, trn } from '../i18n.ts';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

/** Which list Friends shows, and whether your QR code is open: other places open them (2.14). */
const useFriendsView = create<{ tab: Tab; qr: boolean }>(() => ({ tab: 'online', qr: false }));

/**
 * Friends → Add friend, from anywhere (a first-run card, the phone's empty chat list): one tap
 * to the username field, or (`qr`) straight to your own QR code and link.
 */
export function openAddFriend(options: { qr?: boolean } = {}): void {
  useFriendsView.setState({ tab: 'add', qr: options.qr ?? false });
  if (isPhone(useRiver.getState().info?.platform)) phonePush({ kind: 'friends' });
  else useRiver.getState().navigate('contacts');
}

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
  const tab = useFriendsView((v) => v.tab);
  const setTab = (next: Tab): void => useFriendsView.setState({ tab: next, qr: false });
  const [query, setQuery] = useState('');

  useEffect(() => {
    void dm.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.state]);

  if (account.state !== 'registered') {
    // River makes your account by itself (2.0): while it does, say so rather than ask for work.
    return (
      <div className="page">
        <header className="page__header">
          <div className="eyebrow">{tr('Friends')}</div>
          <h1 className="page__title">{tr('Your people')}</h1>
          <p className="page__lead" role={account.waiting ? 'status' : undefined}>
            {account.waiting
              ? tr(
                  'Setting up your account… River keeps trying by itself, and friends can be added as soon as it is ready.',
                )
              : account.needsInvite
                ? tr(
                    'Your account needs the sign-up link from whoever runs your River server — paste it in the card above.',
                  )
                : tr(
                    'Friends need an account on a River server. Join or create a community first — it only takes a moment.',
                  )}
          </p>
        </header>
        {!account.waiting && !account.needsInvite && (
          <button className="btn btn--primary" onClick={() => useRiver.getState().navigate('communities')}>
            {tr('Go to Communities')}
          </button>
        )}
      </div>
    );
  }

  const direct = dm.conversations.filter((c) => c.kind === 'direct' && !c.self);
  const friends = direct.filter((c) => c.state === 'accepted' && !c.awaitingReply);
  const lists: Record<Exclude<Tab, 'add'>, ConversationView[]> = {
    online: friends.filter((c) => presence(c.riverId).online),
    all: friends,
    pending: direct.filter((c) => c.state === 'request' || (c.state === 'accepted' && c.awaitingReply)),
    blocked: direct.filter((c) => c.state === 'blocked'),
  };
  const tabs: Array<[Tab, string]> = [
    ['online', tr('Online')],
    ['all', tr('All')],
    ['pending', tr('Pending')],
    ['blocked', tr('Blocked')],
  ];
  const shown =
    tab === 'add' ? [] : lists[tab].filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  // Nobody yet (2.14): Online and All show how to add someone instead of an empty list.
  const firstFriend =
    dm.loaded && friends.length === 0 && lists.pending.length === 0 && (tab === 'online' || tab === 'all');

  return (
    <div className="page friends">
      <header className="page__header">
        <div className="eyebrow">{tr('Friends')}</div>
        <h1 className="page__title">{tr('Your people')}</h1>
        <p className="page__lead">
          {tr('River never uploads an address book. Add people with a link, or from a community.')}
        </p>
      </header>
      <nav className="friends__tabs" role="tablist" aria-label={tr('Friends')}>
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
          {tr('Add friend')}
        </button>
      </nav>

      {tab === 'add' || firstFriend ? (
        <AddFriend
          key={tab}
          serverUrl={account.shareUrl}
          myId={account.riverId}
          myUsername={account.username}
          firstRun={firstFriend}
          onSent={() => setTab('all')}
        />
      ) : (
        <>
          <input
            className="search friends__search"
            placeholder={tr('Search')}
            aria-label={tr('Search friends')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <h2 className="contacts__title">
            {tab === 'online'
              ? tr('Online')
              : tab === 'all'
                ? tr('All friends')
                : tab === 'pending'
                  ? tr('Requests')
                  : tr('Blocked')}{' '}
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
    online: tr('No friends are online right now.'),
    all: tr('No friends yet.'),
    pending: tr('No friend requests right now.'),
    blocked: tr("You haven't blocked anyone."),
  }[tab];
  return (
    <div className="friends__empty">
      <p className="muted">{text}</p>
      {(tab === 'all' || tab === 'online') && (
        <button className="btn btn--primary btn--small" onClick={onAdd}>
          {tr('Add a friend')}
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
  // One call at a time: no new call while one is on or ringing.
  const callBusy = useDmCall((s) => !!s.active || !!s.incoming);
  const open = (): void => {
    navigate('messages');
    dm.select(c.riverId);
  };
  const status =
    c.state === 'request'
      ? tr('Wants to be friends')
      : c.awaitingReply
        ? tr('Request sent — waiting for them to accept')
        : c.state === 'blocked'
          ? tr('Blocked')
          : presence.online
            ? tr('Online')
            : tr('Offline');
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
            <span className="dm-row__verified" title={tr('Safety number verified')}>
              ✓
            </span>
          )}
        </strong>
        <span className="muted small">
          {status}
          {presence.mutual.length > 0 &&
            ` · ${presence.mutual.length === 1 ? presence.mutual[0] : trn('{count} mutual communities', presence.mutual.length)}`}
        </span>
        {c.keyChanged && <span className="chip contact-card__warn">{tr('Safety number changed')}</span>}
      </span>
      <span className="friend-row__actions">
        {c.state === 'accepted' && c.awaitingReply && (
          <>
            <button className="btn btn--ghost btn--small" onClick={open}>
              {tr('Open chat')}
            </button>
            <button
              className="btn btn--link btn--small"
              onClick={() => void dm.run({ a: 'removeConversation', peer: c.riverId })}
            >
              {tr('Cancel request')}
            </button>
          </>
        )}
        {c.state === 'accepted' && !c.awaitingReply && (
          <>
            <button
              className="icon-btn"
              aria-label={tr('Message {name}', { name: c.name })}
              title={tr('Message')}
              onClick={open}
            >
              💬
            </button>
            <InviteToCommunity peer={c.riverId} name={c.name} />
            <button
              className="icon-btn"
              aria-label={tr('Call {name}', { name: c.name })}
              title={tr('Voice call')}
              disabled={callBusy}
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
              {tr('Accept')}
            </button>
            <button className="btn btn--ghost btn--small" onClick={open}>
              {tr('Read message')}
            </button>
            <button
              className="btn btn--link btn--small"
              onClick={() => void dm.run({ a: 'removeConversation', peer: c.riverId })}
            >
              {tr('Ignore')}
            </button>
          </>
        )}
        {c.state === 'blocked' && (
          <button
            className="btn btn--ghost btn--small"
            onClick={() => void dm.run({ a: 'unblock', peer: c.riverId })}
          >
            {tr('Unblock')}
          </button>
        )}
      </span>
    </div>
  );
}

function AddFriend(props: {
  serverUrl: string;
  myId: string;
  myUsername: string | null;
  /** No friends yet: joining a community is offered next to adding a friend. */
  firstRun?: boolean;
  onSent(): void;
}): ReactElement {
  const notify = useCommunity((s) => s.notify);
  const [handle, setHandle] = useState('');
  const [message, setMessage] = useState(() => tr(GREETING));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(() => useFriendsView.getState().qr);
  const [scanning, setScanning] = useState(false);
  const myLink = friendLink(props.serverUrl, props.myId);

  const request = async (riverId: string): Promise<void> => {
    const result = await addFriend(riverId, message.trim() || tr(GREETING));
    setBusy(false);
    const name = useDm.getState().conversations.find((c) => c.riverId === riverId)?.name;
    if (result === 'failed' || result === 'blocked') return setError(addFriendMessage(result, name));
    setHandle('');
    notify(addFriendMessage(result, name));
    if (result === 'sent') props.onSent();
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const value = handle.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    // A username (maybe with a leading @), or an old-style friend link / River ID.
    let riverId: string;
    const link = parseFriend(value);
    if (link) {
      if (link.riverId === props.myId) {
        setBusy(false);
        return setError(tr("That's you!"));
      }
      riverId = link.riverId;
    } else {
      const found = await window.river.users.lookup(value);
      if (!found.ok) {
        setBusy(false);
        return setError(found.message);
      }
      if (found.value.riverId === props.myId) {
        setBusy(false);
        return setError(tr("That's you!"));
      }
      riverId = found.value.riverId;
    }
    await request(riverId);
  };

  /** A friend's QR code (2.9): their friend link, then the request goes out at once. */
  const scanned = (text: string): true | string => {
    const link = parseFriend(text);
    if (!link) return tr('That QR code is not a River friend code.');
    if (link.riverId === props.myId) return tr("That's your own code.");
    setScanning(false);
    setBusy(true);
    setError(null);
    void request(link.riverId);
    return true;
  };

  return (
    <div className="friends__add">
      <form className="glass card" onSubmit={(e) => void submit(e)}>
        <h2 className="card__title">{tr('Add a friend')}</h2>
        <p className="muted small">
          {tr('Type their username — like @alex. They get your message as a request.')}
        </p>
        <label className="textfield username-field">
          <span className="username-field__at" aria-hidden="true">
            @
          </span>
          <input
            value={handle.replace(/^@/, '')}
            onChange={(e) => {
              setHandle(e.target.value);
              setError(null);
            }}
            placeholder={tr('username')}
            autoCapitalize="none"
            spellCheck={false}
            aria-label={tr("Friend's username")}
            aria-invalid={error ? true : undefined}
          />
        </label>
        {error && <p className="field__error">{error}</p>}
        <label className="textfield">
          <span className="field__label">{tr('Message')}</span>
          <input value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="button-row">
          <button className="btn btn--primary" disabled={busy || handle.trim() === ''}>
            {busy ? tr('Sending…') : tr('Send friend request')}
          </button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setScanning(true)}>
            📷 {tr('Scan QR code')}
          </button>
        </div>
      </form>
      {scanning && (
        <QrScanner
          title={tr("Scan a friend's QR code")}
          hint={tr('Point the camera at the QR code in their River: Friends → Add friend → Show QR code.')}
          onResult={scanned}
          onClose={() => setScanning(false)}
        />
      )}
      <div className="glass card" id="my-friend-link">
        <h2 className="card__title">
          {props.myUsername
            ? tr('You are @{username}', { username: props.myUsername })
            : tr('You are on River')}
        </h2>
        <p className="muted small">
          {props.myUsername
            ? tr('Share your username and people can add you. Or send them your link.')
            : tr(
                'Choose a username in Settings → Account so people can add you by name. You can still share your link.',
              )}
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
            {copied ? tr('Copied ✓') : tr('Copy friend link')}
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => setShowQr(!showQr)}>
            {showQr ? tr('Hide QR code') : tr('Show QR code')}
          </button>
        </div>
        {showQr && (
          <div className="friend-qr">
            <QrCode value={myLink} size={200} label={tr('Your friend link as a QR code')} />
            <p className="muted small">
              {tr('Your friend scans this in River to send you a friend request.')}
            </p>
          </div>
        )}
      </div>
      {props.firstRun && <JoinCommunityCard />}
    </div>
  );
}

/** Sends a friend an invite to one of your communities, as a message they can join from. */
function InviteToCommunity(props: { peer: string; name: string }): ReactElement | null {
  const communities = useCommunity((c) => c.communities);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  if (communities.length === 0) return null;
  const invite = async (id: string, community: string): Promise<void> => {
    setOpen(false);
    const res = await window.river.community.invite(id);
    if (!res.ok) {
      play('error');
      useCommunity.getState().notify(res.message);
      return;
    }
    const ok = await useDm.getState().run({
      a: 'send',
      peer: props.peer,
      text: tr('Join me in {community}: {link}', { community, link: res.value }),
    });
    if (ok) {
      play('send');
      setSent(community);
      useCommunity
        .getState()
        .notify(tr('Invite to {community} sent to {name}', { community, name: props.name }));
    }
  };
  return (
    <span className="invite-to">
      <button
        className="icon-btn"
        aria-label={tr('Invite {name} to a community', { name: props.name })}
        aria-expanded={open}
        title={sent ? tr('Invited to {community}', { community: sent }) : tr('Invite to a community')}
        onClick={() => setOpen((v) => !v)}
      >
        ➕
      </button>
      {open && (
        <span className="invite-to__menu glass" role="menu">
          {communities.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              className="invite-to__item"
              onClick={() => void invite(c.id, c.name)}
            >
              {c.icon ?? '🏠'} {c.name}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
