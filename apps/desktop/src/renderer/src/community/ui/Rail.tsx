import { useState, type CSSProperties, type DragEvent, type ReactElement, type ReactNode } from 'react';
import type { CommunityView } from '../../../../shared/ipc.ts';
import { isMuted } from '../../../../shared/notify-rules.ts';
import {
  FOLDER_COLORS,
  folderKey,
  moveCommunity,
  moveFolder,
  railEntries,
  ungroup,
  updateFolder,
  type DropPlace,
  type Rail,
  type RailFolder,
} from '../../../../shared/rail.ts';
import { useRiver } from '../../store.ts';
import { useCommunity } from '../store.ts';
import { MenuItem, Modal, PlusIcon, Popover, hex, initials } from './common.tsx';
import { tr, trn } from '../../i18n.ts';

type Drag = { kind: 'community' | 'folder'; id: string };
type Drop = { key: string; place: DropPlace } | null;

const newFolderId = (): string => crypto.randomUUID().slice(0, 8);

/** Where on a target the pointer is: top third before, bottom third after, middle into. */
function placeOf(e: DragEvent<HTMLElement>, canInto: boolean): DropPlace {
  const r = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (!canInto) return y < 0.5 ? 'before' : 'after';
  return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'into';
}

/**
 * The community list on the left (1.0.18): drag to reorder, drop one community
 * onto another to make a folder, open and close folders, rename and colour
 * them. Saved on this device.
 */
export function CommunityRail(props: {
  activeId: string | null;
  onAdd(): void;
  onMenu(id: string, x: number, y: number): void;
  /** Above the communities (the Home button), and at the bottom of the rail. */
  top?: ReactNode;
  bottom?: ReactNode;
}): ReactElement {
  const s = useCommunity();
  const settings = useRiver((r) => r.settings);
  const update = useRiver((r) => r.updateSettings);
  const rail: Rail = settings?.rail ?? { order: [], folders: [] };
  const ids = s.communities.map((c) => c.id);
  const entries = railEntries(s.communities, rail);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [folderMenu, setFolderMenu] = useState<{ folder: RailFolder; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<RailFolder | null>(null);
  const save = (next: Rail): void => void update({ rail: next });

  const finish = (target: { kind: 'community' | 'folder'; id: string }, place: DropPlace): void => {
    if (!drag) return;
    if (drag.kind === 'community') save(moveCommunity(rail, ids, drag.id, target, place, newFolderId));
    else if (target.kind === 'folder' || !rail.folders.some((f) => f.items.includes(target.id)))
      save(
        moveFolder(
          rail,
          ids,
          drag.id,
          target.kind === 'folder' ? folderKey(target.id) : target.id,
          place === 'after' ? 'after' : 'before',
        ),
      );
    setDrag(null);
    setDrop(null);
  };

  const dnd = (key: string, target: { kind: 'community' | 'folder'; id: string }, canInto: boolean) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!drag || (drag.kind === target.kind && drag.id === target.id)) return;
      e.preventDefault();
      const place = placeOf(e, canInto && drag.kind === 'community');
      if (drop?.key !== key || drop.place !== place) setDrop({ key, place });
    },
    onDragLeave: () => setDrop((d) => (d?.key === key ? null : d)),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      finish(target, placeOf(e, canInto && drag?.kind === 'community'));
    },
  });

  const dropClass = (key: string): string => (drop?.key === key ? `drop-${drop.place}` : '');

  const item = (c: CommunityView, inFolder: boolean): ReactElement => {
    const prefs = settings?.notifications;
    const muted = !!prefs && isMuted(prefs, c.id);
    const unread =
      !muted &&
      c.channels.some(
        (ch) =>
          !(prefs && isMuted(prefs, ch.id)) &&
          ((s.unread[ch.id] ?? 0) > 0 || (ch.unread && ch.id !== s.selectedChannel)),
      );
    const mentions = c.channels.reduce((n, ch) => n + (s.mentions[ch.id] ?? 0), 0);
    return (
      <div
        key={c.id}
        className={`community__server-wrap ${c.id === props.activeId ? 'is-active' : ''} ${unread ? 'is-unread' : ''} ${muted ? 'is-muted' : ''} ${inFolder ? 'is-in-folder' : ''} ${dropClass(c.id)}`}
        {...dnd(c.id, { kind: 'community', id: c.id }, true)}
      >
        <span className="community__pill" aria-hidden="true" />
        <button
          className={`community__server ${c.id === props.activeId ? 'is-active' : ''}`}
          title={c.name}
          aria-label={c.name}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            setDrag({ kind: 'community', id: c.id });
          }}
          onDragEnd={() => {
            setDrag(null);
            setDrop(null);
          }}
          onClick={() => {
            s.select(c.id);
            useRiver.getState().navigate('communities');
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            props.onMenu(c.id, e.clientX, e.clientY);
          }}
        >
          {c.art?.icon ? (
            <img className="community__server-img" src={c.art.icon} alt="" draggable={false} />
          ) : c.icon ? (
            <span className="community__server-icon" aria-hidden="true">
              {c.icon}
            </span>
          ) : (
            initials(c.name)
          )}
        </button>
        {mentions > 0 && (
          <span key={mentions} className="badge badge--mention community__server-badge">
            {mentions}
          </span>
        )}
      </div>
    );
  };

  return (
    <nav className="community__servers" aria-label={tr('Your communities')}>
      {props.top}
      {props.top && <div className="rail-separator" aria-hidden="true" />}
      {entries.map((e) => {
        if (e.kind === 'community') return item(e.community, false);
        const f = e.folder;
        const key = folderKey(f.id);
        const mentions = e.communities.reduce(
          (n, c) => n + c.channels.reduce((m, ch) => m + (s.mentions[ch.id] ?? 0), 0),
          0,
        );
        const holdsActive = e.communities.some((c) => c.id === props.activeId);
        return (
          <div
            key={key}
            className={`rail-folder ${f.open ? 'is-open' : ''} ${dropClass(key)}`}
            style={{ '--folder': hex(f.color) } as CSSProperties}
          >
            <div
              className={`community__server-wrap ${holdsActive && !f.open ? 'is-active' : ''}`}
              {...dnd(key, { kind: 'folder', id: f.id }, true)}
            >
              <span className="community__pill" aria-hidden="true" />
              <button
                className="community__server rail-folder__button"
                title={f.name}
                aria-label={
                  f.open
                    ? trn('Folder {name}, {count} communities, open', e.communities.length, { name: f.name })
                    : trn('Folder {name}, {count} communities, closed', e.communities.length, {
                        name: f.name,
                      })
                }
                aria-expanded={f.open}
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = 'move';
                  setDrag({ kind: 'folder', id: f.id });
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setDrop(null);
                }}
                onClick={() => save(updateFolder(rail, f.id, { open: !f.open }))}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  setFolderMenu({ folder: f, x: ev.clientX, y: ev.clientY });
                }}
              >
                {f.open ? (
                  <span className="rail-folder__glyph" aria-hidden="true">
                    📁
                  </span>
                ) : (
                  <span className="rail-folder__grid" aria-hidden="true">
                    {e.communities.slice(0, 4).map((c) => (
                      <span key={c.id}>{c.icon ?? initials(c.name).slice(0, 1)}</span>
                    ))}
                  </span>
                )}
              </button>
              {!f.open && mentions > 0 && (
                <span className="badge badge--mention community__server-badge">{mentions}</span>
              )}
            </div>
            {f.open && e.communities.map((c) => item(c, true))}
          </div>
        );
      })}
      <div className="community__server-wrap">
        <button
          className="community__server community__server--add"
          title={tr('Create or join a community')}
          aria-label={tr('Create or join a community')}
          onClick={props.onAdd}
        >
          <PlusIcon size={22} />
        </button>
      </div>
      {props.bottom && <div className="rail-spacer" aria-hidden="true" />}
      {props.bottom}
      {folderMenu && (
        <Popover x={folderMenu.x} y={folderMenu.y} onClose={() => setFolderMenu(null)} className="menu">
          <MenuItem
            onClick={() => {
              setRenaming(folderMenu.folder);
              setFolderMenu(null);
            }}
          >
            {tr('Folder settings')}
          </MenuItem>
          <MenuItem
            onClick={() => {
              const inside = s.communities.filter((c) => folderMenu.folder.items.includes(c.id));
              s.markChannelsRead(inside.flatMap((c) => c.channels.map((ch) => ch.id)));
              setFolderMenu(null);
            }}
          >
            {tr('Mark folder as read')}
          </MenuItem>
          <MenuItem
            onClick={() => {
              save(ungroup(rail, ids, folderMenu.folder.id));
              setFolderMenu(null);
            }}
          >
            {tr('Ungroup')}
          </MenuItem>
        </Popover>
      )}
      {renaming && (
        <FolderSettings
          folder={renaming}
          onSave={(patch) => {
            save(updateFolder(rail, renaming.id, patch));
            setRenaming(null);
          }}
          onClose={() => setRenaming(null)}
        />
      )}
    </nav>
  );
}

function FolderSettings(props: {
  folder: RailFolder;
  onSave(patch: { name: string; color: number }): void;
  onClose(): void;
}): ReactElement {
  const [name, setName] = useState(props.folder.name);
  const [color, setColor] = useState(props.folder.color);
  return (
    <Modal title={tr('Folder settings')} onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onSave({ name: name.trim().slice(0, 40) || tr('Folder'), color });
        }}
      >
        <label className="textfield">
          <span className="field__label">{tr('Folder name')}</span>
          <input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="field">
          <legend className="field__label">{tr('Colour')}</legend>
          <div className="swatches">
            {FOLDER_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`swatch ${c === color ? 'is-selected' : ''}`}
                style={{ background: hex(c) }}
                aria-label={tr('Colour {hex}', { hex: hex(c) })}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </fieldset>
        <div className="modal__foot">
          <button type="button" className="btn btn--link" onClick={props.onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn--primary">{tr('Save')}</button>
        </div>
      </form>
    </Modal>
  );
}
