import { memo, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  MAX_FOLDERS,
  type ChatFolder,
  type ConversationView,
  type DirectMessageView,
} from '../../../shared/dm.ts';
import { FOREVER, isMuted, withOverride } from '../../../shared/notify-rules.ts';
import { useMessageGestures } from '../components/gestures.ts';
import { useCommunity } from '../community/store.ts';
import { Highlight, MenuItem, Popover } from '../community/ui/common.tsx';
import { NotifyMenuSection } from '../community/ui/NotifyMenu.tsx';
import { isTyping, useDm } from '../dm/store.ts';
import {
  CHAT_FILTERS,
  chatFlags,
  ConvAvatar,
  FolderDialog,
  GroupAvatar,
  matchesFilter,
  NewMessage,
  shortWhen,
} from '../pages/MessagesPage.tsx';
import { Composer, StoriesRail, StoryViewer, type StoryAt } from '../pages/SocialPage.tsx';
import { useSocial } from '../social/store.ts';
import { tr, trn } from '../i18n.ts';
import { useRiver } from '../store.ts';
import {
  ArchiveIcon,
  ComposeIcon,
  ContactsIcon,
  Glyph,
  MutedIcon,
  PinnedIcon,
  ReadIcon,
  SearchIcon,
  TrashIcon,
  UnreadIcon,
} from './icons.tsx';
import { openPhoneChat, phonePush, phoneTab } from './nav.ts';
import { SwipeRow, type RowAction } from './SwipeRow.tsx';
import { countLabel, TabPage } from './ui.tsx';
import { FirstSteps } from './FirstSteps.tsx';

/** Chats (2.12): your conversations as in Telegram, with your friends' stories on top. */
export function ChatsTab({ notices }: { notices?: ReactNode }): ReactElement {
  const dm = useDm();
  const account = useRiver((r) => r.account);
  const registered = account.state === 'registered';
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    void useDm.getState().load();
    if (registered) void useSocial.getState().load();
  }, [account.state, registered]);

  const connecting =
    registered && account.connection !== 'online' ? (
      <span className="pconnecting" role="status">
        <span className="pconnecting__spin" aria-hidden="true" />
        {account.connection === 'connecting' ? tr('Connecting…') : tr('Waiting for network…')}
      </span>
    ) : null;
  const requests = dm.conversations.filter((c) => c.state === 'request').length;

  return (
    <TabPage
      title={tr('Chats')}
      subtitle={connecting}
      start={
        <button
          className="ptab__btn"
          aria-label={tr('Friends')}
          onClick={() => phonePush({ kind: 'friends' })}
        >
          <ContactsIcon size={25} />
          {requests > 0 && <span className="ptab__dot" aria-hidden="true" />}
        </button>
      }
      end={
        registered && (
          <button className="ptab__btn" aria-label={tr('New message')} onClick={() => setComposing(true)}>
            <ComposeIcon size={25} />
          </button>
        )
      }
    >
      {notices}
      {registered ? (
        <ChatList onCompose={() => setComposing(true)} />
      ) : account.state === 'none' && account.waiting ? (
        // River makes the account by itself (2.0); it only waits for its server.
        <div className="pempty" role="status">
          <div className="pempty__icon" aria-hidden="true">
            💬
          </div>
          <h2>{tr('Setting up your account…')}</h2>
          <p>{tr('River keeps trying by itself. Your chats appear here as soon as it is ready.')}</p>
        </div>
      ) : account.state === 'none' && account.needsInvite ? (
        <div className="pempty">
          <div className="pempty__icon" aria-hidden="true">
            💬
          </div>
          <h2>{tr('One more step')}</h2>
          <p>{tr('Paste the sign-up link from whoever runs your River server in the card above.')}</p>
        </div>
      ) : (
        <div className="pempty">
          <div className="pempty__icon" aria-hidden="true">
            💬
          </div>
          <h2>{tr('No account yet')}</h2>
          <p>
            {tr('Direct messages start once you have an account — join a community with an invite link.')}
          </p>
          <button className="pbtn" onClick={() => phoneTab('communities')}>
            {tr('Join a community')}
          </button>
        </div>
      )}
      {composing && <NewMessage onClose={() => setComposing(false)} />}
    </TabPage>
  );
}

function ChatList({ onCompose }: { onCompose(): void }): ReactElement {
  const dm = useDm();
  const prefs = useRiver((r) => r.settings?.notifications);
  const feed = useSocial((s) => s.feed);
  const [query, setQuery] = useState('');
  const [results, setFound] = useState<DirectMessageView[]>([]);
  const found = query.trim().length >= 2 ? results : [];
  // Answers can come back out of order: only the one for what is in the box now counts.
  const asked = useRef('');
  useEffect(() => {
    const q = query.trim();
    asked.current = q;
    if (q.length < 2) return;
    const t = window.setTimeout(() => {
      void window.river.dm.action({ a: 'search', query: q }).then((r) => {
        if (r.ok && asked.current === q) setFound(r.value);
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);
  const [filter, setFilter] = useState('all');
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [editingFolder, setEditingFolder] = useState<ChatFolder | 'new' | null>(null);
  useEffect(() => {
    void window.river.dm.action({ a: 'folders' }).then((r) => {
      if (r.ok) setFolders(r.value);
    });
  }, []);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [story, setStory] = useState<StoryAt | null>(null);
  const [addingStory, setAddingStory] = useState(false);

  const activeFolder = folders.find((f) => `folder:${f.id}` === filter) ?? null;
  const named = dm.conversations.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  const requests = named.filter((c) => c.state === 'request');
  const archived = named.filter((c) => c.state !== 'request' && c.archived);
  const archivedUnread = archived.reduce((n, c) => n + c.unread, 0);
  const chats = named
    .filter((c) => c.state !== 'request' && (archiveOpen ? c.archived : !c.archived))
    .filter((c) => matchesFilter(c, filter, activeFolder));
  const muted = (c: ConversationView): boolean => !!prefs && isMuted(prefs, c.riverId);
  const stories = feed?.stories ?? [];
  const searching = query.trim().length > 0;

  return (
    <>
      <div className="psearch">
        <SearchIcon size={18} />
        <input
          type="search"
          placeholder={tr('Search')}
          aria-label={tr('Search chats and messages')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          // Back clears the search too, as in Telegram.
          <button
            type="button"
            className="psearch__clear"
            aria-label={tr('Clear search')}
            data-phone-back=""
            onClick={() => setQuery('')}
          >
            ✕
          </button>
        )}
      </div>
      {/* The archive is a list of its own: no stories or message requests over it. */}
      {!searching && !archiveOpen && stories.length > 0 && (
        <StoriesRail
          feed={feed}
          onOpen={(g) => {
            const first = g.stories.findIndex((s) => !s.mine && !s.seen);
            const index = Math.max(0, first);
            const s = g.stories[index];
            if (s) setStory({ riverId: g.riverId, storyId: s.id, index });
          }}
          onAdd={() => setAddingStory(true)}
        />
      )}
      {!searching && !archiveOpen && (
        <div className="pchips" role="radiogroup" aria-label={tr('Show conversations')}>
          {[
            ...CHAT_FILTERS.map((f) => ({ ...f, label: tr(f.label) })),
            ...folders.map((f) => ({ id: `folder:${f.id}`, label: f.name })),
          ].map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={filter === f.id}
              className={`pchip ${filter === f.id ? 'is-active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          {activeFolder ? (
            <button
              className="pchip pchip--icon"
              aria-label={tr('Edit folder {name}', { name: activeFolder.name })}
              onClick={() => setEditingFolder(activeFolder)}
            >
              ✎
            </button>
          ) : (
            folders.length < MAX_FOLDERS && (
              <button
                className="pchip pchip--icon"
                aria-label={tr('New chat folder')}
                onClick={() => setEditingFolder('new')}
              >
                ＋
              </button>
            )
          )}
        </div>
      )}
      {editingFolder && (
        <FolderDialog
          folder={editingFolder === 'new' ? null : editingFolder}
          conversations={dm.conversations.filter((c) => c.state !== 'request')}
          onSaved={(list, id) => {
            setFolders(list);
            setEditingFolder(null);
            setFilter(id ? `folder:${id}` : 'all');
          }}
          onClose={() => setEditingFolder(null)}
        />
      )}
      {archiveOpen && (
        <button className="plist__back" data-phone-back="" onClick={() => setArchiveOpen(false)}>
          ‹ {tr('Archived chats')}
        </button>
      )}
      {!archiveOpen && requests.length > 0 && (
        <>
          <h2 className="plist__head">
            {tr('Message requests')} · {requests.length}
          </h2>
          <ul className="plist" aria-label={tr('Message requests')}>
            {requests.map((c) => (
              <ChatRow key={c.riverId} c={c} muted={muted(c)} />
            ))}
          </ul>
        </>
      )}
      {found.length > 0 && <h2 className="plist__head">{tr('Chats')}</h2>}
      <ul className="plist" aria-label={archiveOpen ? tr('Archived chats') : tr('Chats')}>
        {!searching && !archiveOpen && filter === 'all' && archived.length > 0 && (
          <li>
            <button className="prow prow--special" onClick={() => setArchiveOpen(true)}>
              <span className="prow__avatar prow__avatar--glyph prow__avatar--gray" aria-hidden="true">
                <ArchiveIcon size={26} />
              </span>
              <span className="prow__main">
                <span className="prow__top">
                  <strong className="prow__name">{tr('Archived chats')}</strong>
                </span>
                <span className="prow__bottom">
                  <span className="prow__preview">
                    {archived
                      .slice(0, 3)
                      .map((c) => c.name)
                      .join(', ')}
                  </span>
                  {archivedUnread > 0 && (
                    <span className="pbadge pbadge--muted">{countLabel(archivedUnread)}</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        )}
        {!searching && !archiveOpen && filter === 'all' && !dm.conversations.some((c) => c.self) && (
          <li>
            <button
              className="prow prow--special"
              onClick={() =>
                void dm.run({ a: 'noteToSelf' }).then((c) => {
                  if (c) openPhoneChat(c.riverId);
                })
              }
            >
              <span className="prow__avatar prow__avatar--glyph prow__avatar--accent" aria-hidden="true">
                <Glyph.bookmark size={26} />
              </span>
              <span className="prow__main">
                <span className="prow__top">
                  <strong className="prow__name">{tr('Note to self')}</strong>
                </span>
                <span className="prow__bottom">
                  <span className="prow__preview">{tr('Notes, links and files for yourself')}</span>
                </span>
              </span>
            </button>
          </li>
        )}
        {chats.map((c) => (
          <ChatRow key={c.riverId} c={c} muted={muted(c)} />
        ))}
      </ul>
      {chats.length === 0 &&
      !searching &&
      !archiveOpen &&
      filter === 'all' &&
      requests.length === 0 &&
      archived.length === 0 ? (
        // Your first chat is a few taps away (2.14).
        <FirstSteps />
      ) : (
        chats.length === 0 &&
        !searching && (
          <div className="pempty pempty--small">
            <p>
              {archiveOpen
                ? tr('No archived chats.')
                : filter === 'all'
                  ? tr('No chats yet. Start one with a friend.')
                  : tr('Nothing here.')}
            </p>
            {!archiveOpen && filter === 'all' && (
              <button className="pbtn" onClick={onCompose}>
                {tr('Start a chat')}
              </button>
            )}
          </div>
        )
      )}
      {found.length > 0 && (
        <>
          <h2 className="plist__head">
            {tr('Messages')} · {found.length}
          </h2>
          <ul className="plist" aria-label={tr('Messages found')}>
            {found.map((m) => {
              const conv = dm.conversations.find((c) => c.riverId === m.peer);
              return (
                <li key={m.id}>
                  <button className="prow" onClick={() => openPhoneChat(m.peer)}>
                    {conv ? (
                      conv.kind === 'group' ? (
                        <GroupAvatar c={conv} size={54} />
                      ) : (
                        <ConvAvatar c={conv} size={54} />
                      )
                    ) : (
                      <span
                        className="prow__avatar prow__avatar--glyph prow__avatar--gray"
                        aria-hidden="true"
                      >
                        <SearchIcon size={24} />
                      </span>
                    )}
                    <span className="prow__main">
                      <span className="prow__top">
                        <strong className="prow__name">{conv?.name ?? m.senderName}</strong>
                        <time className="prow__time">{shortWhen(m.sentAt)}</time>
                      </span>
                      <span className="prow__bottom">
                        <span className="prow__preview">
                          {m.mine ? `${tr('You')}: ` : conv?.kind === 'group' ? `${m.senderName}: ` : ''}
                          {m.text ? (
                            <Highlight text={m.text} query={query} max={90} />
                          ) : (
                            m.attachments.map((a) => a.name).join(', ')
                          )}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {story && feed && (
        <StoryViewer feed={feed} at={story} onMove={setStory} onClose={() => setStory(null)} />
      )}
      {addingStory && (
        <Composer kind="story" friends={feed?.friends ?? []} onClose={() => setAddingStory(false)} />
      )}
    </>
  );
}

/** The line under a chat's name: typing, or the last message. */
export function previewOf(c: ConversationView, typing: boolean): ReactNode {
  if (typing) return <em className="prow__typing">{tr('typing…')}</em>;
  if (c.state === 'blocked') return tr('Blocked');
  if (c.state === 'left') return tr('You left this group');
  if (c.state === 'request' && c.kind === 'group') return tr('Invited you to a group');
  if (!c.last) return c.self ? tr('Notes, links and files for yourself') : tr('No messages yet');
  const text = c.last.text || tr('Attachment');
  return c.last.mine ? (
    <>
      <span className="prow__you">{tr('You')}: </span>
      {text}
    </>
  ) : (
    text
  );
}

/** Memoised, and not subscribed to the whole DM store: a long list draws only the rows that changed. */
const ChatRow = memo(function ChatRow({ c, muted }: { c: ConversationView; muted: boolean }): ReactElement {
  useDm((x) => x.typing[c.riverId]);
  const typing = isTyping(c.riverId);
  const update = useRiver((r) => r.updateSettings);
  const overrides = useRiver((r) => r.settings?.notifications.overrides);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { onClickCapture: guardClick, ...hold } = useMessageGestures({ onHold: (x, y) => setMenu({ x, y }) });
  const unread = c.unread > 0 || !!c.markedUnread;
  const markRead = (): void => {
    if (unread) {
      chatFlags(c.riverId, { markedUnread: false });
      void window.river.dm.action({ a: 'read', peer: c.riverId });
    } else chatFlags(c.riverId, { markedUnread: true });
  };
  const remove = (): void =>
    useCommunity.getState().setModal({
      kind: 'confirm',
      title: tr('Delete conversation with {name}', { name: c.name }),
      body: tr('This deletes the messages on this device only. The other person keeps their copy.'),
      action: tr('Delete'),
      run: async () => {
        await useDm.getState().run({ a: 'removeConversation', peer: c.riverId });
      },
    });
  const toggleMute = (): void => {
    if (!overrides) return;
    void update({
      notifications: { overrides: withOverride(overrides, c.riverId, { muteUntil: muted ? null : FOREVER }) },
    });
  };
  const start: RowAction[] = [
    {
      label: unread ? tr('Read') : tr('Unread'),
      icon: unread ? <ReadIcon size={22} /> : <UnreadIcon size={22} />,
      tone: 'blue',
      run: markRead,
    },
    {
      label: c.pinned ? tr('Unpin') : tr('Pin'),
      icon: <PinnedIcon size={22} />,
      tone: 'green',
      run: () => chatFlags(c.riverId, { pinned: !c.pinned }),
    },
  ];
  const end: RowAction[] = [
    {
      label: muted ? tr('Unmute') : tr('Mute'),
      icon: <MutedIcon size={22} />,
      tone: 'orange',
      run: toggleMute,
    },
    { label: tr('Delete'), icon: <TrashIcon size={22} />, tone: 'red', run: remove },
    {
      label: c.archived ? tr('Unarchive') : tr('Archive'),
      icon: <ArchiveIcon size={22} />,
      tone: 'gray',
      run: () => chatFlags(c.riverId, { archived: !c.archived }),
    },
  ];
  return (
    <li>
      <SwipeRow start={c.state === 'request' ? [] : start} end={c.state === 'request' ? [] : end}>
        <button
          {...hold}
          onClickCapture={guardClick}
          className={`prow ${unread ? 'is-unread' : ''} ${c.state === 'blocked' ? 'is-blocked' : ''}`}
          onClick={() => openPhoneChat(c.riverId)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {c.kind === 'group' ? <GroupAvatar c={c} size={54} /> : <ConvAvatar c={c} size={54} />}
          <span className="prow__main">
            <span className="prow__top">
              <strong className="prow__name">{c.name}</strong>
              {c.verified && (
                <span className="prow__verified" role="img" aria-label={tr('Verified')}>
                  ✓
                </span>
              )}
              {muted && (
                <span className="prow__flag" role="img" aria-label={tr('Muted')}>
                  <MutedIcon size={15} />
                </span>
              )}
              {c.last && <time className="prow__time">{shortWhen(c.last.sentAt)}</time>}
            </span>
            <span className="prow__bottom">
              <span className="prow__preview">{previewOf(c, typing)}</span>
              {c.unread > 0 ? (
                <span
                  key={c.unread}
                  className={`pbadge ${muted ? 'pbadge--muted' : ''}`}
                  aria-label={trn('{count} unread', c.unread)}
                >
                  {countLabel(c.unread)}
                </span>
              ) : c.markedUnread ? (
                <span
                  className={`pbadge pbadge--dot ${muted ? 'pbadge--muted' : ''}`}
                  aria-label={tr('Marked unread')}
                />
              ) : (
                c.pinned && (
                  <span className="prow__flag prow__flag--pin" role="img" aria-label={tr('Pinned')}>
                    <PinnedIcon size={16} />
                  </span>
                )
              )}
            </span>
          </span>
        </button>
      </SwipeRow>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          <MenuItem
            onClick={() => {
              setMenu(null);
              chatFlags(c.riverId, { pinned: !c.pinned });
            }}
          >
            {c.pinned ? tr('Unpin') : tr('Pin to top')}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              markRead();
            }}
          >
            {unread ? tr('Mark as read') : tr('Mark as unread')}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              chatFlags(c.riverId, { archived: !c.archived });
            }}
          >
            {c.archived ? tr('Unarchive') : tr('Archive')}
          </MenuItem>
          <NotifyMenuSection id={c.riverId} kind="conversation" onDone={() => setMenu(null)} />
          <MenuItem
            danger
            onClick={() => {
              setMenu(null);
              remove();
            }}
          >
            {tr('Delete chat')}
          </MenuItem>
        </Popover>
      )}
    </li>
  );
});
