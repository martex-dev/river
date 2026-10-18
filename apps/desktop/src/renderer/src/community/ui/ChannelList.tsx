import { tr } from '../../i18n.ts';
import { useState, type DragEvent, type ReactElement } from 'react';
import { Permission } from '@river/protocol/permissions';
import type { CategoryView, ChannelView, CommunityView } from '../../../../shared/ipc.ts';
import {
  layoutChanges,
  moveCategory,
  moveChannel,
  sidebarGroups,
  type ChannelGroup,
} from '../../../../shared/layout.ts';
import { useCommunity } from '../store.ts';
import { ChevronIcon, GearIcon, MenuItem, PlusIcon, Popover, can } from './common.tsx';
import { ChannelRow } from './Sidebar.tsx';
import { NotifyMenuSection } from './NotifyMenu.tsx';

type Groups = Array<ChannelGroup<ChannelView, CategoryView>>;
type Target = { type: 'channel' | 'category' | 'loose'; id: string; after: boolean };

const COLLAPSED_KEY = 'river.collapsedCategories';

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveCollapsed(value: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(value));
  } catch {
    // remembering collapsed categories is a convenience only
  }
}

/**
 * Shows `next` in the sidebar straight away (no snap back while the server answers) and returns
 * how to undo it. The server's updated list replaces it when it arrives.
 */
export function showLayout(communityId: string, next: Groups): () => void {
  const before = useCommunity.getState().communities.find((c) => c.id === communityId);
  if (!before) return () => undefined;
  const change = layoutChanges(next);
  const channels = new Map(change.channels.map((c) => [c.id, c]));
  const categories = new Map(change.categories.map((k) => [k.id, k.position]));
  const shown: CommunityView = {
    ...before,
    channels: before.channels.map((ch) => {
      const c = channels.get(ch.id);
      return c ? { ...ch, position: c.position, parentId: c.parentId } : ch;
    }),
    categories: before.categories.map((k) =>
      categories.has(k.id) ? { ...k, position: categories.get(k.id)! } : k,
    ),
  };
  const swap = (from: CommunityView, to: CommunityView): void =>
    useCommunity.setState({
      communities: useCommunity.getState().communities.map((c) => (c === from ? to : c)),
    });
  swap(before, shown);
  // Only if nothing newer came in meanwhile.
  return () => swap(shown, before);
}

/**
 * Applies a drag and drop: shown at once, then sent as one relative move ("after this one, in
 * that category"), which the server places among all channels, also those you cannot see.
 */
export async function applyLayout(
  community: CommunityView,
  next: Groups,
  moved: { kind: 'channel' | 'category'; id: string },
): Promise<void> {
  const change = layoutChanges(next);
  if (change.categories.length === 0 && change.channels.length === 0) return;
  let parentId: string | null = null;
  let afterId: string | null;
  if (moved.kind === 'channel') {
    const g = next.find((x) => x.channels.some((c) => c.id === moved.id));
    if (!g) return;
    const i = g.channels.findIndex((c) => c.id === moved.id);
    parentId = g.category?.id ?? null;
    afterId = i > 0 ? g.channels[i - 1]!.id : null;
  } else {
    const cats = next.flatMap((g) => (g.category ? [g.category.id] : []));
    const i = cats.indexOf(moved.id);
    afterId = i > 0 ? cats[i - 1]! : null;
  }
  const undo = showLayout(community.id, next);
  const res = await window.river.community.action({
    a: 'layoutMove',
    communityId: community.id,
    kind: moved.kind,
    id: moved.id,
    parentId,
    afterId,
  });
  if (!res.ok) {
    undo();
    useCommunity.getState().notify(res.message, 'error');
  }
}

/** Puts a channel at the end of a category (or of the uncategorised channels). */
export function moveToCategory(community: CommunityView, channelId: string, parentId: string | null): void {
  const groups = sidebarGroups(community.channels, community.categories);
  const target = groups.find((g) => (g.category?.id ?? null) === parentId);
  void applyLayout(community, moveChannel(groups, channelId, parentId, target?.channels.length ?? 0), {
    kind: 'channel',
    id: channelId,
  });
}

/**
 * The channel list: uncategorised channels, then categories you can collapse.
 * People who may manage channels can drag channels and categories to reorder
 * them; the whole move is one request to the server.
 */
export function ChannelList(props: { community: CommunityView; me: string }): ReactElement {
  const { community, me } = props;
  const s = useCommunity();
  const manage = can(community.permissions, Permission.MANAGE_CHANNELS);
  const [drag, setDrag] = useState<{ type: 'channel' | 'category'; id: string } | null>(null);
  const [over, setOver] = useState<Target | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  /** Right-click menu on a category (1.0.35). */
  const [catMenu, setCatMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const groups = sidebarGroups(community.channels, community.categories);
  const hasCategories = community.categories.length > 0;

  const toggle = (id: string): void => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    saveCollapsed(next);
  };

  const reset = (): void => {
    setDrag(null);
    setOver(null);
  };

  const drop = (target: Target): void => {
    const d = drag;
    reset();
    if (!d) return;
    let next: Groups;
    if (d.type === 'channel') {
      if (target.type === 'category') next = moveChannel(groups, d.id, target.id, 0);
      else if (target.type === 'loose') next = moveChannel(groups, d.id, null, groups[0]!.channels.length);
      else {
        if (target.id === d.id) return;
        const g = groups.find((x) => x.channels.some((c) => c.id === target.id));
        if (!g) return;
        const rest = g.channels.filter((c) => c.id !== d.id);
        const at = rest.findIndex((c) => c.id === target.id) + (target.after ? 1 : 0);
        next = moveChannel(groups, d.id, g.category?.id ?? null, at);
      }
    } else {
      if (target.type !== 'category' || target.id === d.id) return;
      const others = groups
        .slice(1)
        .map((g) => g.category!.id)
        .filter((id) => id !== d.id);
      next = moveCategory(groups, d.id, others.indexOf(target.id) + (target.after ? 1 : 0));
    }
    void applyLayout(community, next, { kind: d.type, id: d.id });
  };

  /** Drag-and-drop handlers for one row or header. */
  const dnd = (type: Target['type'], id: string, dragType?: 'channel' | 'category') => ({
    draggable: manage && !!dragType,
    onDragStart: (e: DragEvent) => {
      if (!dragType) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDrag({ type: dragType, id });
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!drag) return;
      // Categories only land between categories.
      if (drag.type === 'category' && type !== 'category') return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      if (over?.type !== type || over.id !== id || over.after !== after) setOver({ type, id, after });
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (over) drop(over);
    },
  });
  const marker = (type: Target['type'], id: string): string => {
    if (!over || over.type !== type || over.id !== id || !drag || drag.id === id) return '';
    if (type === 'category' && drag.type === 'channel') return 'is-drop-into';
    return over.after ? 'is-drop-after' : 'is-drop-before';
  };

  const row = (ch: ChannelView): ReactElement => (
    <ChannelRow
      key={ch.id}
      community={community}
      channel={ch}
      me={me}
      dragging={drag?.id === ch.id}
      dropClass={marker('channel', ch.id)}
      dnd={dnd('channel', ch.id, 'channel')}
    />
  );

  return (
    <div className="community__channel-scroll" onDragEnd={reset}>
      {groups.map((g) => {
        if (!g.category) {
          if (!hasCategories) {
            return (['text', 'voice'] as const).map((kind) => (
              <div key={kind} className="channel-group">
                <div className="channel-group__head">
                  <span>{kind === 'text' ? 'Text channels' : 'Voice channels'}</span>
                  {manage && (
                    <button
                      className="channel-group__add"
                      title={`Create ${kind} channel`}
                      aria-label={`Create ${kind} channel`}
                      onClick={() =>
                        s.setModal({ kind: 'create-channel', communityId: community.id, channelKind: kind })
                      }
                    >
                      <PlusIcon size={14} />
                    </button>
                  )}
                </div>
                {g.channels.filter((ch) => ch.kind === kind).map(row)}
              </div>
            ));
          }
          return (
            <div key="loose" className="channel-group channel-group--loose">
              {g.channels.map(row)}
              {drag?.type === 'channel' && (
                <div className={`channel-drop ${marker('loose', '') ? 'is-over' : ''}`} {...dnd('loose', '')}>
                  Drop here to remove from its category
                </div>
              )}
            </div>
          );
        }
        const k = g.category;
        const closed = !!collapsed[k.id];
        const shown = closed
          ? g.channels.filter(
              (ch) =>
                ch.id === s.selectedChannel ||
                (s.unread[ch.id] ?? 0) > 0 ||
                ch.unread ||
                (community.voice[ch.id]?.length ?? 0) > 0,
            )
          : g.channels;
        return (
          <div
            key={k.id}
            className={`channel-group category ${drag?.id === k.id ? 'is-dragging' : ''}`}
            role="group"
            aria-label={`Category ${k.name}`}
          >
            <div
              className={`channel-group__head category__head ${marker('category', k.id)}`}
              {...dnd('category', k.id, 'category')}
              onContextMenu={(e) => {
                e.preventDefault();
                setCatMenu({ id: k.id, x: e.clientX, y: e.clientY });
              }}
            >
              {catMenu?.id === k.id && (
                <Popover x={catMenu.x} y={catMenu.y} onClose={() => setCatMenu(null)} className="menu">
                  <MenuItem
                    icon={<span aria-hidden="true">✓</span>}
                    onClick={() => {
                      setCatMenu(null);
                      s.markChannelsRead(g.channels.map((ch) => ch.id));
                    }}
                  >
                    {tr('Mark category as read')}
                  </MenuItem>
                  <MenuItem
                    icon={<ChevronIcon size={14} />}
                    onClick={() => {
                      setCatMenu(null);
                      toggle(k.id);
                    }}
                  >
                    {closed ? tr('Expand category') : tr('Collapse category')}
                  </MenuItem>
                  {manage && (
                    <MenuItem
                      icon={<PlusIcon size={14} />}
                      onClick={() => {
                        setCatMenu(null);
                        s.setModal({
                          kind: 'create-channel',
                          communityId: community.id,
                          channelKind: 'text',
                          parentId: k.id,
                        });
                      }}
                    >
                      {tr('Create channel')}
                    </MenuItem>
                  )}
                  {manage && (
                    <MenuItem
                      icon={<GearIcon size={14} />}
                      onClick={() => {
                        setCatMenu(null);
                        s.setModal({ kind: 'category', communityId: community.id, categoryId: k.id });
                      }}
                    >
                      {tr('Edit category')}
                    </MenuItem>
                  )}
                  {/* Mute or set a level for every channel in it (a channel's own setting still wins). */}
                  <NotifyMenuSection id={k.id} kind="category" onDone={() => setCatMenu(null)} />
                </Popover>
              )}
              <button
                className={`category__toggle ${closed ? 'is-collapsed' : ''}`}
                aria-expanded={!closed}
                onClick={() => toggle(k.id)}
              >
                <span className="category__chevron" aria-hidden="true">
                  <ChevronIcon size={12} />
                </span>
                <span className="category__name" title={k.name}>
                  {k.name}
                </span>
              </button>
              {manage && (
                <span className="category__tools">
                  <button
                    className="channel-group__add"
                    title="Create channel"
                    aria-label={`Create channel in ${k.name}`}
                    onClick={() =>
                      s.setModal({
                        kind: 'create-channel',
                        communityId: community.id,
                        channelKind: 'text',
                        parentId: k.id,
                      })
                    }
                  >
                    <PlusIcon size={14} />
                  </button>
                  <button
                    className="channel-group__add"
                    title="Edit category"
                    aria-label={`Edit category ${k.name}`}
                    onClick={() =>
                      s.setModal({ kind: 'category', communityId: community.id, categoryId: k.id })
                    }
                  >
                    <GearIcon size={13} />
                  </button>
                </span>
              )}
            </div>
            {shown.map(row)}
          </div>
        );
      })}
    </div>
  );
}
