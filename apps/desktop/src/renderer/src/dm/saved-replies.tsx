import { tr } from '../i18n.ts';
import { useEffect, useState, type ReactElement } from 'react';
import { create } from 'zustand';
import { MAX_SAVED_REPLIES, TAG_RE, type SavedReply } from '../../../shared/dm.ts';
import { useCommunity } from '../community/store.ts';
import { MenuItem, Modal, Popover } from '../community/ui/common.tsx';
import { plainLine } from '../components/message-kinds.ts';

/**
 * Saved replies (2.19): text you send often, found by typing "/" and its shortcut in a message
 * box (or with the saved-replies button), as Telegram's quick replies. Kept in this device's
 * encrypted database. River has no way yet to copy settings like these to your other devices, so
 * each device keeps its own — and says so.
 */

interface SavedRepliesState {
  replies: SavedReply[] | null;
  load(): Promise<void>;
  save(reply: { id?: string; shortcut: string; text: string }): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

export const useSavedReplies = create<SavedRepliesState>((set) => ({
  replies: null,
  load: async () => {
    // Not there (yet): no saved replies to offer, never an error in the message box.
    const r = await (async () => window.river.dm.action({ a: 'savedReplies' }))().catch(() => null);
    set({ replies: r?.ok ? r.value : [] });
  },
  save: async (reply) => {
    const r = await window.river.dm.action({ a: 'saveReply', ...reply });
    if (!r.ok) {
      useCommunity.getState().notify(r.message, 'error');
      return false;
    }
    set({ replies: r.value });
    return true;
  },
  remove: async (id) => {
    const r = await window.river.dm.action({ a: 'deleteReply', id });
    if (!r.ok) {
      useCommunity.getState().notify(r.message, 'error');
      return false;
    }
    set({ replies: r.value });
    return true;
  },
}));

/** Loads the saved replies once, the first time a message box needs them. */
export function useSavedReplyList(): SavedReply[] {
  const replies = useSavedReplies((s) => s.replies);
  useEffect(() => {
    if (useSavedReplies.getState().replies === null) void useSavedReplies.getState().load();
  }, []);
  return replies ?? [];
}

/** "/sh" typed alone at the start of the box: what follows the slash, else null. */
export function savedReplyQuery(text: string): string | null {
  const m = /^\/([\p{L}\p{N}_-]{0,24})$/u.exec(text);
  return m ? m[1]! : null;
}

/** Saved replies for what was typed after "/": shortcuts that start with it first, then any containing it. */
export function matchReplies(replies: readonly SavedReply[], typed: string, max = 8): SavedReply[] {
  const q = typed.toLowerCase();
  const starts = replies.filter((r) => r.shortcut.toLowerCase().startsWith(q));
  const contains = replies.filter(
    (r) =>
      !starts.includes(r) &&
      (r.shortcut.toLowerCase().includes(q) || (q && r.text.toLowerCase().includes(q))),
  );
  return [...starts, ...contains].slice(0, max);
}

/** The list above the message box while "/shortcut" is typed (keys: see the composer). */
export function SavedReplySuggestions(props: {
  choices: SavedReply[];
  active: number;
  onPick(reply: SavedReply): void;
}): ReactElement {
  return (
    <div className="mention-menu" role="listbox" aria-label={tr('Saved replies')}>
      {props.choices.map((r, i) => (
        <button
          key={r.id}
          type="button"
          role="option"
          aria-selected={i === props.active}
          className={`mention-menu__item ${i === props.active ? 'is-active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            props.onPick(r);
          }}
        >
          <span className="mention-menu__dot" aria-hidden="true">
            /
          </span>
          <span className="mention-menu__label">/{r.shortcut}</span>
          <span className="mention-menu__hint">{plainLine(r.text)}</span>
        </button>
      ))}
    </div>
  );
}

/** The saved-replies button's menu: pick one, or add and edit them. */
export function SavedRepliesMenu(props: {
  x: number;
  y: number;
  onPick(reply: SavedReply): void;
  onClose(): void;
}): ReactElement {
  const replies = useSavedReplyList();
  const [editing, setEditing] = useState(false);
  if (editing) return <SavedRepliesDialog onClose={props.onClose} />;
  return (
    <Popover x={props.x} y={props.y} onClose={props.onClose} className="menu saved-replies">
      {replies.length === 0 && (
        <p className="muted small saved-replies__note">
          {tr(
            'No saved replies yet. Save text you send often, then type / and its shortcut in any message box.',
          )}
        </p>
      )}
      {replies.map((r) => (
        <MenuItem key={r.id} onClick={() => props.onPick(r)}>
          <span className="saved-replies__item">
            <span className="saved-replies__shortcut">/{r.shortcut}</span>
            <span className="saved-replies__text">{plainLine(r.text)}</span>
          </span>
        </MenuItem>
      ))}
      <MenuItem icon={<span aria-hidden="true">✎</span>} onClick={() => setEditing(true)}>
        {replies.length ? tr('Edit saved replies…') : tr('Add a saved reply…')}
      </MenuItem>
    </Popover>
  );
}

/** Add, change and delete saved replies. */
export function SavedRepliesDialog(props: { onClose(): void }): ReactElement {
  const replies = useSavedReplyList();
  const store = useSavedReplies;
  const [editing, setEditing] = useState<SavedReply | null>(null);
  const [shortcut, setShortcut] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const cleanShortcut = shortcut.trim().replace(/^\//, '');
  const valid = TAG_RE.test(cleanShortcut) && text.trim().length > 0;
  const full = !editing && replies.length >= MAX_SAVED_REPLIES;
  const startEdit = (r: SavedReply | null): void => {
    setEditing(r);
    setShortcut(r?.shortcut ?? '');
    setText(r?.text ?? '');
  };
  return (
    <Modal title={tr('Saved replies')} onClose={props.onClose}>
      <p className="muted small">
        {tr(
          'Type / and a shortcut in any message box to send one. Kept encrypted on this device only — your other devices keep their own.',
        )}
      </p>
      {replies.length > 0 && (
        <ul className="saved-replies-edit__list" aria-label={tr('Your saved replies')}>
          {replies.map((r) => (
            <li key={r.id} className="saved-replies-edit__row">
              <div>
                <span className="saved-replies__shortcut">/{r.shortcut}</span>
                <span className="saved-replies__text">{plainLine(r.text)}</span>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                aria-label={tr('Edit {name}', { name: `/${r.shortcut}` })}
                onClick={() => startEdit(r)}
              >
                {tr('Edit')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small btn--danger-text"
                aria-label={tr('Delete {name}', { name: `/${r.shortcut}` })}
                onClick={() => {
                  void store
                    .getState()
                    .remove(r.id)
                    .then(() => {
                      if (editing?.id === r.id) startEdit(null);
                    });
                }}
              >
                {tr('Delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy || full) return;
          setBusy(true);
          void store
            .getState()
            .save({ ...(editing ? { id: editing.id } : {}), shortcut: cleanShortcut, text })
            .then((ok) => {
              setBusy(false);
              if (ok) startEdit(null);
            });
        }}
      >
        <label className="textfield">
          <span className="field__label">{tr('Shortcut')}</span>
          <input
            value={shortcut}
            maxLength={25}
            placeholder={tr('thanks')}
            aria-describedby="saved-reply-shortcut-help"
            onChange={(e) => setShortcut(e.target.value)}
          />
        </label>
        <p id="saved-reply-shortcut-help" className="muted small">
          {tr('Letters, numbers, _ and -, up to 24.')}
        </p>
        <label className="textfield">
          <span className="field__label">{tr('Text')}</span>
          <textarea value={text} maxLength={4000} rows={3} onChange={(e) => setText(e.target.value)} />
        </label>
        {full && (
          <p className="muted small">
            {tr('You can have up to {count} saved replies.', { count: MAX_SAVED_REPLIES })}
          </p>
        )}
        <div className="modal__foot">
          {editing && (
            <button type="button" className="btn btn--ghost" onClick={() => startEdit(null)}>
              {tr('Cancel')}
            </button>
          )}
          <button className="btn btn--primary" disabled={!valid || busy || full}>
            {editing ? tr('Save changes') : tr('Add saved reply')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
