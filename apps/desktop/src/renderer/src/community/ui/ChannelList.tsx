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
import { ChevronIcon, GearIcon, PlusIcon, can } from './common.tsx';
import { ChannelRow } from './Sidebar.tsx';

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

/** Sends the moves implied by `next`, if any. */
export async function applyLayout(community: CommunityView, next: Groups): Promise<void> {
  const change = layoutChanges(next);
  if (change.categories.length === 0 && change.channels.length === 0) return;
  await useCommunity.getState().run({ a: 'layout', communityId: community.id, ...change });
}

/** Puts a channel at the end of a category (or of the uncategorised channels). */
export function moveToCategory(community: CommunityView, channelId: string, parentId: string | null): void {
  const groups = sidebarGroups(community.channels, community.categories);
  const target = groups.find((g) => (g.category?.id ?? null) === parentId);
  void applyLayout(community, moveChannel(groups, channelId, parentId, target?.channels.length ?? 0));
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
    void applyLayout(community, next);
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
            >
              <button
                className={`category__toggle ${closed ? 'is-collapsed' : ''}`}
                aria-expanded={!closed}
                onClick={() => toggle(k.id)}
              >
                <span className="category__chevron" aria-hidden="true">
                  <ChevronIcon size={12} />
                </span>
                <span className="category__name">{k.name}</span>
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
