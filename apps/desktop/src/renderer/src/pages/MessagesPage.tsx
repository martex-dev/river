import type { CallView } from '../../../shared/dm.ts';
import { VoiceRecorder } from '../components/VoiceMessage.tsx';
import { fromOverlay, haptic, useMessageGestures } from '../components/gestures.ts';
import { burst } from '../appearance/delight.tsx';
import { ChatWallpaperDialog, useChatWallpaper } from '../appearance/ChatWallpaper.tsx';
import { dmKey } from '../appearance/wallpaper.ts';
import { enterSends } from '../components/keys.ts';
import { isPhone } from '../../../shared/platform.ts';
import { localDay, newSince } from '../components/unread.ts';
import { CreatePollDialog, PollCard } from '../community/ui/Poll.tsx';
import { firstLink, LinkCard } from '../community/ui/LinkCard.tsx';
import { MyStickersButton } from '../community/ui/Stickers.tsx';
import { isVote } from '../../../shared/poll.ts';
import { create } from 'zustand';
import { useSharedFiles, useSharedText } from '../components/ShareSheet.tsx';
import { callNote, callsBetween } from '../dm/call-notes.ts';
import { NotifyMenuSection } from '../community/ui/NotifyMenu.tsx';
import { ForwardDialog } from '../community/ui/Forward.tsx';
import { readDraft, saveDraft, useDraft } from '../community/drafts.ts';
import { quoteOf } from '../dm/quote.ts';
import { clockTime, dateLocale, dayLabel, fullWhen } from '../time.ts';
import { msg, tr, trn } from '../i18n.ts';
import { ChatSkeleton, EditActions, HistoryFailed, typingText } from '../community/ui/Chat.tsx';
import {
  EMOJI_PICKER,
  fromBottom,
  insertIntoBox,
  nearButton,
  stopEditing,
  useGrowToFit,
  useStickToBottom,
} from '../components/chat-ui.ts';
import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  TIMER_CHOICES,
  timerLabel,
  type ConversationView,
  type DirectMessageView,
  type ScheduledView,
  type ChatFolder,
  MAX_FOLDERS,
  MESSAGE_EFFECTS,
  type MessageEffect,
} from '../../../shared/dm.ts';
import { bigEmojiCount, replyPreview } from '../components/message-kinds.ts';
import { EFFECT_LABELS, markEffectSeen, playEffect, useMessageEffects } from '../appearance/effects.tsx';
import { quiet } from '../appearance/delight.tsx';
import {
  matchReplies,
  savedReplyQuery,
  SavedRepliesMenu,
  SavedReplySuggestions,
  useSavedReplyList,
} from '../dm/saved-replies.tsx';
import {
  hasTag,
  noteTagKey,
  TagChips,
  TagDialog,
  TagFilter,
  tagsIn,
  useMessageTags,
  useTags,
} from '../dm/tags.tsx';
import { play } from '../community/sound.ts';
import { useCommunity } from '../community/store.ts';
import {
  AttachmentList,
  galleryOf,
  GalleryContext,
  MAX_PENDING,
  PendingFiles,
  pendingFrom,
  uploadAll,
  usePendingFiles,
  type PendingFile,
} from '../community/ui/Attachments.tsx';
import {
  Avatar,
  avatarColor,
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
import { GroupCallBar, GroupCallButtons, GroupCallInChat } from '../dm/GroupCallUi.tsx';
import { useGroupCall } from '../dm/group-call.ts';
import { useRiver } from '../store.ts';
import { findInvite } from '../../../shared/invite-link.ts';
import { joinWithLink } from '../community/ui/StartScreen.tsx';
import { phonePop } from '../phone/nav.ts';
import { chatsBadge } from '../phone/calls.ts';
import {
  BackIcon,
  ClipIcon,
  ClockIcon,
  DoubleTickIcon,
  EmojiIcon,
  MoreIcon,
  PhoneCallIcon,
  SavedRepliesIcon,
  SendIcon,
  TickIcon,
  VideoIcon,
} from '../phone/icons.tsx';

const GROUP_MS = 5 * 60_000;
const RIVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const timeOf = (iso: string): string => clockTime(iso);

export function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return timeOf(iso);
  return d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' });
}

/** One shared empty list, so memos do not see a new array every render. */
const NO_MESSAGES: never[] = [];

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

/** Search, then your direct messages: the Home sidebar's list (1.0.42), as in Discord. */
export function ConversationList({ onNew, nav }: { onNew(): void; nav?: ReactNode }): ReactElement {
  const dm = useDm();
  const [query, setQuery] = useState('');
  const filtered = dm.conversations.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
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
  const [filter, setFilter] = useState<string>('all');
  const [folders, setFolders] = useState<ChatFolder[]>([]);
  const [editingFolder, setEditingFolder] = useState<ChatFolder | 'new' | null>(null);
  useEffect(() => {
    void window.river.dm.action({ a: 'folders' }).then((r) => {
      if (r.ok) setFolders(r.value);
    });
  }, []);
  const activeFolder = folders.find((f) => `folder:${f.id}` === filter) ?? null;
  const [archiveOpen, setArchiveOpen] = useState(false);
  const requests = filtered.filter((c) => c.state === 'request');
  const archived = filtered.filter((c) => c.state !== 'request' && c.archived);
  const archivedUnread = archived.reduce((n, c) => n + c.unread, 0);
  const chats = filtered
    .filter((c) => c.state !== 'request' && (archiveOpen ? c.archived : !c.archived))
    .filter((c) => matchesFilter(c, filter, activeFolder));
  return (
    <div className="dms__list">
      <div className="home-sidebar__search">
        <input
          className="search dms__search"
          placeholder={tr('Find a conversation')}
          aria-label="Find a conversation or message"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="home-sidebar__scroll" aria-label="Conversations">
        {nav}
        {found.length > 0 && (
          <>
            <div className="channel-group__head">
              <span>Messages — {found.length}</span>
            </div>
            {found.map((m) => {
              const conv = dm.conversations.find((c) => c.riverId === m.peer);
              return (
                <button key={m.id} className="dm-row" onClick={() => openDm(m.peer)}>
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
        <div className="channel-group__head home-sidebar__dm-head">
          {archiveOpen ? (
            <button className="btn btn--link" onClick={() => setArchiveOpen(false)}>
              ← Archived chats
            </button>
          ) : (
            <span>Direct messages</span>
          )}
          <button className="icon-btn" aria-label="New message" title="New message" onClick={onNew}>
            <PlusIcon size={16} />
          </button>
        </div>
        {!archiveOpen && (
          <div className="chat-filters-row">
            <div className="chat-filters" role="radiogroup" aria-label="Show conversations">
              {[
                ...CHAT_FILTERS.map((f) => ({ ...f, label: tr(f.label) })),
                ...folders.map((f) => ({ id: `folder:${f.id}`, label: f.name })),
              ].map((f) => (
                <button
                  key={f.id}
                  role="radio"
                  aria-checked={filter === f.id}
                  className={`chat-filters__tab ${filter === f.id ? 'is-active' : ''}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {activeFolder ? (
              <button
                className="icon-btn chat-filters__edit"
                aria-label={`Edit folder ${activeFolder.name}`}
                title="Edit this folder"
                onClick={() => setEditingFolder(activeFolder)}
              >
                ✎
              </button>
            ) : (
              folders.length < MAX_FOLDERS && (
                <button
                  className="icon-btn chat-filters__edit"
                  aria-label="New chat folder"
                  title="New chat folder"
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
        {!archiveOpen && filter === 'all' && !dm.conversations.some((c) => c.self) && (
          <button
            className="dm-row dm-row--archive"
            onClick={() =>
              void dm.run({ a: 'noteToSelf' }).then((c) => {
                if (c) openDm(c.riverId);
              })
            }
          >
            <span className="dm-row__archive-icon" aria-hidden="true">
              🔖
            </span>
            <span className="dm-row__text">
              <span className="dm-row__top">
                <strong>Note to self</strong>
              </span>
              <span className="dm-row__last muted small">Notes, links and files for yourself</span>
            </span>
          </button>
        )}
        {!archiveOpen && archived.length > 0 && filter === 'all' && (
          <button className="dm-row dm-row--archive" onClick={() => setArchiveOpen(true)}>
            <span className="dm-row__archive-icon" aria-hidden="true">
              🗄
            </span>
            <span className="dm-row__text">
              <span className="dm-row__top">
                <strong>Archived chats</strong>
              </span>
              <span className="dm-row__last muted small">
                {archived
                  .slice(0, 3)
                  .map((c) => c.name)
                  .join(', ')}
              </span>
            </span>
            {archivedUnread > 0 && <span className="badge">{archivedUnread}</span>}
          </button>
        )}
        {chats.length === 0 && (
          <p className="muted small dms__hint">
            {archiveOpen
              ? 'No archived chats.'
              : filter === 'all'
                ? 'No conversations yet.'
                : 'Nothing here.'}
          </p>
        )}
        {chats.map((c) => (
          <ConversationRow key={c.riverId} c={c} />
        ))}
      </div>
    </div>
  );
}

/** Opens a conversation from anywhere in the Home sidebar. */
function openDm(peer: string): void {
  useDm.getState().select(peer);
  useRiver.getState().navigate('messages');
}

/** Selecting several messages in one conversation (2.2). */
const useSelection = create<{
  peer: string | null;
  ids: string[];
  start(peer: string, id: string): void;
  toggle(id: string): void;
  clear(): void;
}>((set, get) => ({
  peer: null,
  ids: [],
  start: (peer, id) => set({ peer, ids: [id] }),
  toggle: (id) => {
    const ids = get().ids.includes(id) ? get().ids.filter((x) => x !== id) : [...get().ids, id];
    set(ids.length ? { ids } : { peer: null, ids: [] });
  },
  clear: () => set({ peer: null, ids: [] }),
}));

/** A person's profile from their chat (2.10.9): picture, bio, groups in common and actions. */
function ContactSheet(props: {
  c: ConversationView;
  onClose(): void;
  onSafety(): void;
  onMedia(): void;
  onSearch(): void;
}): ReactElement {
  const { c } = props;
  const dm = useDm();
  // One call at a time: none while one is on or ringing (a group call too, 2.18).
  const inGroupCall = useGroupCall((s) => !!s.active);
  const callBusy = useDmCall((s) => !!s.active || !!s.incoming) || inGroupCall;
  const [bio, setBio] = useState('');
  useEffect(() => {
    void window.river.social.action({ a: 'profile', riverId: c.riverId }).then((r) => {
      if (r.ok) setBio((r.value as { bio?: string }).bio ?? '');
    });
  }, [c.riverId]);
  const common = dm.conversations.filter(
    (g) => g.kind === 'group' && g.state !== 'left' && g.members.some((m) => m.riverId === c.riverId),
  );
  // Not before they accepted your request.
  const canCall = c.state === 'accepted' && !c.awaitingReply && !callBusy;
  return (
    <Modal title="Profile" onClose={props.onClose}>
      <div className="contact-sheet">
        <ConvAvatar c={c} size={96} />
        <h2 className="contact-sheet__name">{c.name}</h2>
        <span className={`chip dm-lock ${c.verified ? 'is-verified' : ''}`}>
          {c.verified ? '✓ Verified' : '🔒 End-to-end encrypted'}
        </span>
        {bio && <p className="contact-sheet__bio">{bio}</p>}
        <div className="contact-sheet__actions">
          <button
            className="contact-sheet__action"
            disabled={!canCall}
            onClick={() => {
              props.onClose();
              void startDmCall(c.riverId, false);
            }}
          >
            <PhoneIcon size={20} />
            <span>Call</span>
          </button>
          <button
            className="contact-sheet__action"
            disabled={!canCall}
            onClick={() => {
              props.onClose();
              void startDmCall(c.riverId, true);
            }}
          >
            <CameraIcon size={20} />
            <span>Video</span>
          </button>
          <button className="contact-sheet__action" onClick={props.onSearch}>
            <span aria-hidden="true">🔍</span>
            <span>Search</span>
          </button>
          <button className="contact-sheet__action" onClick={props.onMedia}>
            <span aria-hidden="true">🖼</span>
            <span>Media</span>
          </button>
        </div>
      </div>
      {common.length > 0 && (
        <>
          <div className="field__label">Groups in common · {common.length}</div>
          <ul className="contact-sheet__groups">
            {common.map((g) => (
              <li key={g.riverId}>
                <button
                  className="dm-row"
                  onClick={() => {
                    props.onClose();
                    openDm(g.riverId);
                  }}
                >
                  <GroupAvatar c={g} size={28} />
                  <span className="dm-row__text">
                    <strong>{g.name}</strong>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="field__label">River ID</div>
      <button className="btn btn--link contact-sheet__id mono small" onClick={() => copyText(c.riverId)}>
        {c.riverId}
      </button>
      <div className="button-row">
        <button className="btn btn--ghost" onClick={props.onSafety}>
          View safety number
        </button>
        {c.state === 'blocked' ? (
          <button className="btn btn--ghost" onClick={() => void dm.run({ a: 'unblock', peer: c.riverId })}>
            Unblock
          </button>
        ) : (
          <button
            className="btn btn--ghost btn--danger-text"
            onClick={() => {
              props.onClose();
              void dm.run({ a: 'block', peer: c.riverId });
            }}
          >
            Block
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Make or change a chat folder (2.10.8): a name and the chats in it. */
export function FolderDialog(props: {
  folder: ChatFolder | null;
  conversations: ConversationView[];
  onSaved(folders: ChatFolder[], id: string | null): void;
  onClose(): void;
}): ReactElement {
  const [name, setName] = useState(props.folder?.name ?? '');
  const [peers, setPeers] = useState<string[]>(props.folder?.peers ?? []);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    const r = await window.river.dm.action({
      a: 'saveFolder',
      ...(props.folder ? { id: props.folder.id } : {}),
      name: name.trim(),
      peers,
    });
    setBusy(false);
    if (!r.ok) return useCommunity.getState().notify(r.message, 'error');
    const saved = props.folder ? props.folder.id : (r.value.at(-1)?.id ?? null);
    props.onSaved(r.value, saved);
  };
  const remove = async (): Promise<void> => {
    if (!props.folder) return;
    const r = await window.river.dm.action({ a: 'deleteFolder', id: props.folder.id });
    if (r.ok) props.onSaved(r.value, null);
  };
  return (
    <Modal title={props.folder ? 'Edit folder' : 'New chat folder'} onClose={props.onClose}>
      <label className="textfield">
        <span className="field__label">Name</span>
        <input
          autoFocus
          maxLength={24}
          placeholder="Family, Work, Gaming…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field__label">Chats in this folder</div>
      <ul className="folder-pick">
        {props.conversations.map((c) => (
          <li key={c.riverId}>
            <label className="folder-pick__row">
              <input
                type="checkbox"
                checked={peers.includes(c.riverId)}
                onChange={(e) =>
                  setPeers(e.target.checked ? [...peers, c.riverId] : peers.filter((p) => p !== c.riverId))
                }
              />
              {c.kind === 'group' ? <GroupAvatar c={c} size={24} /> : <ConvAvatar c={c} size={24} />}
              <span>{c.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="muted small">Folders are kept on this device only.</p>
      <div className="button-row">
        {props.folder && (
          <button className="btn btn--danger" onClick={() => void remove()}>
            Delete folder
          </button>
        )}
        <button className="btn btn--ghost" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          Save
        </button>
      </div>
    </Modal>
  );
}

/** From a group message to a direct message with its sender, quoting it (2.10.11). */
async function replyPrivately(m: DirectMessageView, group: string): Promise<void> {
  const dm = useDm.getState();
  if (!dm.conversations.some((x) => x.riverId === m.sender)) {
    const opened = await dm.run({ a: 'open', peer: m.sender, name: m.senderName });
    if (!opened) return;
  }
  saveDraft(`d:${m.sender}`, quoteOf(m.text, `A message in ${group}`));
  openDm(m.sender);
}

/** Copies text and says so (or says why not). */
export function copyText(text: string): void {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => {
      play('success');
      useCommunity.getState().notify('Copied');
    })
    .catch(() => useCommunity.getState().notify('River could not copy that.', 'error'));
}

type ChatFilter = 'all' | 'unread' | 'people' | 'groups';
export const CHAT_FILTERS: Array<{ id: ChatFilter; label: string }> = [
  { id: 'all', label: msg('All') },
  { id: 'unread', label: msg('Unread') },
  { id: 'people', label: msg('People') },
  { id: 'groups', label: msg('Groups') },
];

export function matchesFilter(c: ConversationView, filter: string, folder: ChatFolder | null): boolean {
  if (folder) return folder.peers.includes(c.riverId);
  if (filter === 'unread') return c.unread > 0 || !!c.markedUnread;
  if (filter === 'people') return c.kind === 'direct';
  if (filter === 'groups') return c.kind === 'group';
  return true;
}

export function chatFlags(
  peer: string,
  flags: { pinned?: boolean; archived?: boolean; markedUnread?: boolean },
): void {
  void window.river.dm.action({ a: 'chatFlags', peer, ...flags }).then((r) => {
    if (!r.ok) useCommunity.getState().notify(r.message, 'error');
  });
}

/**
 * One chat in the list. Memoised, and subscribed only to its own selection and typing: a message
 * in one chat no longer draws every row of a long list again.
 */
const ConversationRow = memo(function ConversationRow({ c }: { c: ConversationView }): ReactElement {
  const active = useDm((x) => x.selected === c.riverId);
  useDm((x) => x.typing[c.riverId]);
  const typing = isTyping(c.riverId);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { onClickCapture: guardClick, ...hold } = useMessageGestures({ onHold: (x, y) => setMenu({ x, y }) });
  return (
    <>
      <button
        {...hold}
        onClickCapture={guardClick}
        className={`dm-row ${active ? 'is-active' : ''} ${c.unread || c.markedUnread ? 'is-unread' : ''} ${c.state === 'blocked' ? 'is-blocked' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => openDm(c.riverId)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {c.kind === 'group' ? <GroupAvatar c={c} size={32} /> : <ConvAvatar c={c} size={32} />}
        <span className="dm-row__text">
          <span className="dm-row__top">
            <strong title={c.name}>{c.name}</strong>
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
        {c.pinned && (
          <span className="dm-row__pin" title="Pinned" aria-label="Pinned">
            📌
          </span>
        )}
        {c.unread > 0 ? (
          <span key={c.unread} className="badge badge--mention">
            {c.unread}
          </span>
        ) : (
          c.markedUnread && <span className="dm-row__dot" aria-label="Marked unread" />
        )}
      </button>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          <MenuItem
            onClick={() => {
              setMenu(null);
              chatFlags(c.riverId, { pinned: !c.pinned });
            }}
          >
            {c.pinned ? 'Unpin' : 'Pin to top'}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              if (c.unread > 0 || c.markedUnread) {
                chatFlags(c.riverId, { markedUnread: false });
                void window.river.dm.action({ a: 'read', peer: c.riverId });
              } else chatFlags(c.riverId, { markedUnread: true });
            }}
          >
            {c.unread > 0 || c.markedUnread ? 'Mark as read' : 'Mark as unread'}
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(null);
              chatFlags(c.riverId, { archived: !c.archived });
            }}
          >
            {c.archived ? 'Unarchive' : 'Archive'}
          </MenuItem>
        </Popover>
      )}
    </>
  );
});

export function Conversation(props: { conversation: ConversationView; onSafety(): void }): ReactElement {
  const c = props.conversation;
  const dm = useDm();
  const messages = useDm((x) => x.messages[c.riverId]) ?? NO_MESSAGES;
  // A skeleton until the messages arrive, not "This is the beginning of your conversation" (2.13.1).
  const loaded = useDm((x) => x.messages[c.riverId] !== undefined);
  const failed = useDm((x) => !!x.historyFailed[c.riverId]);
  useEffect(() => {
    const state = useDm.getState();
    if (state.messages[c.riverId] === undefined && !state.historyFailed[c.riverId])
      void state.reload(c.riverId);
  }, [c.riverId]);
  const [showPins, setShowPins] = useState(false);
  const [searching, setSearching] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const wallpaper = useChatWallpaper(dmKey(c.riverId));
  const [polling, setPolling] = useState(false);
  const gallery = useMemo(() => galleryOf(messages.map((m) => m.attachments)), [messages]);
  const selection = useSelection();
  useEffect(() => () => useSelection.getState().clear(), [c.riverId]);
  // Calls with this person, from the local call history, shown between messages (1.0.29).
  const [calls, setCalls] = useState<CallView[]>([]);
  // Re-read after a call with this person starts or ends, and when a call was missed.
  const callBusy = useDmCall((x) => x.active?.peer === c.riverId || x.incoming?.peer === c.riverId);
  useEffect(() => {
    if (c.kind === 'group') return;
    void window.river.dm.action({ a: 'calls' }).then((r) => {
      // Only 1:1 calls: a call through a call link names its host, which put your own link's
      // calls into Note to self (and a host's link call into your chat with them).
      if (r.ok) setCalls((r.value as CallView[]).filter((x) => x.peer === c.riverId && !x.kind));
    });
  }, [c.riverId, c.kind, callBusy]);
  const pinned = messages.filter((m) => m.pinned);
  // A received message's effect plays the first time you see it (2.19).
  useMessageEffects(messages);
  // Note to self (2.19): show only the notes with one tag.
  const tags = useTags();
  const [tagFilter, setTagFilter] = useState<{ peer: string; tag: string } | null>(null);
  const noteTags = c.self
    ? tagsIn(
        tags,
        messages.map((m) => noteTagKey(m.id)),
      )
    : [];
  const activeTag =
    c.self && tagFilter?.peer === c.riverId && noteTags.includes(tagFilter.tag) ? tagFilter.tag : null;
  const shown = activeTag ? messages.filter((m) => hasTag(tags, noteTagKey(m.id), activeTag)) : messages;
  const myName = useRiver((r) => r.identity?.displayName) ?? tr('You');
  const myId = dm.myId ?? '';
  const scrollRef = useRef<HTMLDivElement>(null);
  // Pictures and previews loading below the newest message do not push it out of view.
  useStickToBottom(scrollRef, 80);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Files waiting to be sent stay with this conversation when you switch away and back.
  const { pending, setPending, add } = usePendingFiles(`d:${c.riverId}`);
  const [dragging, setDragging] = useState(false);
  const notify = useCommunity((s) => s.notify);
  const setModal = useCommunity((s) => s.setModal);
  const inGroupCall = useGroupCall((s) => !!s.active);
  const anyCall = useDmCall((s) => !!s.active || !!s.incoming) || inGroupCall;
  const [showMembers, setShowMembers] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [iconPicker, setIconPicker] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  // Phones (2.12): a Telegram-style header with Back; search and pins move into the menu.
  const phone = useRiver((r) => isPhone(r.info?.platform));

  // New messages scroll into view only when you are at the bottom (or sent them yourself);
  // reading older messages is not interrupted. "Jump to latest" brings you back.
  const [atBottom, setAtBottom] = useState(true);
  // The newest message when you scrolled up: the ones after it are new (2.10.1). A time, not a
  // position, so older messages loaded above it (a jump back) do not count as new.
  const [leftAt, setLeftAt] = useState<string | null>(null);
  const missed = leftAt === null ? 0 : newSince(messages, leftAt);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = opened.current !== c.riverId;
    opened.current = c.riverId;
    if (first || atBottom || messages.at(-1)?.mine) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, c.riverId]);

  useEffect(() => {
    const onFocus = (): void => void window.river.dm.action({ a: 'read', peer: c.riverId });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [c.riverId]);

  const addFiles = (files: Iterable<File>): void => {
    if (add(files) > 0)
      notify(tr('You can attach up to {count} files to one message.', { count: MAX_PENDING }), 'error');
  };
  // Shared from another app ("Share → River" on phones) into this conversation.
  useSharedFiles(`d:${c.riverId}`, addFiles);

  const confirmRemove = (): void =>
    setModal({
      kind: 'confirm',
      title: tr('Delete conversation with {name}', { name: c.name }),
      body: tr('This deletes the messages on this device only. The other person keeps their copy.'),
      action: tr('Delete'),
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
            <strong>{tr('Send to {name}', { name: c.name })}</strong>
            <span className="muted small">{tr('Files are encrypted on your device before upload.')}</span>
          </div>
        </div>
      )}
      {phone ? (
        <PhoneChatHead
          c={c}
          anyCall={anyCall}
          onProfile={() => (c.kind === 'group' ? setShowMembers(!showMembers) : setProfileOpen(true))}
          onMenu={(r) => setMenu({ x: r.right - 220, y: r.bottom + 4 })}
        />
      ) : (
        <header className="chat__head">
          {c.kind === 'group' || c.self ? (
            <>
              {c.kind === 'group' ? <GroupAvatar c={c} size={28} /> : <ConvAvatar c={c} size={28} />}
              <strong>{c.name}</strong>
            </>
          ) : (
            <button
              className="chat__head-who"
              title={tr('Profile of {name}', { name: c.name })}
              aria-label={tr('Profile of {name}', { name: c.name })}
              onClick={() => setProfileOpen(true)}
            >
              <ConvAvatar c={c} size={28} />
              <strong>{c.name}</strong>
            </button>
          )}
          {c.kind === 'group' ? (
            <button
              className="chip dm-lock"
              onClick={() => setShowMembers(!showMembers)}
              title={tr('Group members')}
            >
              👥 {trn('{count} members', c.members.length)}
            </button>
          ) : c.self ? (
            <span
              className="chip dm-lock"
              title={tr('Your notes are kept on this device and copied to your linked devices')}
            >
              🔒 {tr('Only you')}
            </span>
          ) : (
            <button
              className={`chip dm-lock ${c.verified ? 'is-verified' : ''}`}
              onClick={props.onSafety}
              title={tr('View safety number')}
            >
              {c.verified ? `✓ ${tr('Verified')}` : `🔒 ${tr('Encrypted')}`}
            </button>
          )}
          {!!c.timer && (
            <button
              className="chip dm-timer"
              title={tr('Messages disappear after {time}', { time: timerLabel(c.timer) })}
              onClick={() => setTimerOpen(true)}
            >
              ⏱ {timerLabel(c.timer)}
            </button>
          )}
          <span className="chat__head-actions">
            {c.kind === 'direct' && !c.self && c.state === 'accepted' && !c.awaitingReply && (
              <>
                <button
                  className="icon-btn"
                  aria-label={tr('Start voice call')}
                  title={tr('Start voice call')}
                  disabled={anyCall}
                  onClick={() => void startDmCall(c.riverId, false)}
                >
                  <PhoneIcon size={18} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={tr('Start video call')}
                  title={tr('Start video call')}
                  disabled={anyCall}
                  onClick={() => void startDmCall(c.riverId, true)}
                >
                  <CameraIcon size={18} />
                </button>
              </>
            )}
            {/* Group calls (2.18): call everyone in the group, or join the call going on. */}
            <GroupCallButtons c={c} className="icon-btn" disabled={anyCall} />
            <button
              className={`icon-btn ${searching ? 'is-on' : ''}`}
              aria-label={tr('Search in this conversation')}
              title={tr('Search in this conversation')}
              onClick={() => setSearching(!searching)}
            >
              🔍
            </button>
            <button
              className={`icon-btn ${showPins ? 'is-on' : ''}`}
              aria-label={tr('Pinned messages')}
              title={tr('Pinned messages')}
              onClick={() => setShowPins(!showPins)}
            >
              📌
            </button>
            <button
              className="icon-btn"
              aria-label={tr('Conversation options')}
              title={tr('More')}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ x: r.right - 220, y: r.bottom + 4 });
              }}
            >
              ⋯
            </button>
          </span>
        </header>
      )}
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          {phone && (
            <>
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  setSearching(true);
                }}
              >
                🔍 Search in this conversation
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(null);
                  setShowPins(true);
                }}
              >
                📌 Pinned messages{pinned.length ? ` · ${pinned.length}` : ''}
              </MenuItem>
              {c.kind === 'direct' && !c.self && (
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    setProfileOpen(true);
                  }}
                >
                  Profile
                </MenuItem>
              )}
            </>
          )}
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
                    setIconPicker(menu);
                    setMenu(null);
                  }}
                >
                  Change icon
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
          ) : c.self ? null : (
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
          {c.kind === 'group' || c.self ? null : c.state === 'blocked' ? (
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
          <MenuItem
            onClick={() => {
              setMenu(null);
              setMediaOpen(true);
            }}
          >
            Shared media, files and links
          </MenuItem>
          {(c.kind === 'group' ? c.state !== 'left' : c.state === 'accepted') && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                setPolling(true);
              }}
            >
              📊 Create a poll
            </MenuItem>
          )}
          {(c.kind === 'group' ? c.state !== 'left' : c.state === 'accepted') && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                setTimerOpen(true);
              }}
            >
              Disappearing messages{c.timer ? ` · ${timerLabel(c.timer)}` : ''}
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              setMenu(null);
              setWallpaperOpen(true);
            }}
          >
            🖼️ Wallpaper
          </MenuItem>
          <NotifyMenuSection id={c.riverId} kind="conversation" onDone={() => setMenu(null)} />
        </Popover>
      )}
      {wallpaperOpen && (
        <ChatWallpaperDialog
          chatKey={dmKey(c.riverId)}
          name={c.name}
          onClose={() => setWallpaperOpen(false)}
        />
      )}
      {timerOpen && <TimerDialog conversation={c} onClose={() => setTimerOpen(false)} />}
      {profileOpen && (
        <ContactSheet
          c={c}
          onClose={() => setProfileOpen(false)}
          onSafety={() => {
            setProfileOpen(false);
            props.onSafety();
          }}
          onMedia={() => {
            setProfileOpen(false);
            setMediaOpen(true);
          }}
          onSearch={() => {
            setProfileOpen(false);
            setSearching(true);
          }}
        />
      )}
      {polling && (
        <CreatePollDialog
          onSend={(poll, text) => dm.run({ a: 'send', peer: c.riverId, text, poll })}
          onClose={() => setPolling(false)}
        />
      )}
      {mediaOpen && (
        <GalleryContext.Provider value={gallery}>
          <SharedMedia messages={messages} onClose={() => setMediaOpen(false)} />
        </GalleryContext.Provider>
      )}
      {showPins && (
        <div className="pins dm-pins">
          <header className="pins__head">
            <strong>Pinned messages</strong>
            <button
              className="icon-btn"
              aria-label="Close pinned messages"
              data-phone-back=""
              onClick={() => setShowPins(false)}
            >
              ✕
            </button>
          </header>
          {pinned.length === 0 && (
            <p className="muted small">
              {phone
                ? 'Nothing pinned yet. Long-press a message and choose Pin.'
                : 'Nothing pinned yet. Hover a message and press 📌.'}
            </p>
          )}
          {pinned.map((m) => (
            <button
              key={m.id}
              className="pins__item"
              onClick={() => {
                setShowPins(false);
                const el = document.getElementById(`dm-${m.id}`);
                el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }}
            >
              <span>
                <strong>{m.senderName}</strong>{' '}
                <span className="muted small">{new Date(m.sentAt).toLocaleDateString()}</span>
                <span className="pins__text">{m.text.slice(0, 160) || 'A file'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <DmCallPanel conversation={c} />
      <GroupCallBar conversation={c} />
      <GroupCallInChat conversation={c} />
      {showMembers && c.kind === 'group' && <GroupMembers c={c} onClose={() => setShowMembers(false)} />}
      {iconPicker && (
        <Popover x={iconPicker.x} y={iconPicker.y} onClose={() => setIconPicker(null)}>
          <EmojiPicker
            onPick={(e) => {
              setIconPicker(null);
              if (!e.startsWith('<'))
                void useDm.getState().run({ a: 'setGroupIcon', peer: c.riverId, icon: e });
            }}
          />
        </Popover>
      )}
      {renaming !== null && (
        <Modal title="Rename group" onClose={() => setRenaming(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Stays open, with the name typed, if renaming did not work.
              void dm.attempt({ a: 'renameGroup', peer: c.riverId, name: renaming.trim() }).then((ok) => {
                if (ok) setRenaming(null);
              });
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
            if (await dm.attempt({ a: 'addGroupMembers', peer: c.riverId, members: ids })) setAdding(false);
          }}
        />
      )}
      {c.verifiedChanged && (
        <div className="dm-banner dm-banner--warn" role="alert">
          <span>
            <strong>{c.name}’s safety number changed after you verified it.</strong> River sends them nothing
            until you compare the new safety number and verify again.
          </span>
          <button className="btn btn--ghost btn--small" onClick={props.onSafety}>
            Verify
          </button>
        </div>
      )}
      {c.keyChanged && !c.verifiedChanged && (
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
      <ScheduledBar peer={c.riverId} />
      {searching && <ConversationSearch peer={c.riverId} onClose={() => setSearching(false)} />}
      {selection.peer === c.riverId && (
        <SelectionToolbar conversation={c} messages={messages} myName={myName} />
      )}
      {c.self && (
        <TagFilter
          tags={noteTags}
          value={activeTag}
          onChange={(tag) => setTagFilter(tag === null ? null : { peer: c.riverId, tag })}
        />
      )}
      <GalleryContext.Provider value={gallery}>
        <div
          className="chat__messages"
          {...wallpaper}
          ref={scrollRef}
          onScroll={(e) => {
            const bottom = fromBottom(e.currentTarget) < 80;
            setAtBottom(bottom);
            if (bottom) setLeftAt(null);
            else if (leftAt === null) setLeftAt(messages.at(-1)?.sentAt ?? '');
          }}
        >
          {!loaded &&
            (failed ? (
              <HistoryFailed onRetry={() => useDm.getState().reload(c.riverId)} />
            ) : (
              <ChatSkeleton />
            ))}
          <div className="chat__welcome" hidden={!loaded}>
            <ConvAvatar c={c} size={72} />
            <h2>{c.name}</h2>
            <p className="muted">
              This is the beginning of your conversation with {c.name}. Messages are end-to-end encrypted.
            </p>
          </div>
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const between = callsBetween(calls, prev?.sentAt ?? null, m.sentAt);
            // The day changes after whatever came last: the previous message, or a call after it.
            const before = between.at(-1)?.startedAt ?? prev?.sentAt;
            const newDay = !before || !sameDay(before, m.sentAt);
            const grouped =
              !newDay &&
              between.length === 0 &&
              !m.replyTo &&
              prev !== undefined &&
              prev.sender === m.sender &&
              Date.parse(m.sentAt) - Date.parse(prev.sentAt) < GROUP_MS;
            return (
              <div key={m.id}>
                <CallNotes calls={between} after={prev?.sentAt ?? null} />
                {newDay && (
                  <div className="chat__day">
                    <span>{dayLabel(m.sentAt)}</span>
                  </div>
                )}
                {m.notice ? (
                  <div className="chat__notice" role="note">
                    ⏱ {m.mine ? 'You' : m.senderName}{' '}
                    {m.notice.timer
                      ? `set messages to disappear after ${timerLabel(m.notice.timer)}.`
                      : 'turned off disappearing messages.'}
                  </div>
                ) : (
                  <DmMessage
                    m={m}
                    grouped={grouped}
                    conversation={c}
                    myName={myName}
                    myId={myId}
                    replied={m.replyTo ? messages.find((x) => x.id === m.replyTo) : undefined}
                    last={i === shown.length - 1}
                  />
                )}
              </div>
            );
          })}
          <CallNotes
            calls={callsBetween(calls, messages.at(-1)?.sentAt ?? null, null)}
            after={messages.at(-1)?.sentAt ?? null}
          />
        </div>
      </GalleryContext.Provider>
      {!atBottom && (
        <button
          className="chat__jump-latest"
          aria-label="Jump to the latest message"
          title="Jump to the latest message"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        >
          ↓{(missed || c.unread) > 0 && <span className="chat__jump-count">{missed || c.unread}</span>}
        </button>
      )}
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

/**
 * The conversation's header on a phone (2.12), as in Telegram: Back (with how many unread
 * messages wait in other chats), the name with what is happening (typing, or online when River
 * knows it from a shared community) and the picture, the call buttons and the menu.
 */
function PhoneChatHead(props: {
  c: ConversationView;
  anyCall: boolean;
  onProfile(): void;
  onMenu(rect: DOMRect): void;
}): ReactElement {
  const { c } = props;
  const prefs = useRiver((r) => r.settings?.notifications);
  const waiting = useDm((d) =>
    chatsBadge(
      d.conversations.filter((x) => x.riverId !== c.riverId),
      prefs,
    ),
  );
  useDm((x) => x.typing[c.riverId]);
  const typing = isTyping(c.riverId);
  const online = useCommunity(
    (s) =>
      c.kind === 'direct' &&
      s.communities.some((x) => x.members.some((m) => m.riverId === c.riverId && m.online)),
  );
  const status = typing
    ? c.kind === 'group'
      ? tr('{name} is typing…', { name: typingName(c) })
      : tr('typing…')
    : c.kind === 'group'
      ? trn('{count} members', c.members.length)
      : c.self
        ? tr('Only you · kept on your devices')
        : online
          ? tr('online')
          : c.verified
            ? tr('✓ Verified · end-to-end encrypted')
            : tr('End-to-end encrypted');
  const canCall = c.kind === 'direct' && !c.self && c.state === 'accepted' && !c.awaitingReply;
  return (
    <header className="chat__head pchat-head">
      <button
        className="pchat-head__back"
        aria-label={waiting > 0 ? trn('Back, {count} unread', waiting) : tr('Back')}
        onClick={() => phonePop()}
      >
        <BackIcon size={26} />
        {waiting > 0 && (
          <span className="pchat-head__waiting" aria-hidden="true">
            {waiting > 99 ? '99+' : waiting}
          </span>
        )}
      </button>
      <button
        className="pchat-head__who"
        aria-label={
          c.kind === 'group'
            ? tr('{name}, group members', { name: c.name })
            : tr('Profile of {name}', { name: c.name })
        }
        onClick={props.onProfile}
      >
        {c.kind === 'group' ? <GroupAvatar c={c} size={40} /> : <ConvAvatar c={c} size={40} />}
        <span className="pchat-head__text">
          <strong>
            {c.name}
            {!!c.timer && <span className="pchat-head__timer"> ⏱</span>}
          </strong>
          <span className={`pchat-head__status ${typing || online ? 'is-live' : ''}`}>{status}</span>
        </span>
      </button>
      <span className="pchat-head__actions">
        {canCall && (
          <>
            <button
              className="pchat-head__icon"
              aria-label={tr('Start voice call')}
              disabled={props.anyCall}
              onClick={() => void startDmCall(c.riverId, false)}
            >
              <PhoneCallIcon size={23} />
            </button>
            <button
              className="pchat-head__icon"
              aria-label={tr('Start video call')}
              disabled={props.anyCall}
              onClick={() => void startDmCall(c.riverId, true)}
            >
              <VideoIcon size={25} />
            </button>
          </>
        )}
        <GroupCallButtons c={c} className="pchat-head__icon" disabled={props.anyCall} iconSize={22} />
        <button
          className="pchat-head__icon"
          aria-label={tr('Conversation options')}
          onClick={(e) => props.onMenu(e.currentTarget.getBoundingClientRect())}
        >
          <MoreIcon size={24} />
        </button>
      </span>
    </header>
  );
}

/** Time, "edited", and for your own messages how far they got, inside the bubble (2.12). */
function Stamp({ m }: { m: DirectMessageView }): ReactElement {
  return (
    <span className="msg__stamp">
      {m.pinned && (
        <span className="msg__stamp-flag" role="img" aria-label="Pinned">
          📌
        </span>
      )}
      {m.expiresAt && (
        <span className="msg__stamp-flag" role="img" aria-label="Disappearing message">
          ⏱
        </span>
      )}
      {m.editedAt && <span className="msg__stamp-edited">edited</span>}
      <time dateTime={m.sentAt}>{timeOf(m.sentAt)}</time>
      {m.mine && <Ticks status={m.status} />}
    </span>
  );
}

function Ticks({ status }: { status: DirectMessageView['status'] }): ReactElement | null {
  const label = STATUS_LABEL[status];
  if (!label) return null;
  return (
    <span className={`msg__ticks msg__ticks--${status}`} role="img" aria-label={label}>
      {status === 'sending' ? (
        <ClockIcon size={13} />
      ) : status === 'failed' ? (
        <span aria-hidden="true">!</span>
      ) : status === 'sent' ? (
        <TickIcon size={16} />
      ) : (
        <DoubleTickIcon size={18} />
      )}
    </span>
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

/** A conversation's picture: a group's emoji, else the person's avatar. */
export function ConvAvatar({ c, size }: { c: ConversationView; size: number }): ReactElement {
  if (c.self)
    return (
      <span
        className="group-icon group-icon--self"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        aria-hidden="true"
      >
        🔖
      </span>
    );
  if (c.icon)
    return (
      <span
        className="group-icon"
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        aria-hidden="true"
      >
        {c.icon}
      </span>
    );
  return <Avatar id={c.riverId} name={c.name} avatar={c.avatar} size={size} />;
}

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * Calls between two messages, each under the day it was on: a call today after yesterday's last
 * message gets its own "Today" above it.
 */
function CallNotes({ calls, after }: { calls: CallView[]; after: string | null }): ReactElement {
  return (
    <>
      {calls.map((call, i) => {
        const before = i > 0 ? calls[i - 1]!.startedAt : after;
        return (
          <Fragment key={call.id}>
            {(!before || !sameDay(before, call.startedAt)) && (
              <div className="chat__day">
                <span>{dayLabel(call.startedAt)}</span>
              </div>
            )}
            <CallNote call={call} />
          </Fragment>
        );
      })}
    </>
  );
}

function CallNote({ call }: { call: CallView }): ReactElement {
  return (
    <div className={`call-note ${!call.answered && call.direction === 'in' ? 'is-missed' : ''}`}>
      <span>{callNote(call)}</span>
      <time className="muted small" title={new Date(call.startedAt).toLocaleString()}>
        {timeOf(call.startedAt)}
      </time>
    </div>
  );
}

/** Double-tap a message for this reaction (2.10.1). */
const QUICK_REACTION = '❤️';

/** Scrolls a message into the middle of the conversation and lights it up for a moment. */
function flashMessage(el: HTMLElement): void {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('is-flash');
  window.setTimeout(() => el.classList.remove('is-flash'), 1600);
}

/**
 * Goes to a message in a conversation (search results, replies, the reply bar — 2.19): at once if
 * it is on screen, else after loading the conversation back to it.
 */
export function jumpToDmMessage(peer: string, m: { id: string; sentAt: string }): void {
  const el = document.getElementById(`dm-${m.id}`);
  if (el) return flashMessage(el);
  const whenShown = (tries: number): void => {
    const found = document.getElementById(`dm-${m.id}`);
    if (found) return flashMessage(found);
    if (tries > 0) window.requestAnimationFrame(() => whenShown(tries - 1));
  };
  void useDm
    .getState()
    .loadSince(peer, m.sentAt)
    .then(() => whenShown(20));
}

/** The effect a message was sent with (2.19): a tap plays it again (not with Calm mode or reduced motion). */
function EffectReplay({ effect }: { effect: MessageEffect }): ReactElement | null {
  const label = EFFECT_LABELS[effect];
  if (quiet()) return null;
  return (
    <button
      type="button"
      className="msg__effect"
      aria-label={`Play the ${label.name.toLowerCase()} effect again`}
      title={`Sent with ${label.name.toLowerCase()}`}
      onClick={(e) => {
        e.stopPropagation();
        playEffect(effect);
      }}
    >
      {label.emoji}
    </button>
  );
}

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
  const [forwarding, setForwarding] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [tagging, setTagging] = useState(false);
  const myTags = useMessageTags((s) => (c.self ? s.tags?.[noteTagKey(m.id)] : undefined));
  const selecting = useSelection((s) => s.peer === c.riverId);
  const selected = useSelection((s) => s.peer === c.riverId && s.ids.includes(m.id));
  const name = m.mine ? props.myName : c.kind === 'group' ? m.senderName : c.name;
  const senderAvatar = m.mine
    ? null
    : c.kind === 'group'
      ? (c.members.find((x) => x.riverId === m.sender)?.avatar ?? null)
      : c.avatar;
  const react = (emoji: string, on: boolean): void => {
    if (on) {
      play('reaction');
      haptic('tap');
    }
    void dm.run({ a: 'react', peer: c.riverId, id: m.id, emoji, on });
  };
  const canReply =
    !m.deleted && !editing && (c.kind === 'group' ? c.state !== 'left' : c.state === 'accepted');
  const gestures = useMessageGestures({
    disabled: selecting || editing || m.deleted,
    ...(canReply
      ? {
          onReply: () => {
            useDm.setState({ replyTo: m });
            document.querySelector<HTMLTextAreaElement>('.chat__composer textarea')?.focus();
          },
        }
      : {}),
    onHold: (x, y) => setMenu({ x, y }),
    ...(canReply
      ? {
          onDoubleTap: (x, y) => {
            const heart = m.reactions.find((r) => r.emoji === QUICK_REACTION);
            if (!heart?.mine) burst(QUICK_REACTION, x, y, true);
            react(QUICK_REACTION, !heart?.mine);
          },
        }
      : {}),
  });
  const { onClickCapture: guardClick, ...touch } = gestures;
  // Phones (2.12): Telegram-style bubbles, time and ticks inside, reactions in the hold menu.
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const remove = (forEveryone: boolean): void => {
    useCommunity.getState().setModal({
      kind: 'confirm',
      title: forEveryone ? 'Delete for everyone' : 'Delete for me',
      body: forEveryone
        ? c.kind === 'group'
          ? `This message will be deleted on your devices and for everyone in ${c.name}.`
          : `This message will be deleted on your devices and on ${c.name}'s.`
        : 'This message will be deleted on this device only.',
      action: 'Delete',
      run: async () => {
        await dm.run({ a: 'delete', peer: c.riverId, id: m.id, forEveryone });
      },
    });
  };

  // The message it answers (2.19): who and a one-line preview; a tap goes to it.
  const replied = props.replied;
  const reply = m.replyTo ? (
    replied ? (
      <button
        type="button"
        className="msg__reply"
        title="Show the message this replies to"
        onClick={() => jumpToDmMessage(c.riverId, replied)}
      >
        <ReplyIcon size={13} />
        <strong>{replied.mine ? props.myName : replied.senderName}</strong>
        <span className="msg__reply-text">{replyPreview(replied)}</span>
      </button>
    ) : (
      <div className="msg__reply">
        <ReplyIcon size={13} />
        <span className="muted">Original message not available</span>
      </div>
    )
  ) : null;
  // Only 1–3 emoji (2.19): big, without a bubble.
  const jumbo =
    !m.deleted && !editing && !m.attachments.length && !m.poll && !m.embed ? bigEmojiCount(m.text) : 0;

  return (
    <div
      id={`dm-${m.id}`}
      className={`msg ${props.grouped ? 'msg--grouped' : ''} ${m.mine ? 'msg--mine' : ''} ${editing ? 'is-editing' : ''} ${selected ? 'is-selected' : ''} ${jumbo ? `msg--jumbo msg--jumbo-${jumbo}` : ''}`}
      aria-selected={selecting ? selected : undefined}
      {...touch}
      onClickCapture={(e) => {
        if (guardClick(e)) return;
        // Clicks in a menu or dialog opened from this message are theirs.
        if (fromOverlay(e)) return;
        // While selecting, a tap on a message selects it instead of doing anything else.
        if (!selecting || m.deleted) return;
        e.preventDefault();
        e.stopPropagation();
        useSelection.getState().toggle(m.id);
      }}
      onContextMenu={(e) => {
        if (editing || m.deleted || fromOverlay(e)) return;
        const target = e.target as HTMLElement;
        if (target.closest('a, video, audio, input, textarea')) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {!phone && reply}
      <div className="msg__row">
        <div className="msg__gutter">
          {phone ? (
            c.kind === 'group' &&
            !m.mine && <Avatar id={m.sender} name={name} avatar={senderAvatar} size={34} />
          ) : props.grouped ? (
            <time className="msg__hover-time">{timeOf(m.sentAt)}</time>
          ) : (
            <Avatar id={m.sender} name={name} avatar={senderAvatar} size={38} />
          )}
        </div>
        <div className="msg__body">
          {phone && !props.grouped && c.kind === 'group' && !m.mine && (
            <div className="msg__sender" style={{ color: avatarColor(m.sender) }}>
              {name}
            </div>
          )}
          {phone && reply}
          {!props.grouped && !phone && (
            <div className="msg__meta">
              <strong>{name}</strong>
              <time className="muted small" dateTime={m.sentAt} title={fullWhen(m.sentAt)}>
                {timeOf(m.sentAt)}
              </time>
              {m.pinned && (
                <span className="msg__pinned" title="Pinned" aria-label="Pinned">
                  📌
                </span>
              )}
              {m.expiresAt && (
                <span
                  className="msg__expires"
                  title={`Disappears ${new Date(m.expiresAt).toLocaleString()}`}
                  aria-label="Disappearing message"
                >
                  ⏱
                </span>
              )}
            </div>
          )}
          {editing ? (
            <DmEditBox m={m} />
          ) : m.deleted ? (
            <div className="msg__text muted">
              <em>This message was deleted.</em>
              {phone && <Stamp m={m} />}
            </div>
          ) : (
            <div className={`msg__text ${jumbo ? 'msg__text--jumbo' : ''}`}>
              {m.text && (
                <RichText
                  text={m.text}
                  names={c.kind === 'group' ? c.members.map((x) => x.name) : [c.name, props.myName]}
                  me={props.myName}
                />
              )}
              {m.editedAt && !phone && <span className="msg__edited"> (edited)</span>}
              {m.effect && <EffectReplay effect={m.effect} />}
              {phone && !!m.text && <Stamp m={m} />}
            </div>
          )}
          {c.self && <TagChips tags={myTags} />}
          {!m.deleted && !m.mine && m.text && <InviteCard text={m.text} />}
          {m.embed && <LinkCard embed={m.embed} />}
          {m.poll && (
            <PollCard
              poll={m.poll}
              reactions={m.reactions}
              me={props.myId}
              canVote={canReply}
              onReact={(emoji, on) => void dm.run({ a: 'react', peer: c.riverId, id: m.id, emoji, on })}
            />
          )}
          {m.attachments.length > 0 && <AttachmentList attachments={m.attachments} />}
          {phone && !m.text && !m.deleted && !editing && <Stamp m={m} />}
          {m.reactions.some((r) => !isVote(r.emoji)) && (
            <div className="reactions">
              {m.reactions
                .filter((r) => !isVote(r.emoji))
                .map((r) => (
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
          {m.mine && (props.last || m.status === 'failed') && (!phone || m.status === 'failed') && (
            <div className={`dm-status dm-status--${m.status}`}>{STATUS_LABEL[m.status]}</div>
          )}
        </div>
      </div>
      {!phone && !m.deleted && !editing && c.state === 'accepted' && (
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
            title={tr('Add reaction')}
            onClick={(e) => setPicker(nearButton(e.currentTarget, EMOJI_PICKER))}
          >
            <SmileIcon size={17} />
          </button>
          <button className="msg__action" aria-label="Reply" onClick={() => useDm.setState({ replyTo: m })}>
            <ReplyIcon size={17} />
          </button>
          {!m.deleted && (
            <button
              className="msg__action"
              aria-label={m.pinned ? 'Unpin' : 'Pin'}
              title={m.pinned ? 'Unpin' : 'Pin for everyone in this conversation'}
              onClick={() => void dm.run({ a: 'pin', peer: c.riverId, id: m.id, pinned: !m.pinned })}
            >
              <span aria-hidden="true">📌</span>
            </button>
          )}
          {m.text && (
            <button
              className="msg__action"
              aria-label="Forward"
              title="Forward"
              onClick={() => setForwarding(true)}
            >
              <span aria-hidden="true">↪</span>
            </button>
          )}
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
      {forwarding && (
        <ForwardDialog text={m.text} from={{ name, channel: '' }} onClose={() => setForwarding(false)} />
      )}
      {tagging && <TagDialog tagKey={noteTagKey(m.id)} onClose={() => setTagging(false)} />}
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="menu">
          {phone && canReply && (
            <div className="menu__reactions" role="group" aria-label="React">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  role="menuitem"
                  className={`menu__reaction ${m.reactions.some((r) => r.emoji === e && r.mine) ? 'is-mine' : ''}`}
                  aria-label={`React ${e}`}
                  onClick={() => {
                    setMenu(null);
                    react(e, !m.reactions.find((r) => r.emoji === e)?.mine);
                  }}
                >
                  {e}
                </button>
              ))}
              <button
                role="menuitem"
                className="menu__reaction menu__reaction--more"
                aria-label="More reactions"
                onClick={() => {
                  setPicker({ x: 8, y: Math.max(8, menu.y - 160) });
                  setMenu(null);
                }}
              >
                <SmileIcon size={18} />
              </button>
            </div>
          )}
          {c.state === 'accepted' && (
            <MenuItem
              icon={<ReplyIcon size={15} />}
              onClick={() => {
                setMenu(null);
                useDm.setState({ replyTo: m });
              }}
            >
              Reply
            </MenuItem>
          )}
          {m.text && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                copyText(m.text);
              }}
            >
              Copy text
            </MenuItem>
          )}
          {m.text && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                setForwarding(true);
              }}
            >
              Forward
            </MenuItem>
          )}
          {c.self && (
            <MenuItem
              icon={<span aria-hidden="true">#</span>}
              onClick={() => {
                setMenu(null);
                setTagging(true);
              }}
            >
              {myTags?.length ? 'Edit tags…' : 'Add tags…'}
            </MenuItem>
          )}
          {c.kind === 'group' && !m.mine && !m.deleted && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                void replyPrivately(m, c.name);
              }}
            >
              Reply privately
            </MenuItem>
          )}
          {c.state === 'accepted' && (
            <MenuItem
              onClick={() => {
                setMenu(null);
                void dm.run({ a: 'pin', peer: c.riverId, id: m.id, pinned: !m.pinned });
              }}
            >
              {m.pinned ? 'Unpin' : 'Pin'}
            </MenuItem>
          )}
          {m.mine && c.state === 'accepted' && (
            <MenuItem
              icon={<EditIcon size={15} />}
              onClick={() => {
                setMenu(null);
                useDm.setState({ editing: m.id });
              }}
            >
              Edit
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              setMenu(null);
              useSelection.getState().start(c.riverId, m.id);
            }}
          >
            Select
          </MenuItem>
          <MenuItem
            danger
            icon={<TrashIcon size={15} />}
            onClick={() => {
              setMenu(null);
              remove(false);
            }}
          >
            Delete for me
          </MenuItem>
          {m.mine && (
            <MenuItem
              danger
              icon={<TrashIcon size={15} />}
              onClick={() => {
                setMenu(null);
                remove(true);
              }}
            >
              Delete for everyone
            </MenuItem>
          )}
        </Popover>
      )}
    </div>
  );
}

type MediaTab = 'photos' | 'videos' | 'files' | 'voice' | 'links';
const LINK_RE = /https?:\/\/[^\s<>"')]+/g;

/** Everything shared in this conversation, by kind (2.7), from the messages loaded here. */
function SharedMedia(props: { messages: DirectMessageView[]; onClose(): void }): ReactElement {
  const [tab, setTab] = useState<MediaTab>('photos');
  const live = props.messages.filter((m) => !m.deleted);
  const all = live.flatMap((m) => m.attachments.map((a) => ({ a, m })));
  const photos = all.filter(({ a }) => a.mime.startsWith('image/'));
  const videos = all.filter(({ a }) => a.mime.startsWith('video/'));
  const voice = all.filter(({ a }) => a.mime.startsWith('audio/'));
  const files = all.filter(({ a }) => !/^(image|video|audio)\//.test(a.mime));
  const links = live.flatMap((m) => (m.text.match(LINK_RE) ?? []).map((url) => ({ url, m })));
  const tabs: Array<[MediaTab, string, number]> = [
    ['photos', 'Photos', photos.length],
    ['videos', 'Videos', videos.length],
    ['files', 'Files', files.length],
    ['voice', 'Voice', voice.length],
    ['links', 'Links', links.length],
  ];
  const list = { photos, videos, files, voice }[tab as 'photos'] ?? [];
  return (
    <Modal title="Shared in this conversation" onClose={props.onClose} wide>
      <div className="shared-media__tabs" role="radiogroup" aria-label="Show">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            role="radio"
            aria-checked={tab === id}
            className={`chip ${tab === id ? 'is-on' : ''}`}
            onClick={() => setTab(id)}
          >
            {label} · {n}
          </button>
        ))}
      </div>
      {tab === 'links' ? (
        links.length ? (
          <ul className="shared-media__list">
            {[...links].reverse().map(({ url, m }, i) => (
              <li key={`${m.id}-${i}`}>
                <button
                  className="btn btn--link shared-media__link"
                  onClick={() => void window.river.links.openUrl(url)}
                >
                  {url}
                </button>
                <span className="muted small"> · {shortWhen(m.sentAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No links yet.</p>
        )
      ) : list.length ? (
        <div className={tab === 'photos' ? 'shared-media__grid' : 'shared-media__list'}>
          {[...list].reverse().map(({ a }) => (
            <AttachmentList key={a.id} attachments={[a]} />
          ))}
        </div>
      ) : (
        <p className="muted small">Nothing here yet.</p>
      )}
      <p className="muted small">From the latest messages kept on this device.</p>
    </Modal>
  );
}

/** Pick when to send (2.5). */
function ScheduleDialog(props: {
  onClose(): void;
  onSchedule(sendAt: string, silent: boolean): void;
}): ReactElement {
  const local = (d: Date): string => {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  // The time the dialog opened; choices are relative to it (the core checks again on schedule).
  const [opened] = useState(() => Date.now());
  const [when, setWhen] = useState(() => local(new Date(opened + 3600_000)));
  const [silent, setSilent] = useState(false);
  const at = new Date(when);
  const valid = !Number.isNaN(at.getTime()) && at.getTime() > opened + 30_000;
  const quick = (label: string, d: Date) => (
    <button key={label} type="button" className="chip" onClick={() => setWhen(local(d))}>
      {label}
    </button>
  );
  const tomorrow9 = new Date(opened);
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  return (
    <Modal title="Schedule message" onClose={props.onClose}>
      <div className="schedule-quick">
        {quick('In 1 hour', new Date(opened + 3600_000))}
        {quick('In 3 hours', new Date(opened + 3 * 3600_000))}
        {quick('Tomorrow 9:00', tomorrow9)}
      </div>
      <label className="textfield">
        <span className="field__label">Send at</span>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <Toggle checked={silent} onChange={setSilent} label="Send without sound" />
      <p className="muted small">
        River keeps the message encrypted on this device and sends it at that time — this device has to be on
        and online then. River's server never holds it.
      </p>
      <div className="button-row">
        <button className="btn btn--ghost" onClick={props.onClose}>
          Cancel
        </button>
        <button
          className="btn btn--primary"
          disabled={!valid}
          onClick={() => props.onSchedule(at.toISOString(), silent)}
        >
          Schedule
        </button>
      </div>
    </Modal>
  );
}

/** Messages waiting on this device to be sent later in this conversation (2.5). */
function ScheduledBar(props: { peer: string }): ReactElement | null {
  const [items, setItems] = useState<ScheduledView[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = (): void =>
      void window.river.dm.action({ a: 'scheduled', peer: props.peer }).then((r) => {
        if (r.ok) setItems(r.value);
      });
    load();
    return window.river.dm.onEvent((e) => {
      if (e.t === 'scheduled') load();
    });
  }, [props.peer]);
  if (!items.length) return null;
  return (
    <>
      <button className="scheduled-bar" onClick={() => setOpen(true)}>
        🕓 {items.length} scheduled {items.length === 1 ? 'message' : 'messages'} · next{' '}
        {new Date(items[0]!.sendAt).toLocaleString()}
      </button>
      {open && (
        <Modal title="Scheduled messages" onClose={() => setOpen(false)}>
          <ul className="scheduled-list">
            {items.map((x) => (
              <li key={x.id} className="scheduled-item">
                <span className="scheduled-item__text">
                  <strong>{new Date(x.sendAt).toLocaleString()}</strong>
                  {x.silent && <span className="muted small"> · without sound</span>}
                  {x.failed && (
                    <span className="field__error small"> · not sent yet (offline), trying again</span>
                  )}
                  <span className="muted small">{x.text || x.attachments.map((a) => a.name).join(', ')}</span>
                </span>
                <span className="button-row">
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => void window.river.dm.action({ a: 'sendScheduledNow', id: x.id })}
                  >
                    Send now
                  </button>
                  <button
                    className="btn btn--danger btn--small"
                    onClick={() => void window.river.dm.action({ a: 'cancelScheduled', id: x.id })}
                  >
                    Cancel
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}

/** Choose how long new messages in this conversation stay (2.4). */
function TimerDialog(props: { conversation: ConversationView; onClose(): void }): ReactElement {
  const c = props.conversation;
  const [busy, setBusy] = useState(false);
  const set = async (seconds: number): Promise<void> => {
    setBusy(true);
    const r = await window.river.dm.action({ a: 'setTimer', peer: c.riverId, seconds });
    setBusy(false);
    if (!r.ok) useCommunity.getState().notify(r.message, 'error');
    else props.onClose();
  };
  return (
    <Modal title="Disappearing messages" onClose={props.onClose}>
      <p className="muted small">
        New messages in this conversation are deleted from every device in it after the time you choose — for
        everyone in the conversation. They can still be copied or photographed before they disappear. Both of
        you need River 2.4 or newer.
      </p>
      <div className="timer-choices" role="radiogroup" aria-label="Delete messages after">
        {TIMER_CHOICES.map((seconds) => (
          <button
            key={seconds}
            role="radio"
            aria-checked={(c.timer ?? 0) === seconds}
            disabled={busy}
            className={`timer-choice ${(c.timer ?? 0) === seconds ? 'is-active' : ''}`}
            onClick={() => void set(seconds)}
          >
            {timerLabel(seconds)}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** The bar shown while messages are selected: copy, forward, delete, done (2.2). */
function SelectionToolbar(props: {
  conversation: ConversationView;
  messages: DirectMessageView[];
  myName: string;
}): ReactElement {
  const ids = useSelection((s) => s.ids);
  const [forwarding, setForwarding] = useState(false);
  const chosen = props.messages.filter((m) => ids.includes(m.id) && !m.deleted);
  const text = chosen
    .filter((m) => m.text)
    .map((m) => `${m.mine ? props.myName : m.senderName}: ${m.text}`)
    .join('\n');
  const c = props.conversation;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected messages">
      <strong>{ids.length} selected</strong>
      <span className="selection-bar__actions">
        <button className="btn btn--ghost btn--small" disabled={!text} onClick={() => copyText(text)}>
          Copy
        </button>
        <button className="btn btn--ghost btn--small" disabled={!text} onClick={() => setForwarding(true)}>
          Forward
        </button>
        <button
          className="btn btn--danger btn--small"
          onClick={() =>
            useCommunity.getState().setModal({
              kind: 'confirm',
              title: `Delete ${chosen.length} ${chosen.length === 1 ? 'message' : 'messages'} for me`,
              body: 'They are deleted on this device only.',
              action: 'Delete',
              run: async () => {
                for (const m of chosen) {
                  await window.river.dm.action({
                    a: 'delete',
                    peer: c.riverId,
                    id: m.id,
                    forEveryone: false,
                  });
                }
                useSelection.getState().clear();
              },
            })
          }
        >
          Delete
        </button>
        <button
          className="btn btn--primary btn--small"
          data-phone-back=""
          onClick={() => useSelection.getState().clear()}
        >
          Done
        </button>
      </span>
      {forwarding && (
        <ForwardDialog
          text={text}
          from={{ name: c.name, channel: '' }}
          onClose={() => setForwarding(false)}
        />
      )}
    </div>
  );
}

/** Search inside one conversation; a result jumps to its message (2.2). */
function ConversationSearch(props: { peer: string; onClose(): void }): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectMessageView[]>([]);
  const shown = query.trim().length >= 2 ? results : [];
  // Answers can come back out of order: only the one for what is in the box now counts.
  const asked = useRef('');
  useEffect(() => {
    const q = query.trim();
    asked.current = q;
    if (q.length < 2) return;
    const t = window.setTimeout(() => {
      void window.river.dm.action({ a: 'search', query: q, peer: props.peer }).then((r) => {
        if (r.ok && asked.current === q) setResults(r.value);
      });
    }, 200);
    return () => window.clearTimeout(t);
  }, [query, props.peer]);
  const [date, setDate] = useState('');
  /** Waits (briefly) for a message to be on screen after loading older ones. */
  const whenShown = (id: string, tries = 20): void => {
    const el = document.getElementById(`dm-${id}`);
    if (el) return flashMessage(el);
    if (tries > 0) window.requestAnimationFrame(() => whenShown(id, tries - 1));
  };
  // Older than what is shown: loaded back to it first (2.10.7).
  const jump = (m: DirectMessageView): void => jumpToDmMessage(props.peer, m);
  /** Jump to the first message on or after a day (2.10.7). */
  const jumpToDate = async (day: string): Promise<void> => {
    const start = new Date(`${day}T00:00:00`);
    if (Number.isNaN(start.getTime())) return;
    await useDm.getState().loadSince(props.peer, start.toISOString());
    const first = (useDm.getState().messages[props.peer] ?? []).find(
      (m) => Date.parse(m.sentAt) >= start.getTime() && !m.notice,
    );
    if (!first) {
      useCommunity.getState().notify('No messages from that day on.');
      return;
    }
    whenShown(first.id);
  };
  return (
    <div className="conv-search">
      <input
        className="search"
        autoFocus
        placeholder="Search in this conversation"
        aria-label="Search in this conversation"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose();
          if (e.key === 'Enter' && shown[0]) jump(shown[0]);
        }}
      />
      <input
        type="date"
        className="conv-search__date"
        aria-label="Jump to a date"
        title="Jump to a date"
        value={date}
        max={localDay(new Date())}
        onChange={(e) => {
          setDate(e.target.value);
          if (e.target.value) void jumpToDate(e.target.value);
        }}
      />
      <button className="icon-btn" aria-label="Close search" data-phone-back="" onClick={props.onClose}>
        <XIcon size={16} />
      </button>
      {query.trim().length >= 2 && (
        <ul className="conv-search__results">
          {shown.length === 0 && <li className="muted small">No messages found.</li>}
          {shown.map((m) => (
            <li key={m.id}>
              <button className="conv-search__result" onClick={() => jump(m)}>
                <span className="muted small">{shortWhen(m.sentAt)}</span>
                <span className="conv-search__text">
                  <Highlight text={m.text} query={query} max={140} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DmEditBox({ m }: { m: DirectMessageView }): ReactElement {
  const [text, setText] = useState(m.text);
  const phone = useRiver((r) => isPhone(r.info?.platform));
  const ref = useRef<HTMLTextAreaElement>(null);
  useGrowToFit(ref, text, phone);
  const close = (): void => stopEditing(() => useDm.setState({ editing: null }));
  const save = async (): Promise<void> => {
    const value = text.trim();
    if (!value) return;
    // Not saved (offline, refused): keep editing, with the text as typed (as in channels).
    if (
      value !== m.text &&
      !(await useDm.getState().attempt({ a: 'edit', peer: m.peer, id: m.id, text: value }))
    )
      return;
    close();
  };
  return (
    <div className="msg__edit">
      <textarea
        ref={ref}
        autoFocus
        value={text}
        maxLength={4000}
        rows={Math.min(8, text.split('\n').length)}
        aria-label="Edit message"
        onChange={(e) => setText(e.target.value)}
        // The caret at the end of the message, not before its first letter.
        onFocus={(e) => e.currentTarget.setSelectionRange(text.length, text.length)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
          // On a phone Enter is a new line, as in the message box: Save saves.
          if (enterSends(e, phone)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {phone ? (
        <EditActions onCancel={close} onSave={() => void save()} />
      ) : (
        <span className="muted small">escape to cancel • enter to save</span>
      )}
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
  const [text, setText] = useDraft(`d:${c.riverId}`);
  useSharedText(`d:${c.riverId}`, (shared) =>
    setText((t) =>
      t
        ? `${t}
${shared}`
        : shared,
    ),
  );
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const lastTyping = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useDm((x) => x.typing[c.riverId]);
  const replyTo = dm.replyTo && dm.replyTo.peer === c.riverId ? dm.replyTo : null;

  const [later, setLater] = useState<{ x: number; y: number } | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const phone = useRiver((r) => isPhone(r.info?.platform));
  // Saved replies (2.19): "/" and a shortcut, or the button.
  const replies = useSavedReplyList();
  const [repliesMenu, setRepliesMenu] = useState<{ x: number; y: number } | null>(null);
  const [hushed, setHushed] = useState<string | null>(null);
  const [replyIndex, setReplyIndex] = useState(0);
  const replyQuery = hushed === text ? null : savedReplyQuery(text);
  const replyChoices = replyQuery === null ? [] : matchReplies(replies, replyQuery);
  const activeReply = Math.min(replyIndex, Math.max(0, replyChoices.length - 1));
  const pickReply = (r: { text: string }): void => {
    setText(r.text);
    setReplyIndex(0);
    ref.current?.focus();
  };
  // Whether the box is still there, for when a send fails later.
  useGrowToFit(ref, text, phone);
  const draftKey = `d:${c.riverId}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /**
   * A send that did not work gives its text back without losing anything typed since: into the
   * box if it is empty, after what is there otherwise, or into the draft if the chat was closed.
   * The reply it answered comes back too.
   */
  const restore = (value: string, reply: DirectMessageView | null): void => {
    if (reply && mounted.current && !useDm.getState().replyTo) useDm.setState({ replyTo: reply });
    if (!value) return;
    if (!mounted.current) {
      const now = readDraft(draftKey);
      saveDraft(draftKey, now ? `${value}\n${now}` : value);
      return;
    }
    setText((now) => (now.trim() ? `${value}\n${now}` : value));
  };
  const send = async (
    options: { silent?: boolean; sendAt?: string; effect?: MessageEffect } = {},
  ): Promise<void> => {
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
    if (options.sendAt) {
      const queued = await dm.run({
        a: 'schedule',
        peer: c.riverId,
        text: value,
        ...(replyTo ? { replyTo: replyTo.id } : {}),
        ...(attachments ? { attachments } : {}),
        ...(options.silent ? { silent: true } : {}),
        sendAt: options.sendAt,
      });
      setUploading(null);
      if (!queued) restore(value, replyTo);
      else {
        props.onPending([]);
        useCommunity.getState().notify(`Scheduled for ${new Date(options.sendAt).toLocaleString()}`);
      }
      return;
    }
    // A link preview, only if you turned them on (made here, sealed in the message), within a moment.
    const link = useRiver.getState().settings?.appearance.linkPreviews ? firstLink(value) : null;
    const embed = link
      ? await Promise.race([
          window.river.links.preview(link).catch(() => null),
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000)),
        ])
      : null;
    const sent = await dm.run({
      a: 'send',
      peer: c.riverId,
      text: value,
      ...(replyTo ? { replyTo: replyTo.id } : {}),
      ...(attachments ? { attachments } : {}),
      ...(options.silent ? { silent: true } : {}),
      ...(embed ? { embed } : {}),
      ...(options.effect ? { effect: options.effect } : {}),
    });
    setUploading(null);
    if (!sent) restore(value, replyTo);
    else {
      play('send');
      props.onPending([]);
      dm.handle({ t: 'message', message: sent, isNew: false, senderName: '' });
      // You see your own effect as it goes (2.19).
      if (options.effect) {
        markEffectSeen([sent.id]);
        playEffect(options.effect);
      }
    }
  };

  // A recorded voice message is sent at once, encrypted like any file (2.3).
  const sendVoice = async (file: File): Promise<void> => {
    if (uploading) return;
    const files = pendingFrom([file]);
    setUploading({ done: 0, total: 1 });
    let attachments;
    try {
      attachments = await uploadAll(files, (done) => setUploading({ done, total: 1 }), 'dm');
    } catch (err) {
      setUploading(null);
      useCommunity.getState().notify((err as Error).message || 'Upload failed.', 'error');
      return;
    }
    useDm.setState({ replyTo: null });
    const sent = await dm.run({
      a: 'send',
      peer: c.riverId,
      text: '',
      ...(replyTo ? { replyTo: replyTo.id } : {}),
      attachments,
    });
    setUploading(null);
    if (sent) {
      play('send');
      dm.handle({ t: 'message', message: sent, isNew: false, senderName: '' });
    } else restore('', replyTo);
  };

  return (
    <div className="chat__composer-wrap">
      {later && (
        <Popover x={later.x} y={later.y} onClose={() => setLater(null)} className="menu">
          <MenuItem
            onClick={() => {
              setLater(null);
              void send({ silent: true });
            }}
          >
            🔕 Send without sound
          </MenuItem>
          <MenuItem
            onClick={() => {
              setLater(null);
              setScheduling(true);
            }}
          >
            🕓 Schedule message…
          </MenuItem>
          {MESSAGE_EFFECTS.map((effect) => (
            <MenuItem
              key={effect}
              onClick={() => {
                setLater(null);
                void send({ effect });
              }}
            >
              {EFFECT_LABELS[effect].emoji} Send with {EFFECT_LABELS[effect].name.toLowerCase()}
            </MenuItem>
          ))}
        </Popover>
      )}
      {repliesMenu && (
        <SavedRepliesMenu
          x={repliesMenu.x}
          y={repliesMenu.y}
          onClose={() => setRepliesMenu(null)}
          onPick={(r) => {
            setRepliesMenu(null);
            pickReply(r);
          }}
        />
      )}
      {replyChoices.length > 0 && (
        <SavedReplySuggestions choices={replyChoices} active={activeReply} onPick={pickReply} />
      )}
      {scheduling && (
        <ScheduleDialog
          onClose={() => setScheduling(false)}
          onSchedule={(sendAt, silent) => {
            setScheduling(false);
            void send({ sendAt, silent });
          }}
        />
      )}
      {replyTo && (
        <div className="reply-bar">
          {/* Who and what you are answering (2.19); a tap shows that message. */}
          <button
            type="button"
            className="reply-bar__jump"
            title="Show the message"
            onClick={() => jumpToDmMessage(c.riverId, replyTo)}
          >
            <span>
              Replying to <strong>{replyTo.mine ? 'yourself' : replyTo.senderName || c.name}</strong>
            </span>
            <span className="reply-bar__preview">{replyPreview(replyTo)}</span>
          </button>
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
          aria-label={tr('Attach files')}
          title={tr('Attach files')}
          onClick={() => fileRef.current?.click()}
        >
          {phone ? <ClipIcon size={24} /> : <PlusIcon size={20} />}
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
          placeholder={phone ? tr('Message') : tr('Message {name}', { name: c.name })}
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
            // Choosing a saved reply: arrows move, Enter or Tab picks, Escape closes the list.
            if (replyChoices.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const d = e.key === 'ArrowDown' ? 1 : -1;
                setReplyIndex((activeReply + d + replyChoices.length) % replyChoices.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pickReply(replyChoices[activeReply]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setHushed(text);
                return;
              }
            }
            if (e.key === 'Escape' && replyTo) useDm.setState({ replyTo: null });
            if (e.key === 'ArrowUp' && text === '') {
              // Your last message with text to edit (not a timer notice, a file or a voice message).
              const mine = [...(dm.messages[c.riverId] ?? [])]
                .reverse()
                .find((m) => m.mine && !m.deleted && !m.notice && m.text);
              if (mine) {
                e.preventDefault();
                useDm.setState({ editing: mine.id });
              }
            }
            if (enterSends(e, phone)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Emoji"
          title={phone ? undefined : 'Emoji'}
          onClick={(e) =>
            setPicker(
              phone
                ? // Above the message box (a tap's own position is 0 when it came from a keyboard).
                  { x: 8, y: e.currentTarget.getBoundingClientRect().top - EMOJI_PICKER.height - 8 }
                : nearButton(e.currentTarget, EMOJI_PICKER),
            )
          }
        >
          {phone ? <EmojiIcon size={24} /> : <SmileIcon size={20} />}
        </button>
        {!text.trim() && props.pending.length === 0 && (
          <button
            type="button"
            className="icon-btn composer__replies"
            aria-label="Saved replies"
            title={phone ? undefined : 'Saved replies (or type /)'}
            onClick={(e) => setRepliesMenu(nearButton(e.currentTarget, { width: 340, height: 360 }))}
          >
            {/* On a phone a line icon like its neighbours (an emoji there looked greyed out). */}
            {phone ? <SavedRepliesIcon size={24} /> : <span aria-hidden="true">💬</span>}
          </button>
        )}
        {!text.trim() && props.pending.length === 0 && (
          <MyStickersButton disabled={!!uploading} phone={phone} onPick={(file) => void sendVoice(file)} />
        )}
        {/* Always there, so typing (or a shared file arriving) never ends a recording. */}
        <VoiceRecorder
          disabled={!!uploading}
          idleHidden={!!text.trim() || props.pending.length > 0}
          onRecorded={(file) => void sendVoice(file)}
        />
        {!phone && (!!text.trim() || props.pending.length > 0) && (
          <button
            type="button"
            className="icon-btn"
            aria-label="More ways to send"
            title="Send later, without sound or with an effect"
            onClick={(e) => setLater({ x: e.clientX - 200, y: e.clientY - 110 })}
          >
            ⏰
          </button>
        )}
        {phone ? (
          // The microphone turns into Send once there is something to send; hold Send to send
          // later or without sound.
          (!!text.trim() || props.pending.length > 0) && (
            <button
              className="composer__send"
              aria-label="Send"
              disabled={!!uploading}
              onContextMenu={(e) => {
                e.preventDefault();
                setLater({ x: e.clientX - 200, y: e.clientY - 110 });
              }}
            >
              <SendIcon size={22} />
            </button>
          )
        ) : (
          <button
            className="btn btn--primary"
            disabled={(!text.trim() && !props.pending.length) || !!uploading}
          >
            Send
          </button>
        )}
      </form>
      <div className="typing" aria-live="polite">
        {isTyping(c.riverId) && (
          <>
            <span className="typing__dots">
              <i />
              <i />
              <i />
            </span>
            <span>{typingText([typingName(c)])}</span>
          </>
        )}
      </div>
      {picker && (
        <Popover x={picker.x} y={picker.y} onClose={() => setPicker(null)}>
          <EmojiPicker
            onPick={(e) => {
              // At the caret, not always at the end (2.13.1).
              insertIntoBox(ref.current, text, e, setText);
              setPicker(null);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

export function NewMessage({ onClose }: { onClose(): void }): ReactElement {
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

export function SafetyNumber({ peer, onClose }: { peer: string; onClose(): void }): ReactElement {
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
              // Shows verified only once River has recorded it.
              // River marks only the key behind the number shown here.
              void dm.attempt({ a: 'setVerified', peer, verified: v, digits: data.digits }).then((ok) => {
                if (ok) setData({ ...data, verified: v });
              });
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

export function GroupAvatar({ c, size }: { c: ConversationView; size: number }): ReactElement {
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
        <button className="icon-btn" aria-label="Close members" data-phone-back="" onClick={onClose}>
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

/** An invite someone sent you: one click joins (you are asked nothing else). */
function InviteCard({ text }: { text: string }): ReactElement | null {
  const link = findInvite(text);
  const [state, setState] = useState<'idle' | 'joining' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (!link) return null;
  return (
    <div className="invite-card">
      <span>🏠 Invitation to a River community</span>
      <button
        className="btn btn--primary btn--small"
        disabled={state === 'joining'}
        onClick={() => {
          setState('joining');
          void joinWithLink(link).then((failed) => {
            setState(failed ? 'error' : 'idle');
            setError(failed);
          });
        }}
      >
        {state === 'joining' ? 'Joining…' : 'Join community'}
      </button>
      {error && (
        <span className="small" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
